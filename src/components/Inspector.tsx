import { Lock } from 'lucide-react';
import { useStore } from '../store/store';
import { allFields } from '../lib/validation';
import type { Field, FieldType, FieldWidth } from '../types';
import { Field as FieldRow, TextInput, Select, Checkbox, inputCls } from './ui';
import ConditionEditor from './ConditionEditor';
import OptionsEditor from './OptionsEditor';

const TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'radio', 'checkbox', 'textarea', 'repeater', 'signature'];
const WIDTHS: FieldWidth[] = ['full', 'half', 'third', 'quarter', 'fit'];

function FieldInspector({ field }: { field: Field }) {
  const updateField = useStore((s) => s.updateField);
  const set = (patch: Partial<Field>) => updateField(field.id, patch);
  const isSource = !!field.sourceMeta;
  const hasOptions = field.type === 'select' || field.type === 'radio';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase text-slate-400">Campo</span>
        {isSource ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            <Lock size={11} /> PDF · id/sourceMeta bloqueados
          </span>
        ) : (
          <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Campo de UI</span>
        )}
      </div>

      <FieldRow label="id" hint={isSource ? 'Regla de Oro: no editable' : undefined}>
        <div className="relative">
          <TextInput value={field.id} disabled readOnly className="font-mono !bg-slate-100" />
          {isSource && <Lock size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-500" />}
        </div>
      </FieldRow>

      <FieldRow label="Label">
        <TextInput value={field.label} onChange={(e) => set({ label: e.target.value })} />
      </FieldRow>

      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Tipo">
          <Select value={field.type} onChange={(e) => set({ type: e.target.value as FieldType })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FieldRow>
        <FieldRow label="Ancho">
          <Select value={field.width} onChange={(e) => set({ width: e.target.value as FieldWidth })}>
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-x-3">
        <Checkbox label="Requerido" checked={field.required} onChange={(v) => set({ required: v })} />
        <Checkbox label="Solo lectura" checked={field.readOnly} onChange={(v) => set({ readOnly: v })} />
        <Checkbox label="Oculto (hidden)" checked={field.hidden === true} onChange={(v) => set({ hidden: v ? true : null })} />
        <Checkbox label="Excluir del JSON" checked={field.excludeFromJson} onChange={(v) => set({ excludeFromJson: v })} />
      </div>

      <FieldRow label="salidaJSON (path destino)" hint="Se sincroniza con jsonOutputPath.">
        <TextInput
          value={field.salidaJSON ?? ''}
          disabled={field.excludeFromJson}
          onChange={(e) => set({ salidaJSON: e.target.value || null })}
          placeholder="p.ej. solicitante.nombre"
          className="font-mono"
        />
      </FieldRow>

      {(field.salidaJSONSecundaria || field.type === 'select' || field.type === 'radio') && (
        <FieldRow label="salidaJSONSecundaria (2do path: descripción)" hint="Ej. código en salidaJSON + descripción acá.">
          <TextInput
            value={field.salidaJSONSecundaria ?? ''}
            onChange={(e) => set({ salidaJSONSecundaria: e.target.value || null })}
            placeholder="p.ej. encabezado.descripcionTipoTramite"
            className="font-mono"
          />
        </FieldRow>
      )}

      {field.type === 'checkbox' && (
        <FieldRow label="checkedPdfValue" hint="Para campos del PDF debe ser true (nunca 'X').">
          <Select
            value={field.checkedPdfValue === true ? 'true' : field.checkedPdfValue == null ? 'null' : 'other'}
            onChange={(e) => set({ checkedPdfValue: e.target.value === 'true' ? true : null })}
          >
            <option value="true">true</option>
            <option value="null">null</option>
          </Select>
        </FieldRow>
      )}

      {field.type === 'number' && (
        <FieldRow label="jsonNumberFormat" hint='Montos CR: "#.##0,00"'>
          <TextInput value={field.jsonNumberFormat ?? ''} onChange={(e) => set({ jsonNumberFormat: e.target.value || null })} />
        </FieldRow>
      )}
      {field.type === 'date' && (
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="jsonDateFormat">
            <TextInput value={field.jsonDateFormat ?? ''} onChange={(e) => set({ jsonDateFormat: e.target.value || null })} placeholder="DD/MM/YYYY" />
          </FieldRow>
          <FieldRow label="defaultValue">
            <TextInput value={String(field.defaultValue ?? '')} onChange={(e) => set({ defaultValue: e.target.value || null })} placeholder="today" />
          </FieldRow>
        </div>
      )}

      {hasOptions && (
        <>
          <span className="block text-xs font-medium text-slate-600 mb-1">Opciones</span>
          <OptionsEditor options={field.options} onChange={(options) => set({ options })} />
        </>
      )}

      <span className="block text-xs font-medium text-slate-600 mb-1 mt-2">Visibilidad condicional</span>
      <ConditionEditor value={field.conditionalVisibility} onChange={(v) => set({ conditionalVisibility: v })} currentFieldId={field.id} />

      <span className="block text-xs font-medium text-slate-600 mb-1">Requerido condicional</span>
      <ConditionEditor value={field.conditionalRequired} onChange={(v) => set({ conditionalRequired: v })} currentFieldId={field.id} />

      {isSource && (
        <FieldRow label="sourceMeta (solo lectura)">
          <textarea
            readOnly
            value={JSON.stringify(field.sourceMeta, null, 2)}
            className={`${inputCls} font-mono text-[11px] !bg-slate-100 h-24`}
          />
        </FieldRow>
      )}
    </div>
  );
}

