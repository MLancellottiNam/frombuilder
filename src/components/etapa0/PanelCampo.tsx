import { useEffect, useRef } from 'react';
import { Split, Trash2, X } from 'lucide-react';
import type { PdfLeaf, Rect } from '../../lib/etapa0/pdfFields';
import { nombreEfectivo, type Ediciones } from './TablaCampos';

const TIPOS = ['/Tx', '/Btn', '/Ch', '/Sig'];

/**
 * Ficha del campo seleccionado (v2.0.0). Es la respuesta al click: en vez de
 * buscar la fila entre 111, el campo que se tocó —en el PDF o en la tabla— se
 * abre acá con lo que hay que decidir y con el dato que permite decidirlo: la
 * etiqueta que el PDF tiene IMPRESA al lado y el texto de su zona.
 *
 * El rect también se edita con números, no solo arrastrando: para alinear una
 * caja con la de al lado, escribir el valor es más preciso que el mouse.
 */
export default function PanelCampo({
  leaf,
  idx,
  ediciones,
  setEdiciones,
  colisiones,
  etiquetaImpresa,
  textoZona,
  onEditarRect,
  onBorrar,
  onReemplazarPorN,
  onCerrar,
}: {
  leaf: PdfLeaf;
  /** índice del campo en la lista efectiva */
  idx: number;
  ediciones: Ediciones;
  setEdiciones: (fn: (prev: Ediciones) => Ediciones) => void;
  colisiones: Set<string>;
  /** lo que el PDF tiene impreso al lado del campo */
  etiquetaImpresa?: string;
  /** el texto impreso de la banda donde cae el campo */
  textoZona?: string;
  onEditarRect: (leaf: PdfLeaf, widgetIdx: number, rect: Rect) => void;
  onBorrar: (i: number) => void;
  onReemplazarPorN: (i: number, n: number) => void;
  onCerrar: () => void;
}) {
  const caja = useRef<HTMLDivElement>(null);

  // La ficha se abre arriba de la columna: si venía scrolleada, hay que traerla
  // a la vista o el click parece no haber hecho nada.
  useEffect(() => {
    caja.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [idx]);

  const ed = ediciones[idx];
  const efectivo = nombreEfectivo(leaf, ed);
  const choca = colisiones.has(efectivo);

  const patch = (p: Partial<Ediciones[number]>) =>
    setEdiciones((prev) => {
      const b = prev[idx] ?? { nombreNuevo: '', filaIdx: null, tipo: leaf.ft, manual: false };
      return { ...prev, [idx]: { ...b, ...p, manual: true } };
    });

  const rect = leaf.rect;
  const setRect = (k: keyof Rect, v: number) => {
    if (!Number.isFinite(v)) return;
    onEditarRect(leaf, 0, { ...rect, [k]: v });
  };

  return (
    <div ref={caja} className="rounded-md border border-brand-300 bg-white" data-panel-campo>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-medium text-slate-700">Campo seleccionado</span>
        <span className="text-[10px] text-slate-400">
          #{leaf.readingIndex} · pág. {leaf.page + 1}
          {leaf.origen === 'creado' ? ' · creado a mano' : ''}
          {leaf.widgets.length > 1 ? ` · ${leaf.widgets.length} cajas` : ''}
        </span>
        {choca && <span className="rounded px-1 text-[10px] bg-red-50 text-red-600">nombre repetido</span>}
        <div className="flex-1" />
        <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700" title="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-2 text-xs">
        {etiquetaImpresa && (
          <div className="flex items-baseline gap-2">
            <span className="w-24 text-slate-400 shrink-0">En el PDF dice</span>
            <span className="text-slate-700 font-medium" data-panel-impresa>
              «{etiquetaImpresa}»
            </span>
          </div>
        )}
        {textoZona && (
          <div className="flex items-baseline gap-2">
            <span className="w-24 text-slate-400 shrink-0">Su zona</span>
            <span className="text-slate-500 line-clamp-2" data-panel-zona title={textoZona}>
              {textoZona}
            </span>
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className="w-24 text-slate-400 shrink-0">Nombre actual</span>
          <span className="font-mono text-slate-600 break-all">{leaf.name}</span>
        </div>

        <label className="flex items-center gap-2">
          <span className="w-24 text-slate-400 shrink-0">Nombre nuevo</span>
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
          <p className="text-[11px] text-red-600 pl-[104px]">
            Ya hay otro campo llamado «{efectivo}»: mientras haya nombres repetidos no se puede escribir el PDF.
          </p>
        )}

        <label className="flex items-center gap-2">
          <span className="w-24 text-slate-400 shrink-0">Tipo</span>
          <select
            value={ed?.tipo ?? leaf.ft}
            onChange={(e) => patch({ tipo: e.target.value })}
            data-panel-tipo
            className="rounded border border-slate-300 px-1 py-1"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t.replace('/', '')}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <span className="w-24 text-slate-400 shrink-0">Caja (pt)</span>
          <div className="flex flex-wrap items-center gap-1">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-1">
                <span className="text-slate-400">{k}</span>
                <input
                  type="number"
                  step={1}
                  value={Math.round(rect[k] * 10) / 10}
                  onChange={(e) => setRect(k, Number(e.target.value))}
                  data-panel-rect={k}
                  className="w-16 rounded border border-slate-300 px-1 py-0.5"
                />
              </label>
            ))}
          </div>
        </div>
        {leaf.widgets.length > 1 && (
          <p className="text-[11px] text-slate-400 pl-[104px]">
            Los números editan la primera caja. Las otras se mueven arrastrándolas en el preview.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-slate-100">
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
        <div className="flex-1" />
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
