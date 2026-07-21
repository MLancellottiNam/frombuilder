// ---------------------------------------------------------------------------
// Signframe form-definition domain types.
// These MUST match the export structure described in the spec (section 3)
// EXACTLY. Do not rename keys.
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'textarea'
  | 'repeater'
  | 'signature';

export type FieldWidth = 'full' | 'half' | 'third' | 'quarter' | 'fit';

export type PrefillMode = 'optional' | 'required' | 'locked' | string;

/** Preserved verbatim from an imported PDF-derived field. NOT editable. */
export interface SourceMeta {
  [key: string]: unknown;
}

export interface FieldOption {
  label: string;
  pdfValue: unknown;
  jsonValue: unknown;
  parentValues?: unknown;
}

// --- autoFillConcat -------------------------------------------------------

export interface Transform {
  kind: 'substring';
  start: number;
  end: number;
}

export interface PartCondition {
  fieldId: string;
  op: 'notEmpty' | 'empty' | 'equals';
  values?: unknown; // NOTE: the key is `values` (with s) per spec 3.6
}

export type AutoFillPart =
  | { kind: 'field'; fieldId: string; transforms?: Transform[] }
  | { kind: 'text'; value: unknown; condition?: PartCondition }
  | { kind: 'dateRef'; ref: 'today' | string; offsetDays?: number }
  | {
      kind: 'repeaterAggregate';
      repeaterFieldId: string;
      scope?: string;
      subFieldIds: string[];
      separator?: string;
      group?: boolean;
      groupFieldIds?: string[];
      groupSeparator?: string;
      subFieldLabels?: Record<string, string>;
    }
  | {
      kind: 'repeaterLookup';
      repeaterFieldId: string;
      scope?: string;
      subFieldId: string;
      needles: string;
      match?: 'equals' | string;
      ifFound?: string;
      ifNotFound?: string;
    };

export interface AutoFillConcat {
  sourceFieldIds: string[];
  separator: string;
  parts: AutoFillPart[];
}

// --- repeater -------------------------------------------------------------

export interface SlotMapping {
  itemIndex: number;
  subFieldId: string;
  targetFieldId: string;
}

export interface RepeaterConfig {
  itemLabel: string;
  itemLabelPlural: string;
  addButtonLabel: string;
  minItems: number;
  maxItems: number;
  fields: Field[]; // sub-fields: simple id WITHOUT field_ prefix, no sourceMeta
  slotMappings: SlotMapping[];
  slotPattern: string | null;
  jsonSlotPattern: string | null;
  overflow: unknown;
  overflowThreshold: number;
}

// --- conditions -----------------------------------------------------------

export interface Condition {
  fieldId: string;
  operator: 'not_empty' | 'empty' | 'equals';
  value?: string;
}

export interface ConditionGroup {
  logic: 'and' | 'or';
  conditions: Condition[];
}

// --- Field ----------------------------------------------------------------

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  readOnly: boolean;
  hidden: boolean | null;
  order: number;
  width: FieldWidth;
  options: FieldOption[] | null;
  optionsLayout: string;
  sourceMeta: SourceMeta | null;
  prefillMode: PrefillMode;
  prefillKey: string | null;
  salidaJSON: string | null;
  jsonOutputPath: string | null;
  salidaJSONSecundaria: string | null; // 2do path (ej. código + descripción)
  jsonValueSecundario: unknown;
  excludeFromJson: boolean;
  conditionalVisibility: string | null;
  conditionalRequired: string | null;
  autoFillConcat: AutoFillConcat | null;
  checkedPdfValue: boolean | null;
  checkedJsonValue: unknown;
  jsonNumberFormat: string | null;
  jsonDateFormat: string | null;
  defaultValue: unknown;
  validationPattern: string | null;
  repeaterConfig: RepeaterConfig | null;
  // radios desdoblados
  radioGroupLabel: string | null;
  radioGroupFields: string[] | null;
  sharedValue: unknown;
  jsonValue: unknown;
}

export interface Subsection {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  conditionalVisibility: string | null;
  hidden: boolean | null;
  order: number;
  fields: Field[];
}

export interface ChildOrderEntry {
  kind: 'subsection';
  id: string;
}

export interface Section {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  conditionalVisibility: string | null;
  order: number;
  hidden: boolean | null;
  fields: Field[];
  subsections: Subsection[];
  childrenOrder: ChildOrderEntry[];
}

export interface FormDefinition {
  sections: Section[];
  validationRules: unknown[];
  prefillMappings: unknown[];
  generatedDocuments: unknown[];
  version: number;
  _sourcePdf?: unknown;
}

// --- Project (app state, spec section 8) ----------------------------------

export type IdConvention = 'lower' | 'exact';

export interface SourceField {
  sourceName: string;
  page?: number;
  nativeType?: string;
  label?: string;
  // Sugerencias que vienen de la ficha/matriz (no obligan nada; solo guían y
  // pre-cargan propiedades al arrastrar el campo al canvas).
  suggestedSection?: string;
  suggestedSubsection?: string;
  suggestedType?: FieldType;
  suggestedPath?: string;
  /** true si la matriz no traía sourceName: candidato a campo de UI (sin PDF). */
  isUiOnly?: boolean;
}

/**
 * A real PDF field from the AcroForm universe. When it comes from the Signframe
 * auto-mapped "main JSON", it carries the authoritative id and full sourceMeta
 * that must be copied verbatim so values render correctly.
 */
export interface AcroField {
  name: string; // sourceName
  page?: number;
  id?: string; // authoritative field id from the main JSON (if any)
  type?: FieldType;
  sourceMeta?: SourceMeta; // real sourceMeta from Signframe (copied verbatim on bind)
}

export interface Project {
  name: string;
  sourceFields: SourceField[];
  idConvention: IdConvention;
  form: FormDefinition;
  pool: string[]; // sourceNames not yet placed
  acroForms: AcroField[]; // real PDF field names for Etapa 2 (binding)
}
