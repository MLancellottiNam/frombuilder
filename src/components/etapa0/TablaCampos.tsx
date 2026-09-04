import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Split, Trash2, Wand2, X } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';

/** Edición manual por campo del PDF. */
export interface EdicionCampo {
  /** '' = no se renombra (queda el actual) */
  nombreNuevo: string;
  /**
   * Índice de fila de ficha. Sobrevive del flujo viejo (v1.5.0) para no romper
   * los proyectos ya guardados; desde v2.0.0 el mapeo se resuelve afuera y esto
   * no se usa.
   */
  filaIdx: number | null;
  /** override del tipo (se aplica al escribir el PDF) */
  tipo: string;
  /** true si lo tocó el usuario (para no pisarlo al importar) */
  manual: boolean;
}

export type Ediciones = Record<number, EdicionCampo>;

export type FiltroCampos = 'todos' | 'sin-nombre' | 'colision' | 'creados' | 'multi-widget';

export const FILTROS: { valor: FiltroCampos; label: string }[] = [
  { valor: 'todos', label: 'todos' },
  { valor: 'sin-nombre', label: 'sin nombre' },
  { valor: 'colision', label: 'con colisión' },
  { valor: 'creados', label: 'creados' },
  { valor: 'multi-widget', label: 'multi-widget' },
];

export function nombreEfectivo(leaf: PdfLeaf, ed?: EdicionCampo): string {
  const n = ed?.nombreNuevo?.trim();
  return n ? n : leaf.name;
}

/**
 * Tabla de campos del PDF (v2.0.0). Es el centro de la pantalla: el nombre lo
 * pone el usuario o lo trae el archivo importado, no una heurística. Se fue todo
 * lo del mapeo automático —confianza, fila de ficha— y quedó lo que se decide:
 * nombre, tipo y si el campo va o no.
 */
