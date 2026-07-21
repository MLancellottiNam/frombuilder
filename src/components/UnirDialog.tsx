import { useMemo, useState } from 'react';
import { FileText, Link2, X, Wand2, Search } from 'lucide-react';
import { Modal, Button } from './ui';
import { useStore } from '../store/store';
import { flattenFields, suggest } from '../lib/matching';
import type { AcroField, Field } from '../types';

function BindRow({
  field,
  acroForms,
  onBind,
}: {
  field: Field;
  acroForms: AcroField[];
  onBind: (name: string) => void;
}) {
  const suggestions = useMemo(() => suggest(field, acroForms), [field, acroForms]);
  const [val, setVal] = useState(suggestions[0]?.acro.name ?? '');

  return (
    <div className="border-b border-slate-100 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-700 truncate">
            {field.label}
            {field.radioGroupLabel && <span className="text-[10px] text-indigo-500 ml-1">opción</span>}
          </div>
          {field.salidaJSON && <div className="font-mono text-[10px] text-slate-400 truncate">{field.salidaJSON}</div>}
        </div>
        <input
          list="acro-list"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="sourceName del PDF…"
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        />
        <Button variant="primary" className="!py-1 !px-2 text-xs" disabled={!val} onClick={() => onBind(val)}>
          <Link2 size={13} /> Vincular
        </Button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 ml-1">
          <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
            <Wand2 size={11} /> sugerencias:
          </span>
          {suggestions.map((s) => (
            <button
              key={s.acro.name}
              onClick={() => onBind(s.acro.name)}
              className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100"
              title={`${Math.round(s.score * 100)}% de coincidencia`}
            >
              {s.acro.name} · {Math.round(s.score * 100)}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UnirDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const pdfUrl = useStore((s) => s.pdfUrl);
  const assignSourceName = useStore((s) => s.assignSourceName);
  const [query, setQuery] = useState('');

  const fields = useMemo(() => flattenFields(project.form), [project.form]);
  const bound = fields.filter((f) => f.sourceMeta);
  const unbound = fields.filter((f) => !f.sourceMeta);
  const assignedNames = new Set(bound.map((f) => (f.sourceMeta as Record<string, unknown>).sourceName as string));
  const unusedAcro = project.acroForms.filter((a) => !assignedNames.has(a.name));

  const q = query.toLowerCase();
  const match = (f: Field) =>
    !q ||
    f.label.toLowerCase().includes(q) ||
    (f.salidaJSON ?? '').toLowerCase().includes(q) ||
    f.id.toLowerCase().includes(q);

  const bind = (fieldId: string, name: string) => {
    if (!assignSourceName(fieldId, name)) {
      alert(`No se pudo vincular: ya existe un campo con id "field_${name}". Revisá duplicados.`);
    }
  };

  return (
    <Modal title="Unir con el PDF (Etapa 2)" onClose={onClose} size="full">
      {project.acroForms.length === 0 ? (
        <div className="text-sm text-slate-500 py-6 text-center">
          Todavía no cargaste la lista de AcroForms del PDF. Usá el botón <b>AcroForms</b> en la barra superior para
          importar el xlsx/CSV con los nombres reales.
        </div>
      ) : (
        <>
          <datalist id="acro-list">
            {project.acroForms.map((a) => (
              <option key={a.name} value={a.name} />
            ))}
          </datalist>

          <div className="flex gap-4 text-xs mb-3">
            <span className="text-emerald-600 font-medium">{bound.length} vinculados</span>
            <span className="text-amber-600 font-medium">{unbound.length} sin vincular</span>
            <span className="text-slate-500">{project.acroForms.length} AcroForms</span>
            <span className="text-slate-500">{unusedAcro.length} AcroForms sin usar</span>
          </div>

          <div className="grid grid-cols-2 gap-3" style={{ height: '68vh' }}>
            {/* PDF de referencia */}
            <div className="border border-slate-200 rounded-md flex flex-col min-h-0">
              <div className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-center gap-1">
                <FileText size={13} /> PDF de referencia
              </div>
              {pdfUrl ? (
                <iframe src={pdfUrl} title="PDF" className="flex-1 w-full rounded-b-md" />
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-400 px-4 text-center">
                  Cargá el PDF con el botón <b className="mx-1">PDF</b> de la barra superior para verlo acá.
                </div>
              )}
            </div>

            {/* Vinculación */}
            <div className="border border-slate-200 rounded-md flex flex-col min-h-0">
              <div className="px-2 py-1.5 border-b border-slate-100">
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar campo…"
                    className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-thin">
                {unbound.filter(match).length > 0 && (
                  <div className="px-2 py-1 text-[10px] uppercase font-semibold text-amber-600 bg-amber-50">Sin vincular</div>
                )}
                {unbound.filter(match).map((f) => (
                  <BindRow key={f.id} field={f} acroForms={project.acroForms} onBind={(name) => bind(f.id, name)} />
                ))}

                {bound.filter(match).length > 0 && (
                  <div className="px-2 py-1 text-[10px] uppercase font-semibold text-emerald-600 bg-emerald-50">Vinculados</div>
                )}
                {bound.filter(match).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700">{f.label}</span>
                    <span className="font-mono text-[11px] text-emerald-700 truncate max-w-[220px]">
                      {(f.sourceMeta as Record<string, unknown>).sourceName as string}
                    </span>
                    <button
                      onClick={() => assignSourceName(f.id, null)}
                      className="text-slate-400 hover:text-red-500"
                      title="Quitar vínculo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
