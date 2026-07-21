import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useStore } from '../store/store';
import type { Field, Section, Subsection } from '../types';
import { Button } from './ui';

const WIDTH_LABEL: Record<string, string> = {
  full: '1/1',
  half: '1/2',
  third: '1/3',
  quarter: '1/4',
  fit: 'fit',
};

function FieldCard({ field, subsectionId, option }: { field: Field; subsectionId: string; option?: boolean }) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const removeField = useStore((s) => s.removeField);
  const isSource = !!field.sourceMeta;
  const selected = selection?.kind === 'field' && selection.id === field.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `field:${field.id}`,
    data: { type: 'field', fieldId: field.id, subsectionId },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => select({ kind: 'field', id: field.id })}
      className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 mb-1 bg-white text-sm cursor-pointer ${
        selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
      } ${isDragging ? 'opacity-50' : ''} ${field.hidden ? 'opacity-60' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab text-slate-300 hover:text-slate-500 touch-none"
      >
        <GripVertical size={15} />
      </button>
      {option ? (
        <span className="text-indigo-300 shrink-0 text-xs">◦</span>
      ) : (
        <span className="text-[10px] font-semibold uppercase text-slate-400 w-14 shrink-0">{field.type}</span>
      )}
      <span className="flex-1 truncate text-slate-700">{field.label || <em className="text-slate-400">sin label</em>}</span>
      <span className="text-[10px] text-slate-400 shrink-0">{WIDTH_LABEL[field.width]}</span>
      {isSource ? (
        <span title="Campo del PDF (id y sourceMeta bloqueados)" className="shrink-0">
          <Lock size={12} className="text-amber-500" />
        </span>
      ) : (
        <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500 shrink-0">UI</span>
      )}
      {field.hidden && <EyeOff size={12} className="text-slate-400 shrink-0" />}
      <button
        onClick={(e) => {
          e.stopPropagation();
          removeField(field.id);
        }}
        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 shrink-0"
        title={isSource ? 'Quitar (vuelve al pool)' : 'Eliminar campo'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

type RenderItem =
  | { kind: 'field'; field: Field }
  | { kind: 'group'; label: string; fields: Field[] };

/** Group contiguous fields that share a radioGroupLabel into one question block. */
function groupFields(fields: Field[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (f.radioGroupLabel) {
      if (last && last.kind === 'group' && last.label === f.radioGroupLabel) {
        last.fields.push(f);
      } else {
        out.push({ kind: 'group', label: f.radioGroupLabel, fields: [f] });
      }
    } else {
      out.push({ kind: 'field', field: f });
    }
  }
  return out;
}

/** A desdoblado question rendered compartmentalized: title + nested options. */
function RadioGroupBlock({ label, fields, subsectionId }: { label: string; fields: Field[]; subsectionId: string }) {
  const collapsed = useStore((s) => s.collapsed['rg:' + subsectionId + ':' + label]);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const key = 'rg:' + subsectionId + ':' + label;
  const bound = fields.filter((f) => f.sourceMeta).length;
  return (
    <div className="mb-1 rounded-md border border-indigo-200 bg-indigo-50/40">
      <div className="flex items-center gap-2 px-2 py-1">
        <button onClick={() => toggleCollapse(key)} className="text-indigo-400 hover:text-indigo-600">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="flex-1 truncate text-sm font-medium text-indigo-900">{label}</span>
        <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1 shrink-0">{fields.length} opciones</span>
        <span className="text-[10px] text-slate-400 shrink-0">
          {bound}/{fields.length} PDF
        </span>
      </div>
      {!collapsed && (
        <div className="px-1.5 pb-1.5">
          {fields.map((f) => (
            <FieldCard key={f.id} field={f} subsectionId={subsectionId} option />
          ))}
        </div>
      )}
    </div>
  );
}

function SubsectionNode({ subsection }: { subsection: Subsection }) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const collapsed = useStore((s) => s.collapsed[subsection.id]);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const addUiField = useStore((s) => s.addUiField);
  const removeSubsection = useStore((s) => s.removeSubsection);
  const updateSubsection = useStore((s) => s.updateSubsection);
  const selected = selection?.kind === 'subsection' && selection.id === subsection.id;

  const { setNodeRef, isOver } = useDroppable({
    id: `sub:${subsection.id}`,
    data: { type: 'subsection', subsectionId: subsection.id },
  });

  return (
    <div className={`ml-4 mt-2 rounded-md border ${selected ? 'border-brand-400' : 'border-slate-200'} bg-slate-50/60`}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button onClick={() => toggleCollapse(subsection.id)} className="text-slate-400 hover:text-slate-600">
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <button
          className="flex-1 text-left text-sm font-medium text-slate-600 truncate"
          onClick={() => select({ kind: 'subsection', id: subsection.id })}
        >
          {subsection.title}
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">({subsection.fields.length})</span>
        </button>
        <button
          onClick={() => updateSubsection(subsection.id, { hidden: subsection.hidden ? null : true })}
          className="text-slate-400 hover:text-slate-600"
          title={subsection.hidden ? 'Oculta' : 'Visible'}
        >
          {subsection.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          onClick={() => addUiField('', subsection.id)}
          className="text-slate-400 hover:text-brand-600"
          title="Agregar campo de UI (sin PDF)"
        >
          <Plus size={15} />
        </button>
        <button
          onClick={() => removeSubsection(subsection.id)}
          className="text-slate-400 hover:text-red-500"
          title="Eliminar subsección"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {!collapsed && (
        <div
          ref={setNodeRef}
          className={`px-2 pb-2 min-h-[40px] rounded-b-md transition-colors ${isOver ? 'bg-brand-50' : ''}`}
        >
          <SortableContext items={subsection.fields.map((f) => `field:${f.id}`)} strategy={verticalListSortingStrategy}>
            {groupFields(subsection.fields).map((item, i) =>
              item.kind === 'group' ? (
                <RadioGroupBlock key={`g${i}`} label={item.label} fields={item.fields} subsectionId={subsection.id} />
              ) : (
                <FieldCard key={item.field.id} field={item.field} subsectionId={subsection.id} />
              ),
            )}
          </SortableContext>
          {subsection.fields.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-3 border border-dashed border-slate-200 rounded">
              Arrastrá campos del pool aquí
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SectionNode({ section, index, total }: { section: Section; index: number; total: number }) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const collapsed = useStore((s) => s.collapsed[section.id]);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const addSubsection = useStore((s) => s.addSubsection);
  const removeSection = useStore((s) => s.removeSection);
  const updateSection = useStore((s) => s.updateSection);
  const reorderSection = useStore((s) => s.reorderSection);
  const selected = selection?.kind === 'section' && selection.id === section.id;

  return (
    <div className={`rounded-lg border-2 mb-3 bg-white ${selected ? 'border-brand-500' : 'border-slate-200'}`}>
      <div className="flex items-center gap-1 px-2 py-2 border-b border-slate-100">
        <button onClick={() => toggleCollapse(section.id)} className="text-slate-400 hover:text-slate-600">
          {collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
        </button>
        <button
          className="flex-1 text-left text-sm font-semibold text-slate-800 truncate"
          onClick={() => select({ kind: 'section', id: section.id })}
        >
          {section.title}
        </button>
        <button
          disabled={index === 0}
          onClick={() => reorderSection(section.id, index - 1)}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-20"
          title="Subir"
        >
          <ArrowUp size={14} />
        </button>
        <button
          disabled={index === total - 1}
          onClick={() => reorderSection(section.id, index + 1)}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-20"
          title="Bajar"
        >
          <ArrowDown size={14} />
        </button>
        <button
          onClick={() => updateSection(section.id, { hidden: section.hidden ? null : true })}
          className="text-slate-400 hover:text-slate-600"
          title={section.hidden ? 'Oculta' : 'Visible'}
        >
          {section.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <Button variant="ghost" className="!py-1 !px-1.5" onClick={() => addSubsection(section.id)} title="Agregar subsección">
          <Plus size={15} /> <span className="text-xs">Sub</span>
        </Button>
        <button onClick={() => removeSection(section.id)} className="text-slate-400 hover:text-red-500" title="Eliminar sección">
          <Trash2 size={15} />
        </button>
      </div>
      {!collapsed && (
        <div className="pb-2">
          {section.subsections.map((sub) => (
            <SubsectionNode key={sub.id} subsection={sub} />
          ))}
          {section.subsections.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-3 mx-4 mt-2 border border-dashed border-slate-200 rounded">
              Agregá una subsección para empezar a agrupar campos
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Canvas() {
  const sections = useStore((s) => s.project.form.sections);
  const addSection = useStore((s) => s.addSection);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-700">Mapa del formulario</h2>
        <Button variant="primary" onClick={addSection} className="!py-1 !px-2 text-xs">
          <Plus size={14} /> Sección
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3">
        {sections.length === 0 ? (
          <div className="text-center text-sm text-slate-400 mt-12 px-6">
            <p className="mb-3">No hay secciones todavía.</p>
            <Button variant="primary" onClick={addSection}>
              <Plus size={15} /> Crear primera sección
            </Button>
            <p className="mt-4 text-xs">
              También podés seleccionar campos en el pool y usar “Agrupar” para crear una subsección automáticamente.
            </p>
          </div>
        ) : (
          sections.map((s, i) => <SectionNode key={s.id} section={s} index={i} total={sections.length} />)
        )}
      </div>
    </div>
  );
}