export default function TablaCampos({
  leaves,
  ediciones,
  setEdiciones,
  colisiones,
  selected,
  onSelect,
  query,
  filtro,
  onBorrar,
  onReemplazarPorN,
}: {
  leaves: PdfLeaf[];
  ediciones: Ediciones;
  setEdiciones: (fn: (prev: Ediciones) => Ediciones) => void;
  colisiones: Set<string>;
  selected: string | null;
  onSelect: (name: string) => void;
  query: string;
  filtro: FiltroCampos;
  onBorrar?: (i: number) => void;
  /** reemplaza el campo por N cajas dentro de su mismo rect */
  onReemplazarPorN?: (i: number, n: number) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [verPosiciones, setVerPosiciones] = useState(false);
  const [bulkTexto, setBulkTexto] = useState('');
  const [bulkReemplazo, setBulkReemplazo] = useState('');

  const q = query.toLowerCase();
  const visibles = useMemo(
    () =>
      leaves
        .map((l, i) => ({ leaf: l, i }))
        .filter(({ leaf, i }) => {
          const ed = ediciones[i];
          const efectivo = nombreEfectivo(leaf, ed);
          if (q && !(leaf.name + ' ' + efectivo).toLowerCase().includes(q)) return false;
          switch (filtro) {
            case 'sin-nombre':
              return !ed?.nombreNuevo?.trim();
            case 'colision':
              return colisiones.has(efectivo);
            case 'creados':
              return leaf.origen === 'creado';
            case 'multi-widget':
              return leaf.widgets.length > 1;
            default:
              return true;
          }
        }),
    [leaves, ediciones, q, filtro, colisiones],
  );

  /**
   * Al seleccionar un campo desde el PDF hay que traer su fila a la vista: con
   * 111 filas queda fuera de pantalla y el click parece no haber hecho nada. Se
   * mueve SOLO la caja de la tabla —`scrollIntoView` arrastraría también los
   * contenedores de arriba—.
   */
  const filas = useRef(new Map<string, HTMLTableRowElement>());
  useEffect(() => {
    if (!selected) return;
    const fila = filas.current.get(selected);
    const cont = fila?.closest<HTMLElement>('.overflow-auto');
    if (!fila || !cont) return;
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

  /** Bulk: aplica una transformación al nombre de la selección. */
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

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Bulk edit */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-slate-100 text-[11px] bg-slate-50">
        <Wand2 size={12} className="text-slate-400" />
        <span className="text-slate-500">{sel.size} sel.</span>
        <input
          value={bulkTexto}
          onChange={(e) => setBulkTexto(e.target.value)}
          placeholder="texto"
          data-bulk-texto
          className="w-24 rounded border border-slate-300 px-1 py-0.5 font-mono"
        />
        <input
          value={bulkReemplazo}
          onChange={(e) => setBulkReemplazo(e.target.value)}
          placeholder="reemplazo"
          data-bulk-reemplazo
          className="w-24 rounded border border-slate-300 px-1 py-0.5 font-mono"
        />
        <button onClick={() => aplicarBulk('prefijo')} disabled={!sel.size} data-bulk="prefijo" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          + prefijo
        </button>
        <button onClick={() => aplicarBulk('sufijo')} disabled={!sel.size} data-bulk="sufijo" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          + sufijo
        </button>
        <button onClick={() => aplicarBulk('reemplazar')} disabled={!sel.size} data-bulk="reemplazar" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 disabled:opacity-40">
          reemplazar
        </button>
        <button onClick={() => setSel(new Set(visibles.map((v) => v.i)))} className="rounded border border-slate-300 bg-white px-1.5 py-0.5">
          todos
        </button>
        <button onClick={() => setSel(new Set())} className="rounded border border-slate-300 bg-white px-1.5 py-0.5">
          ninguno
        </button>
        <button
          onClick={() => setVerPosiciones((v) => !v)}
          className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 border ${
            verPosiciones ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600'
          }`}
        >
          <MapPin size={12} /> Posiciones
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
              <th className="text-left px-1 py-1 font-medium w-16">Origen</th>
              {verPosiciones && <th className="text-left px-1 py-1 font-medium">Posición</th>}
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ leaf, i }) => {
              const ed = ediciones[i];
              const efectivo = nombreEfectivo(leaf, ed);
              const choca = colisiones.has(efectivo);
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
                  <td className="px-1">
                    <input type="checkbox" checked={sel.has(i)} onChange={() => toggleSel(i)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-1 py-1 text-right text-slate-400">{leaf.readingIndex}</td>
                  <td className="px-1 py-1 font-mono text-slate-500 truncate max-w-[150px]" title={leaf.name}>
                    {leaf.name}
                    {leaf.widgets.length > 1 && (
                      <span
                        className={`ml-1 rounded px-1 ${
                          leaf.multiWidgetSospechoso ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}
                        title={`${leaf.widgets.length} widgets en páginas ${leaf.paginas.map((p) => p + 1).join(', ')}${
                          leaf.multiWidgetSospechoso ? ' — un /Tx con varios widgets suele ser una colisión del PDF' : ''
                        }`}
                      >
                        ×{leaf.widgets.length}
                      </span>
                    )}
                  </td>
                  <td className="text-slate-300">→</td>
                  <td className="px-1 py-1">
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
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={ed?.tipo ?? leaf.ft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(i, { tipo: e.target.value })}
                      data-tipo={leaf.name}
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
                    {leaf.origen === 'creado' ? (
                      <span className="rounded px-1 bg-brand-100 text-brand-700">creado</span>
                    ) : (
                      <span className="rounded px-1 bg-slate-100 text-slate-500">detectado</span>
                    )}
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
                        patch(i, { nombreNuevo: '' });
                      }}
                      className="text-slate-300 hover:text-red-500"
                      title="Volver al nombre actual"
                    >
                      <X size={12} />
                    </button>
                    {onReemplazarPorN && (
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
            {visibles.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Ningún campo con ese filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
