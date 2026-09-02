import { useState } from 'react';
import { X, Wand2, MapPin } from 'lucide-react';
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

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Contador + acciones */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-slate-100 text-[11px]">
        <span className="text-slate-600">
          <b>{leaves.length}</b> campos ({totalWidgets} widgets) · <b className="text-emerald-700">{renombrados}</b>{' '}
          renombrados · <b className="text-amber-600">{enRevisar}</b> en revisar ·{' '}
          <b className={colisiones.size ? 'text-red-600' : 'text-slate-500'}>{colisiones.size}</b> colisiones
        </span>
        <button
          onClick={() => setVerPosiciones((v) => !v)}
          className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 border ${
            verPosiciones ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600'
          }`}
        >
          <MapPin size={12} /> Posiciones
        </button>
      </div>

      {/* Bulk edit */}
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

      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 z-10">
            <tr>
              <th className="w-6" />
              <th className="text-right px-1 py-1 font-medium w-8">#</th>
              <th className="text-left px-1 py-1 font-medium">Nombre actual (PDF)</th>
              <th className="w-3" />
              <th className="text-left px-1 py-1 font-medium">Nombre nuevo</th>
              <th className="text-left px-1 py-1 font-medium w-14">Tipo</th>
              <th className="text-left px-1 py-1 font-medium w-16">Confianza</th>
              <th className="text-left px-1 py-1 font-medium">Fila ficha</th>
              {verPosiciones && <th className="text-left px-1 py-1 font-medium">Posición</th>}
              <th className="w-6" />
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
                  onClick={() => onSelect(leaf.name)}
                  className={`border-b border-slate-50 cursor-pointer ${isSel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-1">
                    <input type="checkbox" checked={sel.has(i)} onChange={() => toggleSel(i)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-1 py-1 text-right text-slate-400">{leaf.readingIndex}</td>
                  <td className="px-1 py-1 font-mono text-slate-500 truncate max-w-[140px]" title={leaf.name}>
                    {leaf.name}
                    {leaf.multiWidgetSospechoso && (
                      <span className="ml-1 rounded bg-amber-100 text-amber-700 px-1" title={`${leaf.widgets.length} widgets en páginas ${leaf.paginas.map((p) => p + 1).join(', ')}`}>
                        ×{leaf.widgets.length}
                      </span>
                    )}
                  </td>
                  <td className="text-slate-300">→</td>
                  <td className="px-1 py-1">
                    <input
                      value={ed?.nombreNuevo ?? ''}
                      placeholder={leaf.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(i, { nombreNuevo: e.target.value })}
                      className={`w-full rounded border px-1 py-0.5 font-mono ${
                        choca ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-300'
                      }`}
                      title={choca ? `COLISIÓN: ya hay otro campo llamado "${efectivo}"` : efectivo}
                    />
                  </td>
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
                  <td className="px-1 py-1">
                    {conf ? (
                      <span className={`rounded px-1 ${CONF_STYLE[conf]}`}>{conf}</span>
                    ) : (
                      <span className="rounded px-1 bg-slate-100 text-slate-500">sin asignar</span>
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
                  <td className="px-1">
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
