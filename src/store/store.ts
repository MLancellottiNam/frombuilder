import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  Field,
  FieldType,
  FormDefinition,
  IdConvention,
  Project,
  Section,
  SourceField,
  Subsection,
} from '../types';
import {
  emptyForm,
  fieldFromSource,
  newSection,
  newSubsection,
  newUiField,
} from '../lib/factory';
import { detectConventionFromField } from '../lib/idConvention';

export type Selection =
  | { kind: 'field'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'subsection'; id: string }
  | null;

interface StoreState {
  project: Project;
  selection: Selection;
  collapsed: Record<string, boolean>;

  // --- source / import ---
  loadSourceFields: (fields: SourceField[], convention: IdConvention) => void;
  loadMatrix: (fields: SourceField[], convention: IdConvention) => void;
  createEmptyStructure: (groups: { section: string; subsections: string[] }[]) => void;
  importForm: (form: FormDefinition, sourceFields?: SourceField[]) => void;
  loadProject: (project: Project) => void;
  resetProject: () => void;
  setProjectName: (name: string) => void;

  // --- structure ---
  addSection: () => string;
  addSubsection: (sectionId: string) => string;
  addUiField: (sectionId: string, subsectionId: string, type?: FieldType) => string;
  placeSourceField: (
    sourceName: string,
    sectionId: string,
    subsectionId: string,
    index?: number,
  ) => void;
  groupSourceFields: (sourceNames: string[], sectionId?: string) => void;

  // --- drag & drop moves ---
  moveField: (fieldId: string, targetSubsectionId: string, index: number) => void;
  moveSubsection: (subsectionId: string, targetSectionId: string, index: number) => void;
  reorderSection: (sectionId: string, index: number) => void;

  // --- edits ---
  updateField: (fieldId: string, patch: Partial<Field>) => void;
  updateSection: (sectionId: string, patch: Partial<Section>) => void;
  updateSubsection: (subsectionId: string, patch: Partial<Subsection>) => void;

  // --- removals ---
  removeField: (fieldId: string) => void;
  removeSection: (sectionId: string) => void;
  removeSubsection: (subsectionId: string) => void;

  // --- ui ---
  select: (sel: Selection) => void;
  toggleCollapse: (id: string) => void;
}

function initialProject(): Project {
  return {
    name: 'form',
    sourceFields: [],
    idConvention: 'exact',
    form: emptyForm(),
    pool: [],
  };
}

// --- immutable tree helpers ------------------------------------------------

function mapSections(
  form: FormDefinition,
  fn: (s: Section, i: number) => Section,
): FormDefinition {
  return { ...form, sections: form.sections.map(fn) };
}

function findFieldLocation(
  form: FormDefinition,
  fieldId: string,
): { sectionIdx: number; subIdx: number; fieldIdx: number } | null {
  for (let si = 0; si < form.sections.length; si++) {
    const section = form.sections[si];
    for (let sub = 0; sub < section.subsections.length; sub++) {
      const fi = section.subsections[sub].fields.findIndex((f) => f.id === fieldId);
      if (fi >= 0) return { sectionIdx: si, subIdx: sub, fieldIdx: fi };
    }
  }
  return null;
}

function extractField(form: FormDefinition, fieldId: string): { form: FormDefinition; field: Field } | null {
  const loc = findFieldLocation(form, fieldId);
  if (!loc) return null;
  const section = form.sections[loc.sectionIdx];
  const sub = section.subsections[loc.subIdx];
  const field = sub.fields[loc.fieldIdx];
  const newForm = mapSections(form, (s, i) => {
    if (i !== loc.sectionIdx) return s;
    return {
      ...s,
      subsections: s.subsections.map((ss, j) =>
        j === loc.subIdx ? { ...ss, fields: ss.fields.filter((f) => f.id !== fieldId) } : ss,
      ),
    };
  });
  return { form: newForm, field };
}

function insertField(
  form: FormDefinition,
  subsectionId: string,
  field: Field,
  index: number,
): FormDefinition {
  return mapSections(form, (s) => ({
    ...s,
    subsections: s.subsections.map((ss) => {
      if (ss.id !== subsectionId) return ss;
      const fields = [...ss.fields];
      const clamped = Math.max(0, Math.min(index, fields.length));
      fields.splice(clamped, 0, field);
      return { ...ss, fields };
    }),
  }));
}

function firstSubsectionTarget(form: FormDefinition): { sectionId: string; subsectionId: string } | null {
  for (const s of form.sections) {
    if (s.subsections.length > 0) return { sectionId: s.id, subsectionId: s.subsections[0].id };
  }
  return null;
}

