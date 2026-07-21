import Papa from 'papaparse';
import type { FieldType, SourceField } from '../types';

// ---------------------------------------------------------------------------
// Import de "ficha/matriz": una planilla (CSV o xlsx) que describe cómo debería
// verse el formulario. NO auto-construye la definición: solo mira las columnas
// y las secciones/subsecciones, carga los campos al pool con su sección/subsección
// SUGERIDA, y opcionalmente crea las secciones/subsecciones vacías para que el
// usuario arme el camino con drag & drop.
// ---------------------------------------------------------------------------

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

export interface MatrixMapping {
  section?: string;
  subsection?: string;
  sourceName?: string;
  label?: string;
  type?: string;
  path?: string;
  condition?: string;
}

/** Parse a CSV or XLSX file into { headers, rows }. */
export async function parseTable(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
    return aoaToTable(aoa);
  }
  const text = await file.text();
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  return aoaToTable(res.data);
}

function aoaToTable(aoa: unknown[][]): Table {
  const nonEmpty = aoa.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headerRow = nonEmpty[0].map((h, i) => String(h ?? '').trim() || `col_${i}`);
  const rows = nonEmpty.slice(1).map((arr) => {
    const o: Record<string, string> = {};
    headerRow.forEach((h, i) => (o[h] = String(arr[i] ?? '').trim()));
    return o;
  });
  return { headers: headerRow, rows };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Guess the column mapping from header names. */
export function guessMatrixMapping(headers: string[]): MatrixMapping {
  const find = (...cands: string[]) => headers.find((h) => cands.some((c) => norm(h).includes(c)));
  return {
    section: find('seccion', 'section', 'modulo', 'grupo principal'),
    subsection: find('subseccion', 'subsection', 'sub-seccion', 'subgrupo', 'apartado'),
    sourceName: find('sourcename', 'source', 'campo pdf', 'acroform', 'nombre pdf', 'field', 'nombre campo', 'campo'),
    label: find('label', 'etiqueta', 'titulo', 'pregunta', 'descripcion'),
    type: find('tipo', 'type'),
    path: find('path', 'salida', 'json', 'destino', 'ruta'),
    condition: find('condicion', 'condición', 'depende', 'visible si', 'mostrar si', 'aplica si', 'muestra si', 'dependencia'),
  };
}

const TYPE_SYNONYMS: [RegExp, FieldType][] = [
  [/(numero|número|number|monto|importe|cantidad|decimal)/, 'number'],
  [/(fecha|date)/, 'date'],
  [/(select|lista|desplegable|combo|dropdown|seleccion)/, 'select'],
  [/(radio|opcion|opción)/, 'radio'],
  [/(check|casilla|si\s*\/?\s*no|booleano|boolean)/, 'checkbox'],
  [/(textarea|area|párrafo|parrafo|texto largo|multilinea)/, 'textarea'],
  [/(firma|signature|sign)/, 'signature'],
  [/(repeater|repetible|tabla|listado)/, 'repeater'],
  [/(texto|text|string)/, 'text'],
];

export function mapType(raw: string | undefined): FieldType | null {
  if (!raw) return null;
  const n = norm(raw);
  for (const [re, t] of TYPE_SYNONYMS) if (re.test(n)) return t;
  return null;
}

export interface MatrixGroup {
  section: string;
  subsections: string[];
}

export interface ParsedCondition {
  /** Referenced trigger (matched later against a field's label/sourceName). */
  ref: string;
  /** Expected value; empty string means "just needs a value" (not_empty). */
  value: string;
  /** true for negative phrasing ("si NO ...") — we couldn't fully model it, kept for display. */
  negated: boolean;
}

/** One row of the matrix, preserved in order (duplicates INCLUDED). */
export interface MatrixEntry {
  index: number; // 1-based order within its subsection
  globalIndex: number; // 1-based order across the whole matrix
  section: string;
  subsection: string;
  sourceName: string | null; // null = UI-only (no PDF field)
  label: string;
  type: FieldType | null;
  typeRaw: string;
  path: string;
  conditionRaw: string;
  condition: ParsedCondition | null;
  /** how many times this field's key appears in the whole matrix (>1 = duplicate) */
  duplicateCount: number;
}

export interface MatrixStats {
  columns: number;
  rows: number; // meaningful rows (entries)
  uniqueFields: number;
  sections: number;
  subsections: number;
  withSource: number;
  duplicates: number; // number of keys appearing more than once
}

export interface MatrixResult {
  entries: MatrixEntry[];
  /** Enriched pool candidates (deduped; carry suggested section/subsection/type/path). */
  sourceFields: SourceField[];
  /** Distinct sections -> subsections detected, in order of appearance. */
  groups: MatrixGroup[];
  /** key -> count, only for keys that appear more than once. */
  duplicates: Record<string, number>;
  stats: MatrixStats;
}

/**
 * Parse a free-form condition cell into { ref, value }. Forgiving on purpose:
 *   "Seguro = Sí"  "Seguro: Si"  "si Tiene_Seguro"  "Tiene_Seguro==No"  "Moneda vale Colones"
 * If it can't split a value, treats it as "ref must have any value".
 */
export function parseConditionText(raw: string): ParsedCondition | null {
  const text = raw.trim();
  if (!text) return null;
  const negated = /\bno\b/i.test(text) && /\b(si|cuando)\b/i.test(text);
  // strip leading connectors: "si ", "cuando ", "solo si ", "visible si "
  let body = text.replace(/^(solo\s+)?(si|cuando|visible si|mostrar si|aplica si|muestra si)\s+/i, '');
  const m = body.match(/^(.*?)\s*(?:={1,2}|:|\bes\b|\bvale\b|\bigual a\b)\s*(.+)$/i);
  if (m) return { ref: m[1].trim(), value: m[2].trim(), negated };
  return { ref: body.trim(), value: '', negated };
}

/**
 * Read the matrix into ordered entries + pool candidates + detected structure.
 * Section/subsection values are forward-filled so a ficha that names the group
 * only on its first row still associates the following fields with it.
 * Duplicate rows are PRESERVED as entries (so the explorer can surface them).
 */
export function readMatrix(table: Table, mapping: MatrixMapping): MatrixResult {
  const cell = (row: Record<string, string>, col?: string) => (col ? (row[col] ?? '').trim() : '');

  const entries: MatrixEntry[] = [];
  const groupOrder: string[] = [];
  const groupSubs = new Map<string, string[]>();
  const subCounters = new Map<string, number>();
  const keyCount = new Map<string, number>();

  let lastSection = '';
  let lastSub = '';
  let globalIndex = 0;

  for (const row of table.rows) {
    const secRaw = cell(row, mapping.section);
    const subRaw = cell(row, mapping.subsection);
    if (secRaw) lastSection = secRaw;
    if (subRaw) lastSub = subRaw;

    const sourceName = cell(row, mapping.sourceName) || null;
    const label = cell(row, mapping.label);
    if (!sourceName && !label) continue; // spacer row

    const section = lastSection || 'Sin sección';
    const sub = lastSub || 'General';

    if (!groupSubs.has(section)) {
      groupSubs.set(section, []);
      groupOrder.push(section);
    }
    const subs = groupSubs.get(section)!;
    if (!subs.includes(sub)) subs.push(sub);

    const subKey = section + '||' + sub;
    const index = (subCounters.get(subKey) ?? 0) + 1;
    subCounters.set(subKey, index);

    const key = sourceName ?? 'label:' + norm(label);
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);

    const typeRaw = cell(row, mapping.type);
    const conditionRaw = cell(row, mapping.condition);
    globalIndex++;
    entries.push({
      index,
      globalIndex,
      section,
      subsection: sub,
      sourceName,
      label: label || (sourceName ?? 'Campo'),
      type: mapType(typeRaw),
      typeRaw,
      path: cell(row, mapping.path),
      conditionRaw,
      condition: parseConditionText(conditionRaw),
      duplicateCount: 0, // filled below
      _key: key,
    } as MatrixEntry & { _key: string });
  }

  // Fill duplicateCount now that all keys are counted.
  const duplicates: Record<string, number> = {};
  for (const e of entries as (MatrixEntry & { _key: string })[]) {
    const c = keyCount.get(e._key) ?? 1;
    e.duplicateCount = c;
    if (c > 1) duplicates[e.sourceName ?? e.label] = c;
    delete (e as { _key?: string })._key;
  }

  // Deduped pool candidates (first occurrence wins).
  const sourceFields: SourceField[] = [];
  const seen = new Set<string>();
  let autoId = 0;
  let withSource = 0;
  for (const e of entries) {
    const poolKey = e.sourceName || `__ui_${autoId++}__`;
    if (e.sourceName && seen.has(e.sourceName)) continue;
    if (e.sourceName) seen.add(e.sourceName);
    if (e.sourceName) withSource++;
    sourceFields.push({
      sourceName: poolKey,
      nativeType: e.typeRaw || undefined,
      label: e.sourceName ? e.label : e.label,
      suggestedSection: e.section,
      suggestedSubsection: e.subsection,
      suggestedType: e.type ?? undefined,
      suggestedPath: e.path || undefined,
      isUiOnly: !e.sourceName,
    });
  }

  const groups: MatrixGroup[] = groupOrder.map((s) => ({ section: s, subsections: groupSubs.get(s)! }));
  const subsectionCount = groups.reduce((n, g) => n + g.subsections.length, 0);

  return {
    entries,
    sourceFields,
    groups,
    duplicates,
    stats: {
      columns: table.headers.length,
      rows: entries.length,
      uniqueFields: sourceFields.length,
      sections: groups.length,
      subsections: subsectionCount,
      withSource,
      duplicates: Object.keys(duplicates).length,
    },
  };
}
