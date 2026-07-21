import Papa from 'papaparse';
import { nanoid } from 'nanoid';
import type { Condition, Field, FieldType, IdConvention, Section, SourceField, Subsection } from '../types';
import { fieldFromSource, newUiField } from './factory';
import { parseCondition, serializeCondition } from './conditions';

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
  value?: string; // col F — option value
  path?: string;
  condition?: string;
  required?: string; // col H
  visualization?: string; // col J — readOnly / hidden
}

/**
 * Parse a CSV or XLSX file into { headers, rows }. For multi-sheet workbooks
 * (like the INS ficha with 3 sheets) it picks the MAIN sheet: the one with the
 * most data rows.
 */
export async function parseTable(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let best: Table = { headers: [], rows: [] };
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
      const t = aoaToTable(aoa);
      if (t.rows.length > best.rows.length) best = t;
    }
    return best;
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

/** Aggressive key for matching labels/rule targets: also drops punctuation. */
const normKey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Guess the column mapping from header names. Candidate-priority: tries each
 * candidate string in order and returns the first header that contains it, so
 * specific INS headers win over generic ones (e.g. "campo en el pdf" before the
 * bare "campo"). Tuned for the INS "Ficha de Configuración" columns A–N.
 */
export function guessMatrixMapping(headers: string[]): MatrixMapping {
  const find = (...cands: string[]): string | undefined => {
    for (const c of cands) {
      const h = headers.find((x) => norm(x).includes(c));
      if (h) return h;
    }
    return undefined;
  };
  const m: MatrixMapping = {
    // A: "Pasos Formulario"; fallback generic seccion/module
    section: find('paso', 'seccion', 'section', 'modulo', 'grupo principal'),
    // B: "Sección" (the subsection within a step)
    subsection: find('subseccion', 'sub-seccion', 'subgrupo', 'apartado', 'seccion', 'section'),
    // N: "Nombre del campo en el PDF" (the real AcroForm sourceName)
    sourceName: find('campo en el pdf', 'campo en pdf', 'acroform', 'sourcename', 'source', 'campo pdf', 'nombre pdf'),
    // D: "Nombre del campo en formulario"
    label: find('campo en formulario', 'campo en el formulario', 'label', 'etiqueta', 'titulo', 'pregunta', 'descripcion'),
    // E: "Tipo de dato"
    type: find('tipo de dato', 'tipo', 'type'),
    // F: "Valor"
    value: find('valor', 'value'),
    // M: "Nombre del campo en el JSON" (full destination path)
    path: find('campo en el json', 'campo en json', 'path', 'salida', 'destino', 'ruta', 'json'),
    // G: "Regla"
    condition: find('regla', 'condicion', 'condición', 'depende', 'visible si', 'mostrar si', 'aplica si', 'muestra si', 'dependencia'),
    // H: "Obligatorio"
    required: find('obligatorio', 'requerido', 'required', 'mandatorio'),
    // J: "Visualización en Formularios"
    visualization: find('visualizacion', 'visualización', 'estado'),
  };
  // section and subsection must not collapse onto the same column.
  if (m.subsection && m.subsection === m.section) m.subsection = undefined;
  if (m.label && m.label === m.sourceName) m.label = undefined;
  return m;
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
  value: string; // col F — option value (empty for free-text fields)
  type: FieldType | null;
  typeRaw: string;
  path: string;
  conditionRaw: string;
  /** "this field shows when X = v" style (col G, minority). */
  condition: ParsedCondition | null;
  /** INS col G dominant pattern: labels this row REVEALS when answered/selected. */
  reveals: string[];
  required: boolean;
  readOnly: boolean;
  hidden: boolean;
  /** how many times this field's key appears in the whole matrix (>1 = duplicate) */
  duplicateCount: number;
}

/**
 * Parse col G. The dominant INS pattern is an inverted rule where THIS row is
 * the trigger and lists the fields it reveals:
 *   "En caso de si, se despliegan los campos:  A / B"  ->  reveals: [A, B]
 * Anything else is treated as a self-condition ("this shows when ...").
 */
