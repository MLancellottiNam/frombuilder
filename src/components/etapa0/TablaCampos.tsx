import { useEffect, useRef, useState } from 'react';
import { X, Wand2, MapPin, Trash2, Split } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';
import type { Confianza } from '../../lib/etapa0/align';
import type { NombrePropuesto } from '../../lib/etapa0/acroName';

/** Edición manual por campo del PDF. */
export interface EdicionCampo {
  /** '' = no se renombra (queda el actual) */
  nombreNuevo: string;
  /** índice dentro de filasPdf; null = desasignado */
  filaIdx: number | null;
  /** override del tipo (se aplica al escribir el PDF, v1.5.0) */
  tipo: string;
  /** true si lo tocó el usuario (para no pisarlo al recalcular) */
  manual: boolean;
}

export type Ediciones = Record<number, EdicionCampo>;

const CONF_STYLE: Record<Confianza, string> = {
  alta: 'bg-blue-50 text-blue-700',
  media: 'bg-amber-50 text-amber-700',
  revisar: 'bg-red-50 text-red-600',
};

/**
 * En la vista simple la confianza se dice en dos palabras. «media» y «revisar»
 * piden lo mismo del usuario —mirarlo— así que la distinción es del motor, no
 * suya; queda visible en la vista avanzada y en el reporte CSV.
 */
const CONF_SIMPLE: Record<Confianza, string> = {
  alta: 'listo',
  media: 'revisar',
  revisar: 'revisar',
};

export function nombreEfectivo(leaf: PdfLeaf, ed?: EdicionCampo): string {
  const n = ed?.nombreNuevo?.trim();
  return n ? n : leaf.name;
}

