import { Check, ChevronLeft, ChevronRight, SkipForward, X } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';
import type { Confianza } from '../../lib/etapa0/align';
import type { NombrePropuesto } from '../../lib/etapa0/acroName';
import { nombreEfectivo, type Ediciones } from './TablaCampos';

/**
 * Modo revisión: recorre de a uno SOLO los campos que necesitan atención
 * (confianza media/revisar y los que quedaron sin asignar), con el PDF centrado
 * en el campo. Los controles son los mismos de la tabla —nombre, tipo, fila—
 * así que no hay ninguna función nueva ni ningún cálculo distinto: es la misma
 * edición, con una cosa a la vez adelante.
 */
export default function ModoRevision({
  leaves,
  filasPdf,
  pendientes,
  idx,
  setIdx,
  ediciones,
  setEdiciones,
  confianzaPorLeaf,
  motivosPorLeaf,
  colisiones,
  confirmados,
  onConfirmar,
  onSalir,
}: {
  leaves: PdfLeaf[];
  filasPdf: NombrePropuesto[];
  /** índices de leaf a revisar, en orden de lectura */
  pendientes: number[];
  idx: number;
  setIdx: (n: number) => void;
  ediciones: Ediciones;
  setEdiciones: (fn: (prev: Ediciones) => Ediciones) => void;
  confianzaPorLeaf: Map<string, Confianza>;
  motivosPorLeaf: Map<number, string[]>;
  colisiones: Set<string>;
  confirmados: Set<string>;
  onConfirmar: (leafName: string) => void;
  onSalir: () => void;
}) {
  const total = pendientes.length;
  const i = pendientes[idx];
  const leaf = leaves[i];

  const patch = (p: Partial<Ediciones[number]>) =>
    setEdiciones((prev) => {
      const b = prev[i] ?? { nombreNuevo: '', filaIdx: null, tipo: leaf.ft, manual: false };
      return { ...prev, [i]: { ...b, ...p, manual: true } };
    });

  if (total === 0 || !leaf) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-6 text-center" data-revision-fin>
        <p className="text-sm font-medium text-emerald-800">No queda nada por revisar.</p>
        <p className="text-[11px] text-emerald-700 mt-1">
          Todos los campos están resueltos o confirmados a mano.
        </p>
        <button
          onClick={onSalir}
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-white border border-emerald-300 px-3 py-1.5 text-xs text-emerald-800"
        >
          Volver al resumen
        </button>
      </div>
    );
  }

  const ed = ediciones[i];
  const efectivo = nombreEfectivo(leaf, ed);
  const choca = colisiones.has(efectivo);
  const conf = confianzaPorLeaf.get(leaf.name);
  const motivos = motivosPorLeaf.get(i) ?? [];
  const yaConfirmado = confirmados.has(leaf.name);

  const ir = (d: number) => setIdx(Math.min(total - 1, Math.max(0, idx + d)));

  return (
    <div className="rounded-md border border-slate-200 bg-white" data-revision>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-medium text-slate-700" data-revision-contador>
          Campo {idx + 1} de {total}
        </span>
        <span className="text-[10px] text-slate-400">#{leaf.readingIndex} · pág. {leaf.page + 1}</span>
        <div className="flex-1" />
        <button onClick={onSalir} className="text-slate-400 hover:text-slate-700" title="Salir de la revisión">
          <X size={15} />
        </button>
      </div>

      <div className="px-3 py-3 space-y-2 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="w-16 text-slate-400 shrink-0">Actual</span>
          <span className="font-mono text-slate-600 break-all">{leaf.name}</span>
          {leaf.multiWidgetSospechoso && (
            <span className="rounded bg-amber-100 text-amber-700 px-1 text-[10px]">×{leaf.widgets.length} widgets</span>
          )}
        </div>

        <label className="flex items-center gap-2">
          <span className="w-16 text-slate-400 shrink-0">Nuevo</span>
          <input
            value={ed?.nombreNuevo ?? ''}
            placeholder={leaf.name}
            onChange={(e) => patch({ nombreNuevo: e.target.value })}
            data-revision-nombre
            className={`flex-1 rounded border px-2 py-1 font-mono ${
              choca ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-300'
            }`}
          />
        </label>
        {choca && (
          <p className="text-[11px] text-red-600 pl-[72px]">
            Ya hay otro campo llamado «{efectivo}»: mientras haya colisiones no se puede escribir el PDF.
          </p>
        )}

        <label className="flex items-center gap-2">
          <span className="w-16 text-slate-400 shrink-0">Tipo</span>
          <select
            value={ed?.tipo ?? leaf.ft}
            onChange={(e) => patch({ tipo: e.target.value })}
            className="rounded border border-slate-300 px-1 py-1"
          >
            {['/Tx', '/Btn', '/Ch', '/Sig'].map((t) => (
              <option key={t} value={t}>
                {t.replace('/', '')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="w-16 text-slate-400 shrink-0">Fila</span>
          <select
            value={ed?.filaIdx ?? ''}
            data-revision-fila
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              patch({ filaIdx: v, nombreNuevo: v == null ? '' : filasPdf[v]?.nombre || '' });
            }}
            className="flex-1 min-w-0 rounded border border-slate-300 px-1 py-1"
          >
            <option value="">— sin asignar —</option>
            {filasPdf.map((f, k) => (
              <option key={k} value={k}>
                {f.fila.hoja}·{f.fila.fila} {f.fila.nombrePdf || f.fila.label}
                {f.fila.instancia ? ` (${f.fila.instancia.codigo})` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-start gap-2">
          <span className="w-16 text-slate-400 shrink-0">Confianza</span>
          <div className="min-w-0">
            <span
              className={`rounded px-1 ${
                conf === 'alta'
                  ? 'bg-blue-50 text-blue-700'
                  : conf === 'media'
                    ? 'bg-amber-50 text-amber-700'
                    : conf === 'revisar'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-slate-100 text-slate-500'
              }`}
            >
              {conf ?? 'sin asignar'}
            </span>
            {motivos.length > 0 && (
              <ul className="mt-1 text-[11px] text-slate-500 list-disc pl-4">
                {motivos.map((m, k) => (
                  <li key={k}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
        <button
          onClick={() => onConfirmar(leaf.name)}
          data-revision-confirmar
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${
            yaConfirmado ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          <Check size={14} /> {yaConfirmado ? 'Confirmado' : 'Confirmar'}
        </button>
        <button
          onClick={() => ir(1)}
          data-revision-saltar
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600"
        >
          <SkipForward size={14} /> Saltar
        </button>
        <div className="flex-1" />
        <button
          onClick={() => ir(-1)}
          disabled={idx === 0}
          className="p-1.5 rounded border border-slate-300 disabled:opacity-30"
          title="Anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => ir(1)}
          disabled={idx >= total - 1}
          data-revision-siguiente
          className="p-1.5 rounded border border-slate-300 disabled:opacity-30"
          title="Siguiente"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
