import { useEffect, useRef, useState } from 'react';
import { Check, Split, Trash2, X } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';
import type { Confianza } from '../../lib/etapa0/align';
import type { NombrePropuesto } from '../../lib/etapa0/acroName';
import { nombreEfectivo, type Ediciones } from './TablaCampos';

const ESTADO: Record<Confianza, { texto: string; clase: string }> = {
  alta: { texto: 'listo', clase: 'bg-blue-50 text-blue-700' },
  media: { texto: 'revisar', clase: 'bg-amber-50 text-amber-700' },
  revisar: { texto: 'revisar', clase: 'bg-amber-50 text-amber-700' },
};

/**
 * Ficha del campo seleccionado. Es la respuesta al click: en vez de tener que
 * encontrar la fila entre 111, el campo que se tocó —en el PDF o en la tabla—
 * se abre acá con lo único que hay que decidir.
 *
 * El control primario es la FILA de la ficha, con buscador: elegir la fila
 * propone el nombre, que es el camino correcto. El nombre igual se puede
 * escribir a mano para los casos que no salen de ninguna fila.
 */
export default function PanelCampo({
  leaf,
  idx,
  filasPdf,
  ediciones,
  setEdiciones,
  confianza,
  motivos,
  colisiones,
  confirmado,
  etiquetaImpresa,
  onConfirmar,
  onBorrar,
  onReemplazarPorN,
  onCerrar,
}: {
  leaf: PdfLeaf;
  /** índice del campo en la lista efectiva */
  idx: number;
  filasPdf: NombrePropuesto[];
  ediciones: Ediciones;
  setEdiciones: (fn: (prev: Ediciones) => Ediciones) => void;
  confianza?: Confianza;
  motivos: string[];
  colisiones: Set<string>;
  confirmado: boolean;
  /** lo que el PDF tiene impreso al lado del campo (izquierda / derecha) */
  etiquetaImpresa?: { izq: string; der: string };
  onConfirmar: (leafName: string) => void;
  onBorrar: (i: number) => void;
  onReemplazarPorN: (i: number, n: number) => void;
  onCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const caja = useRef<HTMLDivElement>(null);

  // La ficha se abre arriba de la columna: si la columna venía scrolleada, hay
  // que traerla a la vista o el click parece no haber hecho nada.
  useEffect(() => {
    caja.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [idx]);

  const ed = ediciones[idx];
  const efectivo = nombreEfectivo(leaf, ed);
  const choca = colisiones.has(efectivo);
  const estado = confianza ? ESTADO[confianza] : null;

  const patch = (p: Partial<Ediciones[number]>) =>
    setEdiciones((prev) => {
      const b = prev[idx] ?? { nombreNuevo: '', filaIdx: null, tipo: leaf.ft, manual: false };
      return { ...prev, [idx]: { ...b, ...p, manual: true } };
    });

  const q = busqueda.toLowerCase();
  const visibles = (
    q
      ? filasPdf
          .map((np, k) => ({ np, k }))
          .filter(({ np }) =>
            `${np.fila.hoja} ${np.fila.fila} ${np.fila.nombrePdf} ${np.fila.label} ${np.nombre}`
              .toLowerCase()
              .includes(q),
          )
      : filasPdf.map((np, k) => ({ np, k }))
  ).slice(0, 400);

  const impresa = [etiquetaImpresa?.izq, etiquetaImpresa?.der].filter(Boolean).join('  ·  ');

  return (
    <div ref={caja} className="rounded-md border border-brand-300 bg-white" data-panel-campo>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-medium text-slate-700">Campo seleccionado</span>
        <span className="text-[10px] text-slate-400">
          #{leaf.readingIndex} · pág. {leaf.page + 1}
          {leaf.origen === 'creado' ? ' · creado a mano' : ''}
        </span>
        {estado && <span className={`rounded px-1 text-[10px] ${estado.clase}`}>{estado.texto}</span>}
        {!estado && <span className="rounded px-1 text-[10px] bg-slate-100 text-slate-500">sin fila</span>}
        {choca && <span className="rounded px-1 text-[10px] bg-red-50 text-red-600">nombre repetido</span>}
        <div className="flex-1" />
        <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700" title="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-2 text-xs">
        {impresa && (
          <div className="flex items-baseline gap-2">
            <span className="w-20 text-slate-400 shrink-0">En el PDF dice</span>
            <span className="text-slate-700" data-panel-impresa>
              «{impresa}»
            </span>
          </div>
        )}

        <div className="flex items-start gap-2">
          <span className="w-20 text-slate-400 shrink-0 pt-1">Sale de la fila</span>
          <div className="flex-1 min-w-0">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={`Buscar entre ${filasPdf.length} filas de la ficha…`}
              data-panel-buscar
              className="w-full rounded border border-slate-300 px-2 py-1 mb-1"
            />
            <select
              value={ed?.filaIdx ?? ''}
              data-panel-fila
              size={5}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                patch({ filaIdx: v, nombreNuevo: v == null ? '' : filasPdf[v]?.nombre || '' });
              }}
              className="w-full rounded border border-slate-300 px-1 py-0.5"
            >
              <option value="">— ninguna (el campo queda con su nombre actual) —</option>
              {visibles.map(({ np, k }) => (
                <option key={k} value={k}>
                  {np.fila.hoja}·{np.fila.fila} {np.fila.nombrePdf || np.fila.label}
                  {np.fila.instancia ? ` (${np.fila.instancia.codigo})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-0.5">Elegir la fila propone el nombre.</p>
          </div>
        </div>

        <label className="flex items-center gap-2">
          <span className="w-20 text-slate-400 shrink-0">Se va a llamar</span>
          <input
            value={ed?.nombreNuevo ?? ''}
            placeholder={leaf.name}
            onChange={(e) => patch({ nombreNuevo: e.target.value })}
            data-panel-nombre
            className={`flex-1 min-w-0 rounded border px-2 py-1 font-mono ${
              choca ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-300'
            }`}
          />
        </label>
        {choca && (
          <p className="text-[11px] text-red-600 pl-[88px]">
            Ya hay otro campo llamado «{efectivo}»: mientras haya nombres repetidos no se puede escribir el PDF.
          </p>
        )}

        {motivos.length > 0 && (
          <details className="pl-[88px]">
            <summary className="cursor-pointer text-[10px] text-slate-400">¿Por qué esta fila?</summary>
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-slate-500">
              {motivos.map((m, k) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-slate-100">
        <button
          onClick={() => onConfirmar(leaf.name)}
          data-panel-confirmar
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${
            confirmado ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          <Check size={14} /> {confirmado ? 'Confirmado' : 'Está bien así'}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            const n = Number(prompt(`¿En cuántas cajas dividir «${efectivo}»?`, '3'));
            if (n >= 2) onReemplazarPorN(idx, Math.min(8, n));
          }}
          data-panel-dividir
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600"
          title="Cuando el PDF tiene una caja donde deberían ser varias (día / mes / año)"
        >
          <Split size={13} /> Dividir
        </button>
        <button
          onClick={() => onBorrar(idx)}
          data-panel-borrar
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:border-red-300"
          title="Sacar este campo del PDF de salida"
        >
          <Trash2 size={13} /> Borrar
        </button>
      </div>
    </div>
  );
}
