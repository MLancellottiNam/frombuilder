import type { Field, Project } from '../types';
import { fieldIdFor } from './idConvention';
import { isValidConditionJson, referencedFieldIds } from './conditions';

export interface ValidationItem {
  fieldId?: string;
  label: string;
  detail?: string;
}

export interface ValidationRule {
  key: string;
  title: string;
  ok: boolean;
  count: number; // number of failing items
  items: ValidationItem[];
  /** informational rules (e.g. coverage) are not counted as errors */
  info?: boolean;
}

export interface FieldRef {
  field: Field;
  sectionId: string;
  subsectionId: string | null;
}

/** Walk every Field in the form (section-level and subsection-level). */
export function allFields(project: Project): FieldRef[] {
  const out: FieldRef[] = [];
  for (const section of project.form.sections) {
    for (const f of section.fields) {
      out.push({ field: f, sectionId: section.id, subsectionId: null });
    }
    for (const sub of section.subsections) {
      for (const f of sub.fields) {
        out.push({ field: f, sectionId: section.id, subsectionId: sub.id });
      }
    }
  }
  return out;
}

function sourceName(f: Field): string | null {
  const sm = f.sourceMeta as Record<string, unknown> | null;
  const n = sm?.sourceName;
  return typeof n === 'string' ? n : null;
}

export function runValidations(project: Project): ValidationRule[] {
  const refs = allFields(project);
  const rules: ValidationRule[] = [];
  const csvNames = new Set(project.sourceFields.map((s) => s.sourceName));

  // 1. Every used sourceName exists in the loaded CSV.
  {
    const items: ValidationItem[] = [];
    for (const { field } of refs) {
      const sn = sourceName(field);
      if (sn && !csvNames.has(sn)) {
        items.push({ fieldId: field.id, label: field.label, detail: `sourceName "${sn}" no está en el CSV` });
      }
    }
    rules.push({ key: 'source-exists', title: 'sourceName existentes en el CSV', ok: items.length === 0, count: items.length, items });
  }

  // 2. id == "field_" + applyConvention(sourceName) for every field with sourceMeta.
  {
    const items: ValidationItem[] = [];
    for (const { field } of refs) {
      const sn = sourceName(field);
      if (!sn) continue;
      const expected = fieldIdFor(sn, project.idConvention);
      if (field.id !== expected) {
        items.push({ fieldId: field.id, label: field.label, detail: `id "${field.id}" ≠ esperado "${expected}"` });
      }
    }
    rules.push({ key: 'id-alignment', title: 'id alineado con sourceName (Regla de Oro)', ok: items.length === 0, count: items.length, items });
  }

  // 3. No duplicate ids in the whole tree (including repeater sub-fields).
  {
    const counts = new Map<string, number>();
    const collect = (f: Field) => {
      counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
      f.repeaterConfig?.fields.forEach(collect);
    };
    refs.forEach((r) => collect(r.field));
    const items: ValidationItem[] = [];
    for (const [id, c] of counts) {
      if (c > 1) items.push({ fieldId: id, label: id, detail: `aparece ${c} veces` });
    }
    rules.push({ key: 'no-dup-ids', title: 'Sin ids duplicados', ok: items.length === 0, count: items.length, items });
  }

  // 4. Coverage (informational): which CSV fields are placed vs still in pool.
  {
    const placed = new Set<string>();
    for (const { field } of refs) {
      const sn = sourceName(field);
      if (sn) placed.add(sn);
    }
    const unplaced = project.sourceFields.filter((s) => !placed.has(s.sourceName));
    const items = unplaced.map((s) => ({ label: s.sourceName, detail: 'sin ubicar' }));
    rules.push({
      key: 'coverage',
      title: `Cobertura: ${placed.size}/${project.sourceFields.length} campos ubicados`,
      ok: unplaced.length === 0,
      count: unplaced.length,
      items,
      info: true,
    });
  }

  // 5. order > 0 for all.
  {
    const items: ValidationItem[] = [];
    for (const { field } of refs) {
      if (!(field.order > 0)) {
        items.push({ fieldId: field.id, label: field.label, detail: `order = ${field.order}` });
      }
    }
    rules.push({ key: 'order-positive', title: 'order > 0 en todos los campos', ok: items.length === 0, count: items.length, items });
  }

  // 6. Checkboxes with sourceMeta: no "X" — must be true.
  {
    const items: ValidationItem[] = [];
    for (const { field } of refs) {
      if (field.type === 'checkbox' && field.sourceMeta && field.checkedPdfValue !== true) {
        items.push({ fieldId: field.id, label: field.label, detail: `checkedPdfValue debe ser true (es ${JSON.stringify(field.checkedPdfValue)})` });
      }
    }
    rules.push({ key: 'checkbox-true', title: 'Checkboxes del PDF con checkedPdfValue: true', ok: items.length === 0, count: items.length, items });
  }

  // 7. conditionalVisibility / conditionalRequired parse as JSON and reference existing ids.
  {
    const allIds = new Set(refs.map((r) => r.field.id));
    allIds.add('field_NEVER_EXISTS'); // sentinel used for "always hidden"
    const items: ValidationItem[] = [];
    for (const { field } of refs) {
      for (const [key, raw] of [
        ['conditionalVisibility', field.conditionalVisibility],
        ['conditionalRequired', field.conditionalRequired],
      ] as const) {
        if (!isValidConditionJson(raw)) {
          items.push({ fieldId: field.id, label: field.label, detail: `${key} no es JSON válido` });
          continue;
        }
        for (const refId of referencedFieldIds(raw)) {
          if (!allIds.has(refId)) {
            items.push({ fieldId: field.id, label: field.label, detail: `${key} referencia id inexistente "${refId}"` });
          }
        }
      }
    }
    rules.push({ key: 'conditions-valid', title: 'Condiciones válidas y con ids existentes', ok: items.length === 0, count: items.length, items });
  }

  return rules;
}

export function errorCount(rules: ValidationRule[]): number {
  return rules.filter((r) => !r.info).reduce((n, r) => n + (r.ok ? 0 : 1), 0);
}
