import type { Field, FormDefinition, Section, Subsection } from '../types';

/**
 * Produce the final Signframe form-definition JSON (spec section 9):
 *  - reassign incremental order (1..n) per section / subsection / field
 *  - rebuild childrenOrder from the current visual order
 *  - keep salidaJSON and jsonOutputPath synchronized
 *  - preserve _sourcePdf if present
 */
export function buildExport(form: FormDefinition): FormDefinition {
  const sections: Section[] = form.sections.map((section, si) => {
    const subsections: Subsection[] = section.subsections.map((sub, subi) => {
      const fields: Field[] = sub.fields.map((f, fi) => syncField(f, fi + 1));
      return { ...sub, order: subi + 1, fields };
    });
    const sectionFields: Field[] = section.fields.map((f, fi) => syncField(f, fi + 1));
    return {
      ...section,
      order: si + 1,
      fields: sectionFields,
      subsections,
      childrenOrder: subsections.map((s) => ({ kind: 'subsection' as const, id: s.id })),
    };
  });

  const out: FormDefinition = {
    sections,
    validationRules: form.validationRules ?? [],
    prefillMappings: form.prefillMappings ?? [],
    generatedDocuments: form.generatedDocuments ?? [],
    version: form.version ?? 1,
  };
  if (form._sourcePdf !== undefined) out._sourcePdf = form._sourcePdf;
  return out;
}

/** order must be > 0; salidaJSON and jsonOutputPath must stay in sync. */
function syncField(field: Field, order: number): Field {
  const path = field.salidaJSON ?? field.jsonOutputPath ?? null;
  const synced: Field = {
    ...field,
    order: order > 0 ? order : 1,
    salidaJSON: path,
    jsonOutputPath: path,
  };
  if (field.repeaterConfig) {
    synced.repeaterConfig = {
      ...field.repeaterConfig,
      fields: field.repeaterConfig.fields.map((sub, i) => syncField(sub, i + 1)),
    };
  }
  return synced;
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'form';
}