export function parseRule(raw: string): { reveals: string[]; selfCondition: ParsedCondition | null } {
  const text = (raw ?? '').trim();
  if (!text) return { reveals: [], selfCondition: null };
  const m = text.match(/se\s+despliega\w*\s+(?:los\s+|el\s+|las\s+|la\s+)?campos?:?\s*(.+)$/i);
  if (m) {
    const reveals = m[1]
      .split(/\s*[/\n;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { reveals, selfCondition: null };
  }
  return { reveals: [], selfCondition: parseConditionText(text) };
}

function parseVisualization(raw: string): { readOnly: boolean; hidden: boolean } {
  const n = norm(raw);
  if (n.includes('no aplica')) return { readOnly: false, hidden: true };
  if (n.includes('disabled')) return { readOnly: true, hidden: false };
  return { readOnly: false, hidden: false };
}

const isSi = (raw: string) => /^s[ií]$/i.test((raw ?? '').trim());

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

    // Only real PDF fields (sourceName) count toward duplicates — repeated
    // labels in the INS ficha are the OPTIONS of one question, not dups.
    if (sourceName) keyCount.set(sourceName, (keyCount.get(sourceName) ?? 0) + 1);

    const typeRaw = cell(row, mapping.type);
    const conditionRaw = cell(row, mapping.condition);
    const { reveals, selfCondition } = parseRule(conditionRaw);
    const vis = parseVisualization(cell(row, mapping.visualization));
    globalIndex++;
    entries.push({
      index,
      globalIndex,
      section,
      subsection: sub,
      sourceName,
      label: label || (sourceName ?? 'Campo'),
      value: cell(row, mapping.value),
      type: mapType(typeRaw),
      typeRaw,
      path: cell(row, mapping.path),
      conditionRaw,
      condition: selfCondition,
      reveals,
      required: isSi(cell(row, mapping.required)),
      readOnly: vis.readOnly,
      hidden: vis.hidden,
      duplicateCount: 0, // filled below
    });
  }

  // Fill duplicateCount for source-derived fields.
  const duplicates: Record<string, number> = {};
  for (const e of entries) {
    if (!e.sourceName) continue;
    const c = keyCount.get(e.sourceName) ?? 1;
    e.duplicateCount = c;
    if (c > 1) duplicates[e.sourceName] = c;
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

export interface MaterializeResult {
  sections: Section[];
  sourceFields: SourceField[];
  /** duplicate rows skipped to keep field ids unique */
  skipped: number;
  /** conditions written as conditionalVisibility */
  conditionsApplied: number;
  /** multi-option questions modelled as desdoblado radios */
  radioGroups: number;
}

/**
 * Etapa 1 — build the whole ordered tree with fields already placed inside their
 * sections/subsections (no pool).
 *  - consecutive rows with the same (section, subsection, label) become ONE
 *    question; multi-row questions are modelled desdoblado (a radio field per
 *    option, sharing radioGroupLabel + radioGroupFields, jsonValue = col F);
 *  - col G "se despliegan los campos: A / B" makes A/B visible-when the trigger
 *    option is selected (not_empty), OR-merged across triggers;
 *  - required / readOnly / hidden come from cols H / J;
 *  - duplicate field ids are skipped (first wins).
 */
export function materializeMatrix(
  result: MatrixResult,
  convention: IdConvention,
  opts?: { groupOptions?: boolean },
): MaterializeResult {
  const groupOptions = opts?.groupOptions ?? true;
  const sections: Section[] = [];
  const sectionByTitle = new Map<string, Section>();
  const subByKey = new Map<string, Subsection>();
  const orderCounters = new Map<string, number>();
  const usedIds = new Set<string>();
  const fieldById = new Map<string, Field>();
  const sourceFields: SourceField[] = [];
  const seenSource = new Set<string>();
  const bySourceName = new Map<string, string>();
  const questionFields = new Map<string, string[]>(); // norm(question label) -> field ids
  const revealPending: { triggerId: string; names: string[] }[] = [];
  const selfPending: { field: Field; ref: string; value: string; negated: boolean }[] = [];
  let skipped = 0;
  let radioGroups = 0;

  const ensureSub = (e: MatrixEntry): Subsection => {
    let section = sectionByTitle.get(e.section);
    if (!section) {
      section = {
        id: 'section_' + nanoid(8),
        title: e.section,
        description: null,
        instructions: null,
        conditionalVisibility: null,
        order: sections.length + 1,
        hidden: null,
        fields: [],
        subsections: [],
        childrenOrder: [],
      };
      sections.push(section);
      sectionByTitle.set(e.section, section);
    }
    const subKey = section.id + '||' + e.subsection;
    let sub = subByKey.get(subKey);
    if (!sub) {
      sub = {
        id: 'sub_' + nanoid(8),
        title: e.subsection,
        description: null,
        instructions: null,
        conditionalVisibility: null,
        hidden: null,
        order: section.subsections.length + 1,
        fields: [],
      };
      section.subsections.push(sub);
      section.childrenOrder.push({ kind: 'subsection', id: sub.id });
      subByKey.set(subKey, sub);
    }
    return sub;
  };

  const pushQuestion = (label: string, id: string) => {
    const k = normKey(label);
    const arr = questionFields.get(k) ?? [];
    arr.push(id);
    questionFields.set(k, arr);
  };

  const buildField = (e: MatrixEntry, asOption: boolean, questionLabel: string): Field => {
    const src: SourceField = {
      sourceName: e.sourceName ?? `__ui_${e.globalIndex}__`,
      nativeType: e.typeRaw || undefined,
      label: asOption ? e.value || e.label : e.label,
      suggestedType: asOption ? 'radio' : e.type ?? undefined,
      suggestedPath: e.path || undefined,
      isUiOnly: !e.sourceName,
    };
    const field = e.sourceName
      ? fieldFromSource(src, convention, 1)
      : newUiField(1, asOption ? 'radio' : e.type ?? 'text');
    field.label = asOption ? e.value || e.label : e.label;
    field.salidaJSON = e.path || null;
    field.jsonOutputPath = e.path || null;
    field.required = e.required;
    field.readOnly = e.readOnly;
    field.hidden = e.hidden ? true : null;
    if (asOption) {
      field.type = 'radio';
      field.radioGroupLabel = questionLabel;
      field.jsonValue = e.value || null;
    }
    return field;
  };

  const place = (sub: Subsection, field: Field, e: MatrixEntry): Field | null => {
    if (usedIds.has(field.id)) {
      skipped++;
      return null;
    }
    usedIds.add(field.id);
    const order = (orderCounters.get(sub.id) ?? 0) + 1;
    orderCounters.set(sub.id, order);
    field.order = order;
    sub.fields.push(field);
    fieldById.set(field.id, field);
    if (e.sourceName) {
      bySourceName.set(e.sourceName, field.id);
      if (!seenSource.has(e.sourceName)) {
        seenSource.add(e.sourceName);
        sourceFields.push({
          sourceName: e.sourceName,
          nativeType: e.typeRaw || undefined,
          label: e.label,
          suggestedSection: e.section,
          suggestedSubsection: e.subsection,
          suggestedType: e.type ?? undefined,
          suggestedPath: e.path || undefined,
        });
      }
    }
    return field;
  };

  // Group consecutive rows that share (section, subsection, label).
  const groups: MatrixEntry[][] = [];
  for (const e of result.entries) {
    const last = groups[groups.length - 1];
    if (
      groupOptions &&
      last &&
      !!e.label &&
      last[0].section === e.section &&
      last[0].subsection === e.subsection &&
      norm(last[0].label) === norm(e.label)
    ) {
      last.push(e);
    } else {
      groups.push([e]);
    }
  }

  for (const group of groups) {
    const sub = ensureSub(group[0]);
    if (group.length === 1) {
      const e = group[0];
      const field = place(sub, buildField(e, false, e.label), e);
      if (field) {
        pushQuestion(e.label, field.id);
        if (e.reveals.length) revealPending.push({ triggerId: field.id, names: e.reveals });
        if (e.condition) selfPending.push({ field, ...e.condition });
      }
    } else {
      radioGroups++;
      const created: { field: Field; e: MatrixEntry }[] = [];
      for (const e of group) {
        const field = place(sub, buildField(e, true, group[0].label), e);
        if (field) created.push({ field, e });
      }
      const ids = created.map((c) => c.field.id);
      created.forEach((c) => (c.field.radioGroupFields = ids.filter((id) => id !== c.field.id)));
      created.forEach((c) => {
        pushQuestion(group[0].label, c.field.id);
        if (c.e.reveals.length) revealPending.push({ triggerId: c.field.id, names: c.e.reveals });
        if (c.e.condition) selfPending.push({ field: c.field, ...c.e.condition });
      });
    }
  }

  // Pass 2 — resolve rules into conditionalVisibility.
  let conditionsApplied = 0;
  const addOr = (field: Field, cond: Condition) => {
    const g = parseCondition(field.conditionalVisibility) ?? { logic: 'or', conditions: [] };
    if (g.conditions.length) g.logic = 'or';
    if (!g.conditions.some((c) => c.fieldId === cond.fieldId && c.operator === cond.operator && c.value === cond.value)) {
      g.conditions.push(cond);
    }
    field.conditionalVisibility = serializeCondition(g);
  };

  for (const p of selfPending) {
    const targetId = bySourceName.get(p.ref) ?? questionFields.get(normKey(p.ref))?.[0];
    if (!targetId) continue;
    const operator: Condition['operator'] = p.value ? 'equals' : p.negated ? 'empty' : 'not_empty';
    p.field.conditionalVisibility = serializeCondition({
      logic: 'and',
      conditions: [{ fieldId: targetId, operator, ...(p.value ? { value: p.value } : {}) }],
    });
    conditionsApplied++;
  }
  for (const rp of revealPending) {
    for (const name of rp.names) {
      for (const tid of questionFields.get(normKey(name)) ?? []) {
        const tf = fieldById.get(tid);
        if (tf) {
          addOr(tf, { fieldId: rp.triggerId, operator: 'not_empty' });
          conditionsApplied++;
        }
      }
    }
  }

  return { sections, sourceFields, skipped, conditionsApplied, radioGroups };
}