function sourceNameOf(field: Field): string | null {
  const sm = field.sourceMeta as Record<string, unknown> | null;
  return typeof sm?.sourceName === 'string' ? (sm.sourceName as string) : null;
}

// --- store -----------------------------------------------------------------

export const useStore = create<StoreState>((set, get) => ({
  project: initialProject(),
  selection: null,
  collapsed: {},

  loadSourceFields: (fields, convention) =>
    set((state) => {
      // Merge with any already-placed fields; pool = names not yet placed.
      const placed = new Set<string>();
      for (const s of state.project.form.sections) {
        for (const sub of s.subsections) {
          for (const f of sub.fields) {
            const sn = sourceNameOf(f);
            if (sn) placed.add(sn);
          }
        }
      }
      const pool = fields.map((f) => f.sourceName).filter((n) => !placed.has(n));
      return {
        project: { ...state.project, sourceFields: fields, idConvention: convention, pool },
      };
    }),

  loadMatrix: (fields, convention) =>
    set((state) => {
      // Merge matrix candidates with any existing sourceFields (union by name).
      const byName = new Map<string, SourceField>();
      for (const f of state.project.sourceFields) byName.set(f.sourceName, f);
      for (const f of fields) byName.set(f.sourceName, { ...byName.get(f.sourceName), ...f });
      const merged = Array.from(byName.values());

      const placed = new Set<string>();
      for (const s of state.project.form.sections) {
        for (const sub of s.subsections) {
          for (const f of sub.fields) {
            const sn = sourceNameOf(f);
            if (sn) placed.add(sn);
          }
        }
      }
      const pool = merged.map((f) => f.sourceName).filter((n) => !placed.has(n));
      return { project: { ...state.project, sourceFields: merged, idConvention: convention, pool } };
    }),

  createEmptyStructure: (groups) =>
    set((state) => {
      let form = state.project.form;
      for (const g of groups) {
        let section = form.sections.find((s) => s.title === g.section);
        if (!section) {
          section = {
            id: 'section_' + nanoid(8),
            title: g.section,
            description: null,
            instructions: null,
            conditionalVisibility: null,
            order: form.sections.length + 1,
            hidden: null,
            fields: [],
            subsections: [],
            childrenOrder: [],
          };
          form = { ...form, sections: [...form.sections, section] };
        }
        const secId = section.id;
        for (const subTitle of g.subsections) {
          form = mapSections(form, (s) => {
            if (s.id !== secId) return s;
            if (s.subsections.some((ss) => ss.title === subTitle)) return s;
            const sub = newSubsection(s.subsections.length + 1, subTitle);
            return {
              ...s,
              subsections: [...s.subsections, sub],
              childrenOrder: [...s.childrenOrder, { kind: 'subsection', id: sub.id }],
            };
          });
        }
      }
      return { project: { ...state.project, form } };
    }),

  importForm: (form, sourceFields) =>
    set((state) => {
      // Derive sourceFields from the form if not supplied.
      const derived: SourceField[] = [];
      const seen = new Set<string>();
      let convention: IdConvention = state.project.idConvention;
      for (const section of form.sections) {
        for (const sub of section.subsections) {
          for (const f of sub.fields) {
            const sn = sourceNameOf(f);
            if (sn && !seen.has(sn)) {
              seen.add(sn);
              const sm = f.sourceMeta as Record<string, unknown>;
              derived.push({
                sourceName: sn,
                page: typeof sm.page === 'number' ? (sm.page as number) : undefined,
                nativeType: typeof sm.nativeType === 'string' ? (sm.nativeType as string) : undefined,
                label: f.label,
              });
              const det = detectConventionFromField(f.id, sn);
              if (det) convention = det;
            }
          }
        }
      }
      const finalSources = sourceFields ?? derived;
      const placed = new Set(seen);
      const pool = finalSources.map((s) => s.sourceName).filter((n) => !placed.has(n));
      return {
        project: {
          ...state.project,
          form,
          sourceFields: finalSources,
          idConvention: convention,
          pool,
        },
        selection: null,
      };
    }),

  loadProject: (project) => set({ project, selection: null }),
  resetProject: () => set({ project: initialProject(), selection: null, collapsed: {} }),
  setProjectName: (name) => set((s) => ({ project: { ...s.project, name } })),

  addSection: () => {
    const section = newSection(get().project.form.sections.length + 1);
    set((state) => ({
      project: {
        ...state.project,
        form: { ...state.project.form, sections: [...state.project.form.sections, section] },
      },
      selection: { kind: 'section', id: section.id },
    }));
    return section.id;
  },

  addSubsection: (sectionId) => {
    const sub = newSubsection(1);
    set((state) => ({
      project: {
        ...state.project,
        form: mapSections(state.project.form, (s) =>
          s.id === sectionId
            ? {
                ...s,
                subsections: [...s.subsections, sub],
                childrenOrder: [...s.childrenOrder, { kind: 'subsection', id: sub.id }],
              }
            : s,
        ),
      },
      selection: { kind: 'subsection', id: sub.id },
    }));
    return sub.id;
  },

  addUiField: (_sectionId, subsectionId, type = 'text') => {
    const field = newUiField(1, type);
    set((state) => ({
      project: {
        ...state.project,
        form: mapSections(state.project.form, (s) => ({
          ...s,
          subsections: s.subsections.map((ss) =>
            ss.id === subsectionId ? { ...ss, fields: [...ss.fields, field] } : ss,
          ),
        })),
      },
      selection: { kind: 'field', id: field.id },
    }));
    return field.id;
  },

  placeSourceField: (sourceName, _sectionId, subsectionId, index) =>
    set((state) => {
      const src = state.project.sourceFields.find((s) => s.sourceName === sourceName);
      if (!src) return state;
      // Count current fields for order.
      const field = fieldFromSource(src, state.project.idConvention, 1);
      const idx =
        index ??
        state.project.form.sections
          .flatMap((s) => s.subsections)
          .find((ss) => ss.id === subsectionId)?.fields.length ??
        0;
      const form = insertField(state.project.form, subsectionId, field, idx);
      return {
        project: {
          ...state.project,
          form,
          pool: state.project.pool.filter((n) => n !== sourceName),
        },
        selection: { kind: 'field', id: field.id },
      };
    }),

  groupSourceFields: (sourceNames, sectionId) =>
    set((state) => {
      let form = state.project.form;
      let targetSectionId = sectionId;
      // Ensure a section exists.
      if (!targetSectionId || !form.sections.some((s) => s.id === targetSectionId)) {
        const section = newSection(form.sections.length + 1);
        // start empty (no default subsection) so grouping is clean
        section.subsections = [];
        section.childrenOrder = [];
        form = { ...form, sections: [...form.sections, section] };
        targetSectionId = section.id;
      }
      const sub = newSubsection(1, 'Grupo');
      form = mapSections(form, (s) =>
        s.id === targetSectionId
          ? {
              ...s,
              subsections: [...s.subsections, sub],
              childrenOrder: [...s.childrenOrder, { kind: 'subsection', id: sub.id }],
            }
          : s,
      );
      let order = 1;
      for (const name of sourceNames) {
        const src = state.project.sourceFields.find((s) => s.sourceName === name);
        if (!src) continue;
        const field = fieldFromSource(src, state.project.idConvention, order++);
        form = insertField(form, sub.id, field, 1e9);
      }
      return {
        project: {
          ...state.project,
          form,
          pool: state.project.pool.filter((n) => !sourceNames.includes(n)),
        },
        selection: { kind: 'subsection', id: sub.id },
      };
    }),

  moveField: (fieldId, targetSubsectionId, index) =>
    set((state) => {
      const extracted = extractField(state.project.form, fieldId);
      if (!extracted) return state;
      const form = insertField(extracted.form, targetSubsectionId, extracted.field, index);
      return { project: { ...state.project, form } };
    }),

  moveSubsection: (subsectionId, targetSectionId, index) =>
    set((state) => {
      let sub: Subsection | null = null;
      // remove from current section
      let form = mapSections(state.project.form, (s) => {
        const found = s.subsections.find((ss) => ss.id === subsectionId);
        if (found) sub = found;
        return {
          ...s,
          subsections: s.subsections.filter((ss) => ss.id !== subsectionId),
          childrenOrder: s.childrenOrder.filter((c) => c.id !== subsectionId),
        };
      });
      if (!sub) return state;
      form = mapSections(form, (s) => {
        if (s.id !== targetSectionId) return s;
        const subs = [...s.subsections];
        const clamped = Math.max(0, Math.min(index, subs.length));
        subs.splice(clamped, 0, sub!);
        return {
          ...s,
          subsections: subs,
          childrenOrder: subs.map((x) => ({ kind: 'subsection', id: x.id })),
        };
      });
      return { project: { ...state.project, form } };
    }),

  reorderSection: (sectionId, index) =>
    set((state) => {
      const sections = [...state.project.form.sections];
      const from = sections.findIndex((s) => s.id === sectionId);
      if (from < 0) return state;
      const [moved] = sections.splice(from, 1);
      const clamped = Math.max(0, Math.min(index, sections.length));
      sections.splice(clamped, 0, moved);
      return { project: { ...state.project, form: { ...state.project.form, sections } } };
    }),

  updateField: (fieldId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        form: mapSections(state.project.form, (s) => ({
          ...s,
          fields: s.fields.map((f) => (f.id === fieldId ? applyFieldPatch(f, patch) : f)),
          subsections: s.subsections.map((ss) => ({
            ...ss,
            fields: ss.fields.map((f) => (f.id === fieldId ? applyFieldPatch(f, patch) : f)),
          })),
        })),
      },
    })),

  updateSection: (sectionId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        form: mapSections(state.project.form, (s) => (s.id === sectionId ? { ...s, ...patch } : s)),
      },
    })),

  updateSubsection: (subsectionId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        form: mapSections(state.project.form, (s) => ({
          ...s,
          subsections: s.subsections.map((ss) =>
            ss.id === subsectionId ? { ...ss, ...patch } : ss,
          ),
        })),
      },
    })),

  removeField: (fieldId) =>
    set((state) => {
      const loc = findFieldLocation(state.project.form, fieldId);
      if (!loc) return state;
      const field =
        state.project.form.sections[loc.sectionIdx].subsections[loc.subIdx].fields[loc.fieldIdx];
      const sn = sourceNameOf(field);
      const extracted = extractField(state.project.form, fieldId);
      if (!extracted) return state;
      // Source-derived fields return to the pool; UI fields are deleted.
      const pool = sn && !state.project.pool.includes(sn) ? [...state.project.pool, sn] : state.project.pool;
      return {
        project: { ...state.project, form: extracted.form, pool },
        selection: state.selection?.kind === 'field' && state.selection.id === fieldId ? null : state.selection,
      };
    }),

  removeSection: (sectionId) =>
    set((state) => {
      // Return any source fields inside to the pool.
      const section = state.project.form.sections.find((s) => s.id === sectionId);
      const returned: string[] = [];
      section?.subsections.forEach((ss) =>
        ss.fields.forEach((f) => {
          const sn = sourceNameOf(f);
          if (sn) returned.push(sn);
        }),
      );
      const pool = [...state.project.pool];
      returned.forEach((n) => !pool.includes(n) && pool.push(n));
      return {
        project: {
          ...state.project,
          form: { ...state.project.form, sections: state.project.form.sections.filter((s) => s.id !== sectionId) },
          pool,
        },
        selection: null,
      };
    }),

  removeSubsection: (subsectionId) =>
    set((state) => {
      const returned: string[] = [];
      state.project.form.sections.forEach((s) =>
        s.subsections.forEach((ss) => {
          if (ss.id === subsectionId) {
            ss.fields.forEach((f) => {
              const sn = sourceNameOf(f);
              if (sn) returned.push(sn);
            });
          }
        }),
      );
      const pool = [...state.project.pool];
      returned.forEach((n) => !pool.includes(n) && pool.push(n));
      return {
        project: {
          ...state.project,
          form: mapSections(state.project.form, (s) => ({
            ...s,
            subsections: s.subsections.filter((ss) => ss.id !== subsectionId),
            childrenOrder: s.childrenOrder.filter((c) => c.id !== subsectionId),
          })),
          pool,
        },
        selection: null,
      };
    }),

  select: (sel) => set({ selection: sel }),
  toggleCollapse: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
}));

/**
 * Guard the Regla de Oro: never let a patch mutate a source-derived field's
 * id or sourceMeta.
 */
function applyFieldPatch(field: Field, patch: Partial<Field>): Field {
  const next = { ...field, ...patch };
  if (field.sourceMeta) {
    next.id = field.id;
    next.sourceMeta = field.sourceMeta;
  }
  // Keep the two output-path keys in sync whenever either changes.
  if ('salidaJSON' in patch && !('jsonOutputPath' in patch)) {
    next.jsonOutputPath = patch.salidaJSON ?? null;
  }
  if ('jsonOutputPath' in patch && !('salidaJSON' in patch)) {
    next.salidaJSON = patch.jsonOutputPath ?? null;
  }
  return next;
}

export { firstSubsectionTarget, sourceNameOf };