export default function TablaCampos({
  leaves,
  filasPdf,
  ediciones,
  setEdiciones,
  confianzaPorLeaf,
  colisiones,
  selected,
  onSelect,
  query,
  onBorrar,
  onReemplazarPorN,
  simple = false,
}: {
  leaves: PdfLeaf[];
  filasPdf: NombrePropuesto[];
  ediciones: Ediciones;
  setEdiciones: (fn: (prev: Ediciones) => Ediciones) => void;
  confianzaPorLeaf: Map<string, Confianza>;
  colisiones: Set<string>;
  selected: string | null;
  onSelect: (name: string) => void;
  query: string;
  /** v1.4.4: borrar el campo (detectado o creado) */
  onBorrar?: (i: number) => void;
  /** v1.4.4: reemplazar el campo por N cajas dentro de su mismo rect */
  onReemplazarPorN?: (i: number, n: number) => void;
  /**
   * v1.4.5: vista simple. Deja solo lo que hay que decidir (nombre nuevo, de qué
   * fila sale y si está listo) y esconde lo del motor: nombre actual del
   * AcroForm, tipo, posiciones y la edición en lote.
   */
  simple?: boolean;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [verPosiciones, setVerPosiciones] = useState(false);
  const [bulkTexto, setBulkTexto] = useState('');
  const [bulkReemplazo, setBulkReemplazo] = useState('');

  const q = query.toLowerCase();
  const visibles = leaves
    .map((l, i) => ({ leaf: l, i }))
    .filter(({ leaf, i }) => {
      if (!q) return true;
      const ed = ediciones[i];
      return (leaf.name + ' ' + (ed?.nombreNuevo ?? '')).toLowerCase().includes(q);
    });

  /**
   * Al seleccionar un campo desde el PDF, la fila se pintaba pero nunca se
   * scrolleaba: con 111 filas quedaba fuera de la pantalla y parecía que el
   * click no había hecho nada.
   */
  const filas = useRef(new Map<string, HTMLTableRowElement>());
  useEffect(() => {
    if (!selected) return;
    const fila = filas.current.get(selected);
    const cont = fila?.closest<HTMLElement>('.overflow-auto');
    if (!fila || !cont) return;
    // A mano en vez de `scrollIntoView`: ese scrollea también los contenedores
    // de arriba, y movía la columna entera dejando media pantalla fuera de
    // vista. Acá se mueve SOLO la caja de la tabla.
    const f = fila.getBoundingClientRect();
    const c = cont.getBoundingClientRect();
    if (f.top < c.top) cont.scrollTop -= c.top - f.top + 8;
    else if (f.bottom > c.bottom) cont.scrollTop += f.bottom - c.bottom + 8;
  }, [selected, visibles.length]);

  const patch = (i: number, p: Partial<EdicionCampo>) =>
    setEdiciones((prev) => {
      const b = prev[i] ?? { nombreNuevo: '', filaIdx: null, tipo: leaves[i].ft, manual: false };
      return { ...prev, [i]: { ...b, ...p, manual: true } };
    });

  const toggleSel = (i: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  /** Bulk: aplica una transformación al nombre nuevo de la selección. */
  const aplicarBulk = (modo: 'prefijo' | 'sufijo' | 'reemplazar') => {
    if (sel.size === 0 || !bulkTexto) return;
    setEdiciones((prev) => {
      const next = { ...prev };
      for (const i of sel) {
        const actual = nombreEfectivo(leaves[i], next[i]);
        let nuevo = actual;
        if (modo === 'prefijo') nuevo = bulkTexto + actual;
        else if (modo === 'sufijo') nuevo = actual + bulkTexto;
        else nuevo = actual.split(bulkTexto).join(bulkReemplazo);
        const b = next[i] ?? { nombreNuevo: '', filaIdx: null, tipo: leaves[i].ft, manual: false };
        next[i] = { ...b, nombreNuevo: nuevo, manual: true };
      }
      return next;
    });
  };

  const renombrados = leaves.filter((l, i) => nombreEfectivo(l, ediciones[i]) !== l.name).length;
  const enRevisar = leaves.filter((l) => {
    const c = confianzaPorLeaf.get(l.name);
    return c === 'media' || c === 'revisar';
  }).length;
  const totalWidgets = leaves.reduce((n, l) => n + l.widgets.length, 0);
  const nCreados = leaves.filter((l) => l.origen === 'creado').length;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Contador + acciones */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-slate-100 text-[11px]">
        <span className="text-slate-600">
          {simple ? (
            <>
              <b>{leaves.length}</b> campos · <b className="text-emerald-700">{renombrados}</b> con nombre nuevo ·{' '}
              <b className="text-amber-600">{enRevisar}</b> para revisar
            </>
          ) : (
            <>
              <b>{leaves.length}</b> campos ({totalWidgets} widgets) · <b className="text-emerald-700">{renombrados}</b>{' '}
              renombrados · <b className="text-amber-600">{enRevisar}</b> en revisar ·{' '}
              <b className={colisiones.size ? 'text-red-600' : 'text-slate-500'}>{colisiones.size}</b> colisiones
            </>
          )}
          {nCreados > 0 && (
            <>
              {' '}
              · <b className="text-brand-700">{nCreados}</b> creados
            </>
          )}
        </span>
        {!simple && (
          <button
            onClick={() => setVerPosiciones((v) => !v)}
            className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 border ${
              verPosiciones ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600'
            }`}
          >
            <MapPin size={12} /> Posiciones
          </button>
        )}
      </div>

      {/* Bulk edit */}
      {!simple && (
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-slate-100 text-[11px] bg-slate-50">
        <Wand2 size={12} className="text-slate-400" />
        <span className="text-slate-500">{sel.size} sel.</span>
        <input
          value={bulkTexto}
          onChange={(e) => setBulkTexto(e.target.value)}
          placeholder="texto"
          className="w-24 rounded border border-slate-300 px-1 py-0.5 font-mono"
        />
        <input
          value={bulkReemplazo}
          onChange={(e) => setBulkReemplazo(e.target.value)}
          placeholder="reemplazo"
          className="w-24 rounded border border-slate-300 px-1 py-0.5 font-mono"
        />
        <button onClick={() => aplicarBulk('prefijo')} disabled={!sel.size} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          + prefijo
        </button>
        <button onClick={() => aplicarBulk('sufijo')} disabled={!sel.size} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          + sufijo
        </button>
        <button onClick={() => aplicarBulk('reemplazar')} disabled={!sel.size} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          reemplazar
        </button>
        <button onClick={() => setSel(new Set(visibles.map((v) => v.i)))} className="rounded border border-slate-300 bg-white px-1.5 py-0.5">
          todos
        </button>
        <button onClick={() => setSel(new Set())} className="rounded border border-slate-300 bg-white px-1.5 py-0.5">
          ninguno
        </button>
      </div>
      )}

      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 z-10">
            <tr>
              {!simple && <th className="w-6" />}
              <th className="text-right px-1 py-1 font-medium w-8">#</th>
              {!simple && (
                <>
                  <th className="text-left px-1 py-1 font-medium">Nombre actual (PDF)</th>
                  <th className="w-3" />
                </>
              )}
              <th className="text-left px-1 py-1 font-medium">Nombre nuevo</th>
              {!simple && <th className="text-left px-1 py-1 font-medium w-14">Tipo</th>}
              <th className="text-left px-1 py-1 font-medium w-16">{simple ? 'Estado' : 'Confianza'}</th>
              <th className="text-left px-1 py-1 font-medium">{simple ? 'De qué fila sale' : 'Fila ficha'}</th>
              {verPosiciones && <th className="text-left px-1 py-1 font-medium">Posición</th>}
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ leaf, i }) => {
              const ed = ediciones[i];
              const efectivo = nombreEfectivo(leaf, ed);
              const choca = colisiones.has(efectivo);
              const conf = confianzaPorLeaf.get(leaf.name);
              const isSel = selected === leaf.name;
              return (
                <tr
                  key={i}
                  ref={(el) => {
                    if (el) filas.current.set(leaf.name, el);
                    else filas.current.delete(leaf.name);
                  }}
                  data-fila={leaf.name}
                  onClick={() => onSelect(leaf.name)}
                  className={`border-b border-slate-50 cursor-pointer ${
                    isSel ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-slate-50'
                  }`}
                >
                  {!simple && (
                    <td className="px-1">
                      <input type="checkbox" checked={sel.has(i)} onChange={() => toggleSel(i)} onClick={(e) => e.stopPropagation()} />
                    </td>
                  )}
                  <td className="px-1 py-1 text-right text-slate-400">{leaf.readingIndex}</td>
                  {!simple && (
                    <>
                      <td className="px-1 py-1 font-mono text-slate-500 truncate max-w-[140px]" title={leaf.name}>
                        {leaf.origen === 'creado' && (
                          <span className="mr-1 rounded bg-brand-100 text-brand-700 px-1" title="Campo creado a mano">
                            nuevo
                          </span>
                        )}
                        {leaf.name}
                        {leaf.multiWidgetSospechoso && (
                          <span className="ml-1 rounded bg-amber-100 text-amber-700 px-1" title={`${leaf.widgets.length} widgets en páginas ${leaf.paginas.map((p) => p + 1).join(', ')}`}>
                            ×{leaf.widgets.length}
                          </span>
                        )}
                      </td>
                      <td className="text-slate-300">→</td>
                    </>
                  )}
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      {simple && leaf.origen === 'creado' && (
                        <span
                          className="rounded bg-brand-100 text-brand-700 px-1 shrink-0"
                          title="Campo creado a mano"
                        >
                          nuevo
                        </span>
                      )}
                      <input
                        value={ed?.nombreNuevo ?? ''}
                        placeholder={leaf.name}
                        data-nombre={leaf.name}
                        data-efectivo={efectivo}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(i, { nombreNuevo: e.target.value })}
                        className={`w-full rounded border px-1 py-0.5 font-mono ${
                          choca ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-300'
                        }`}
                        title={choca ? `COLISIÓN: ya hay otro campo llamado "${efectivo}"` : efectivo}
                      />
                    </div>
                  </td>
                  {!simple && (
                    <td className="px-1 py-1">
                      <select
                        value={ed?.tipo ?? leaf.ft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(i, { tipo: e.target.value })}
                        className="w-full rounded border border-slate-300 px-0.5 py-0.5"
                      >
                        {['/Tx', '/Btn', '/Ch', '/Sig'].map((t) => (
                          <option key={t} value={t}>
                            {t.replace('/', '')}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-1 py-1">
                    {choca ? (
                      <span className="rounded px-1 bg-red-50 text-red-600" title={`Ya hay otro campo llamado «${efectivo}»`}>
                        {simple ? 'repetido' : 'colisión'}
                      </span>
                    ) : conf ? (
                      <span className={`rounded px-1 ${CONF_STYLE[conf]}`} title={conf}>
                        {simple ? CONF_SIMPLE[conf] : conf}
                      </span>
                    ) : (
                      <span className="rounded px-1 bg-slate-100 text-slate-500">
                        {simple ? 'sin fila' : 'sin asignar'}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={ed?.filaIdx ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        patch(i, {
                          filaIdx: v,
                          // al reasignar, proponer el nombre de esa fila
                          nombreNuevo: v == null ? '' : filasPdf[v]?.nombre || '',
                        });
                      }}
                      className="w-full rounded border border-slate-300 px-0.5 py-0.5 max-w-[150px]"
                    >
                      <option value="">— sin asignar —</option>
                      {filasPdf.map((f, k) => (
                        <option key={k} value={k}>
                          {f.fila.hoja}·{f.fila.fila} {f.fila.nombrePdf || f.fila.label}
                          {f.fila.instancia ? ` (${f.fila.instancia.codigo})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  {verPosiciones && (
                    <td className="px-1 py-1 text-slate-400 whitespace-nowrap">
                      p{leaf.page + 1} · {Math.round(leaf.rect.x)},{Math.round(leaf.rect.y)} ·{' '}
                      {Math.round(leaf.rect.w)}×{Math.round(leaf.rect.h)}
                    </td>
                  )}
                  <td className="px-1 whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        patch(i, { filaIdx: null, nombreNuevo: '' });
                      }}
                      className="text-slate-300 hover:text-red-500"
                      title="Desasignar y volver al nombre actual"
                    >
                      <X size={12} />
                    </button>
                    {onReemplazarPorN && !simple && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const n = Number(prompt(`¿En cuántas cajas dividir «${efectivo}»?`, '3'));
                          if (n >= 2) onReemplazarPorN(i, Math.min(8, n));
                        }}
                        data-reemplazar={leaf.name}
                        className="ml-1 text-slate-300 hover:text-brand-600"
                        title="Reemplazar por N cajas dentro de su mismo rect"
                      >
                        <Split size={12} />
                      </button>
                    )}
                    {onBorrar && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onBorrar(i);
                        }}
                        data-borrar={leaf.name}
                        className="ml-1 text-slate-300 hover:text-red-600"
                        title="Borrar el campo del PDF de salida"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
