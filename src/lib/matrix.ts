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

export interface MatrixStats {
  columns: number;
  fields: number;
  sections: number;
  subsections: number;
  withSource: number;
}

export interface MatrixResult {
  /** Enriched pool candidates (carry the suggested section/subsection/type/path). */
  sourceFields: SourceField[];
  /** Distinct sections -> subsections detected, in order of appearance. */
  groups: MatrixGroup[];
  stats: MatrixStats;
}

/**
 * Read the matrix into pool candidates + detected structure. Section/subsection
 * values are forward-filled so a ficha that names the group only on its first
 * row still associates the following fields with it.
 */
export function readMatrix(table: Table, mapping: MatrixMapping): MatrixResult {
  const cell = (row: Record<string, string>, col?: string) => (col ? (row[col] ?? '').trim() : '');

  const sourceFields: SourceField[] = [];
  const seen = new Set<string>();
  const groupOrder: string[] = [];
  const groupSubs = new Map<string, string[]>();
  let withSource = 0;
  let autoId = 0;

  let lastSection = '';
  let lastSub = '';

  for (const row of table.rows) {
    const secRaw = cell(row, mapping.section);
    const subRaw = cell(row, mapping.subsection);
    if (secRaw) lastSection = secRaw;
    if (subRaw) lastSub = subRaw;

    const sourceName = cell(row, mapping.sourceName);
    const label = cell(row, mapping.label);
    if (!sourceName && !label) continue; // spacer row

    const section = lastSection || 'Sin sección';
    const sub = lastSub || 'General';

    // Track distinct structure.
    if (!groupSubs.has(section)) {
      groupSubs.set(section, []);
      groupOrder.push(section);
    }
    const subs = groupSubs.get(section)!;
    if (!subs.includes(sub)) subs.push(sub);

    // Pool candidate. Fields without a sourceName get a synthetic key so they
    // still appear in the pool (as UI-field candidates).
    const key = sourceName || `__ui_${autoId++}__`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (sourceName) withSource++;

    sourceFields.push({
      sourceName: key,
      nativeType: cell(row, mapping.type) || undefined,
      label: label || (sourceName ? undefined : 'Campo'),
      suggestedSection: section,
      suggestedSubsection: sub,
      suggestedType: mapType(cell(row, mapping.type)) ?? undefined,
      suggestedPath: cell(row, mapping.path) || undefined,
      isUiOnly: !sourceName,
    });
  }

  const groups: MatrixGroup[] = groupOrder.map((s) => ({ section: s, subsections: groupSubs.get(s)! }));
  const subsectionCount = groups.reduce((n, g) => n + g.subsections.length, 0);

  return {
    sourceFields,
    groups,
    stats: {
      columns: table.headers.length,
      fields: sourceFields.length,
      sections: groups.length,
      subsections: subsectionCount,
      withSource,
    },
  };
}
