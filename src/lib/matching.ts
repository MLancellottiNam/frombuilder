import type { AcroField, Field, FormDefinition, Section } from '../types';

// ---------------------------------------------------------------------------
// Etapa 2 helpers: suggest which real AcroForm name binds to a matrix field,
// and rewrite every reference when a field's id changes on assignment.
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 1);
}

/** 0..1 similarity between a matrix field and an AcroForm name. */
export function score(field: Field, acro: AcroField): number {
  const acroN = norm(acro.name);
  const acroTokens = new Set(tokens(acro.name));
  // Compare against label and the tail of the destination path.
  const candidates = [field.label, (field.salidaJSON ?? '').split('.').pop() ?? '', field.radioGroupLabel ?? ''];
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    const cN = norm(c);
    if (!cN) continue;
    if (cN === acroN) return 1;
    const cTokens = tokens(c);
    if (cTokens.length === 0) continue;
    // token overlap (Jaccard-ish, weighted to the field's own tokens)
    const overlap = cTokens.filter((t) => acroTokens.has(t)).length;
    let s = overlap / cTokens.length;
    // substring bonus
    if (acroN.includes(cN) || cN.includes(acroN)) s = Math.max(s, 0.6);
    best = Math.max(best, s);
  }
  return best;
}

export interface Suggestion {
  acro: AcroField;
  score: number;
}

/** Best AcroForm suggestions for a field, above a small threshold, sorted. */
export function suggest(field: Field, acroForms: AcroField[], limit = 5): Suggestion[] {
  return acroForms
    .map((acro) => ({ acro, score: score(field, acro) }))
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Every field in the form (section + subsection level), flattened. */
export function flattenFields(form: FormDefinition): Field[] {
  const out: Field[] = [];
  for (const s of form.sections) {
    out.push(...s.fields);
    for (const sub of s.subsections) out.push(...sub.fields);
  }
  return out;
}

// --- id reference rewrite -------------------------------------------------

/** Replace a fieldId inside a serialized condition string. */
function rewriteCondition(raw: string | null, oldId: string, newId: string): string | null {
  if (!raw) return raw;
  try {
    const g = JSON.parse(raw);
    if (Array.isArray(g?.conditions)) {
      let changed = false;
      for (const c of g.conditions) {
        if (c.fieldId === oldId) {
          c.fieldId = newId;
          changed = true;
        }
      }
      return changed ? JSON.stringify(g) : raw;
    }
  } catch {
    /* leave as-is */
  }
  return raw;
}

function rewriteFieldRefs(f: Field, oldId: string, newId: string): Field {
  const next: Field = { ...f };
  next.conditionalVisibility = rewriteCondition(f.conditionalVisibility, oldId, newId);
  next.conditionalRequired = rewriteCondition(f.conditionalRequired, oldId, newId);
  if (f.radioGroupFields) {
    next.radioGroupFields = f.radioGroupFields.map((id) => (id === oldId ? newId : id));
  }
  if (f.autoFillConcat) {
    next.autoFillConcat = {
      ...f.autoFillConcat,
      sourceFieldIds: f.autoFillConcat.sourceFieldIds.map((id) => (id === oldId ? newId : id)),
    };
  }
  return next;
}

/**
 * Apply oldId -> newId to the id of the target field AND to every reference to
 * it across the form (conditions, radioGroupFields, autoFill). Returns a new
 * form. Callers must ensure newId is unique.
 */
export function renameFieldId(form: FormDefinition, oldId: string, newId: string, patch: Partial<Field>): FormDefinition {
  const mapField = (f: Field): Field => {
    let nf = rewriteFieldRefs(f, oldId, newId);
    if (f.id === oldId) nf = { ...nf, ...patch, id: newId };
    return nf;
  };
  const sections: Section[] = form.sections.map((s) => ({
    ...s,
    fields: s.fields.map(mapField),
    subsections: s.subsections.map((sub) => ({ ...sub, fields: sub.fields.map(mapField) })),
  }));
  return { ...form, sections };
}

export function allFieldIds(form: FormDefinition): Set<string> {
  return new Set(flattenFields(form).map((f) => f.id));
}

/**
 * Extract the AcroForm universe from a Signframe "main" JSON (the auto-mapped
 * PDF import): every field that carries a sourceMeta, with its authoritative id
 * and full sourceMeta copied so binding renders values correctly.
 */
export function extractAcroFromForm(json: unknown): AcroField[] {
  const form = json as Partial<FormDefinition>;
  if (!form || !Array.isArray(form.sections)) return [];
  const out: AcroField[] = [];
  const seen = new Set<string>();
  const visit = (f: Field) => {
    const sm = f.sourceMeta as Record<string, unknown> | null;
    const name = typeof sm?.sourceName === 'string' ? (sm.sourceName as string) : null;
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push({
        name,
        id: f.id,
        type: f.type,
        page: typeof sm?.page === 'number' ? (sm.page as number) : undefined,
        sourceMeta: f.sourceMeta ?? undefined,
      });
    }
    f.repeaterConfig?.fields?.forEach(visit);
  };
  for (const s of form.sections as Section[]) {
    s.fields?.forEach(visit);
    s.subsections?.forEach((sub) => sub.fields?.forEach(visit));
  }
  return out;
}