export default function Inspector() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const updateSection = useStore((s) => s.updateSection);
  const updateSubsection = useStore((s) => s.updateSubsection);

  let body: React.ReactNode = (
    <p className="text-xs text-slate-400 text-center mt-8 px-4">
      Seleccioná un campo, subsección o sección para editar sus propiedades.
    </p>
  );

  if (selection?.kind === 'field') {
    const ref = allFields(project).find((r) => r.field.id === selection.id);
    if (ref) body = <FieldInspector field={ref.field} />;
  } else if (selection?.kind === 'section') {
    const section = project.form.sections.find((s) => s.id === selection.id);
    if (section) {
      body = (
        <div>
          <span className="text-[10px] font-semibold uppercase text-slate-400">Sección</span>
          <FieldRow label="Título">
            <TextInput value={section.title} onChange={(e) => updateSection(section.id, { title: e.target.value })} />
          </FieldRow>
          <FieldRow label="Descripción">
            <TextInput value={section.description ?? ''} onChange={(e) => updateSection(section.id, { description: e.target.value || null })} />
          </FieldRow>
          <FieldRow label="Instrucciones">
            <TextInput value={section.instructions ?? ''} onChange={(e) => updateSection(section.id, { instructions: e.target.value || null })} />
          </FieldRow>
          <Checkbox label="Oculta" checked={section.hidden === true} onChange={(v) => updateSection(section.id, { hidden: v ? true : null })} />
        </div>
      );
    }
  } else if (selection?.kind === 'subsection') {
    const sub = project.form.sections.flatMap((s) => s.subsections).find((ss) => ss.id === selection.id);
    if (sub) {
      body = (
        <div>
          <span className="text-[10px] font-semibold uppercase text-slate-400">Subsección</span>
          <FieldRow label="Título">
            <TextInput value={sub.title} onChange={(e) => updateSubsection(sub.id, { title: e.target.value })} />
          </FieldRow>
          <FieldRow label="Descripción">
            <TextInput value={sub.description ?? ''} onChange={(e) => updateSubsection(sub.id, { description: e.target.value || null })} />
          </FieldRow>
          <Checkbox label="Oculta (sistema/slots)" checked={sub.hidden === true} onChange={(v) => updateSubsection(sub.id, { hidden: v ? true : null })} />
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-700">Inspector</h2>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3">{body}</div>
    </div>
  );
}
