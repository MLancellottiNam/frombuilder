import { nanoid } from 'nanoid';
import type {
  Field,
  FieldType,
  IdConvention,
  Section,
  SourceField,
  Subsection,
  FormDefinition,
} from '../types';
import { fieldIdFor } from './idConvention';

/** Map a PDF native type string to a sensible default Signframe field type. */
export function defaultTypeFor(nativeType?: string): FieldType {
  const t = (nativeType ?? '').toLowerCase();
  if (t.includes('check')) return 'checkbox';
  if (t.includes('radio')) return 'radio';
  if (t.includes('choice') || t.includes('combo') || t.includes('select')) return 'select';
  if (t.includes('sig')) return 'signature';
  if (t.includes('date')) return 'date';
  if (t.includes('num')) return 'number';
  return 'text';
}

function baseField(id: string, label: string, type: FieldType, order: number): Field {
  return {
    id,
    type,
    label,
    required: false,
    readOnly: false,
    hidden: null,
    order, // spec: order must always be > 0
    width: 'full',
    options: null,
    optionsLayout: 'horizontal',
    sourceMeta: null,
    prefillMode: 'optional',
    prefillKey: null,
    salidaJSON: null,
    jsonOutputPath: null,
    salidaJSONSecundaria: null,
    jsonValueSecundario: null,
    excludeFromJson: false,
    conditionalVisibility: null,
    conditionalRequired: null,
    autoFillConcat: null,
    checkedPdfValue: null,
    checkedJsonValue: null,
    jsonNumberFormat: null,
    jsonDateFormat: null,
    defaultValue: null,
    validationPattern: null,
    repeaterConfig: null,
    radioGroupLabel: null,
    radioGroupFields: null,
    sharedValue: null,
    jsonValue: null,
  };
}

/**
 * Build a Field from a CSV/PDF SourceField. This field paints the PDF, so it
 * carries sourceMeta and its id is locked to "field_" + applyConvention(name).
 */
export function fieldFromSource(
  src: SourceField,
  convention: IdConvention,
  order: number,
): Field {
  // Matrix rows without a real sourceName become UI-only fields (no sourceMeta).
  if (src.isUiOnly) {
    const uf = newUiField(order, src.suggestedType ?? defaultTypeFor(src.nativeType));
    if (src.label) uf.label = src.label;
    applySuggestions(uf, src);
    return uf;
  }
  const id = fieldIdFor(src.sourceName, convention);
  const type = src.suggestedType ?? defaultTypeFor(src.nativeType);
  const f = baseField(id, src.label || src.sourceName, type, order);
  f.sourceMeta = {
    sourceName: src.sourceName,
    ...(src.page != null ? { page: src.page } : {}),
    ...(src.nativeType ? { nativeType: src.nativeType } : {}),
  };
  // Checkboxes that paint the PDF must use checkedPdfValue: true (never "X").
  if (type === 'checkbox') f.checkedPdfValue = true;
  applySuggestions(f, src);
  return f;
}

/**
 * A col-M cell can carry two destinations ("código, descripción"). Split into
 * primary + secondary so we never emit an invalid comma-joined path.
 */
export function splitPath(raw: string | null | undefined): { primary: string | null; secondary: string | null } {
  if (!raw) return { primary: null, secondary: null };
  const parts = raw
    .split(/\s*[,;]\s*|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { primary: parts[0] ?? null, secondary: parts[1] ?? null };
}

/** Pre-fill type/path from the matrix suggestions (drag-time convenience). */
function applySuggestions(f: Field, src: SourceField): void {
  if (src.suggestedType) {
    f.type = src.suggestedType;
    if (f.type === 'checkbox' && f.sourceMeta) f.checkedPdfValue = true;
  }
  if (src.suggestedPath) {
    const { primary, secondary } = splitPath(src.suggestedPath);
    f.salidaJSON = primary;
    f.jsonOutputPath = primary;
    f.salidaJSONSecundaria = secondary;
  }
}

/** A UI-only field (select, split radio, helper, repeater...) — no sourceMeta. */
export function newUiField(order: number, type: FieldType = 'text'): Field {
  const id = 'field_' + nanoid(8);
  return baseField(id, 'Nuevo campo', type, order);
}

export function newSubsection(order: number, title = 'Nueva subsección'): Subsection {
  return {
    id: 'sub_' + nanoid(8),
    title,
    description: null,
    instructions: null,
    conditionalVisibility: null,
    hidden: null,
    order,
    fields: [],
  };
}

export function newSection(order: number, title = 'Nueva sección'): Section {
  const sub = newSubsection(1, 'Subsección 1');
  return {
    id: 'section_' + nanoid(8),
    title,
    description: null,
    instructions: null,
    conditionalVisibility: null,
    order,
    hidden: null,
    fields: [],
    subsections: [sub],
    childrenOrder: [{ kind: 'subsection', id: sub.id }],
  };
}

export function emptyForm(): FormDefinition {
  return {
    sections: [],
    validationRules: [],
    prefillMappings: [],
    generatedDocuments: [],
    version: 1,
  };
}
