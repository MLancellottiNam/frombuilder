import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Rect } from '../../lib/etapa0/pdfFields';
import type { NombrePropuesto } from '../../lib/etapa0/acroName';
import { trocearRect } from '../../lib/etapa0/camposManuales';
import { sufijosDeFormato } from '../../lib/etapa0/regiones';

export interface DatosCampoNuevo {
  nombre: string;
  tipo: string;
  /** en cuántas cajas se reparte el rect */
  dividir: number;
  /** índice en `filasPdf`; null si se crea sin fila */
  filaIdx: number | null;
}

const TIPOS: { valor: string; label: string }[] = [
  { valor: '/Tx', label: 'Texto' },
  { valor: '/Btn', label: 'Casilla' },
  { valor: '/Sig', label: 'Firma' },
];

/**
 * Panel que aparece al soltar el rectángulo dibujado. La decisión del usuario es
 * el nombre, el tipo y —cuando el PDF resolvió con una caja lo que debería ser
 * varias— en cuántas cajas se reparte.
 */
export default function PanelCrearCampo({
  page,
  rect,
  filas,
  onCrear,
  onCancelar,
}: {
  /** 0-based */
  page: number;
  rect: Rect;
  /** filas de ficha elegibles (ya filtradas por la región donde se dibujó) */
  filas: { idx: number; np: NombrePropuesto }[];
  onCrear: (d: DatosCampoNuevo) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('/Tx');
  const [dividir, setDividir] = useState(1);
  const [filaIdx, setFilaIdx] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const q = busqueda.toLowerCase();
  const visibles = q
    ? filas.filter((f) =>
        `${f.np.fila.hoja} ${f.np.fila.fila} ${f.np.fila.nombrePdf} ${f.np.fila.label} ${f.np.nombre}`
          .toLowerCase()
          .includes(q),
      )
    : filas;

  const cajas = trocearRect(rect, dividir);
  const filaSel = filaIdx == null ? null : filas.find((f) => f.idx === filaIdx)?.np;
  // El sufijo sale del formato de la fila cuando se puede derivar; si no, es
  // posicional. Es estructural y editable, no desambiguación de colisión.
  const sufijos = filaSel ? sufijosDeFormato(filaSel.fila.valor, dividir) : undefined;
  const base = nombre.trim() || filaSel?.nombre || '';
  const previsualizacion =
    dividir > 1 && base
      ? cajas.map((_, i) => `${base}_${sufijos?.[i] ?? i + 1}`)
      : base
        ? [base]
        : [];

  const puedeCrear = !!base && dividir >= 1;

  return (
    <div className="rounded-md border border-brand-300 bg-brand-50/40 px-3 py-2.5 text-xs" data-panel-crear>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium text-slate-800">Nuevo campo</span>
        <span className="text-[10px] text-slate-500">
          pág. {page + 1} · {Math.round(rect.w)}×{Math.round(rect.h)}pt en {Math.round(rect.x)},{Math.round(rect.y)}
        </span>
        <div className="flex-1" />
        <button onClick={onCancelar} className="text-slate-400 hover:text-slate-700" title="Cancelar">
          <X size={15} />
        </button>
      </div>

      <label className="flex items-center gap-2 mb-1.5">
        <span className="w-16 text-slate-500 shrink-0">Nombre</span>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder={filaSel?.nombre || 'nombre_del_campo'}
          data-crear-nombre
          autoFocus
          className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </label>

      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-16 text-slate-500 shrink-0">Tipo</span>
        <div className="flex gap-1">
          {TIPOS.map((t) => (
            <button
              key={t.valor}
              onClick={() => setTipo(t.valor)}
              data-crear-tipo={t.valor}
              className={`rounded px-2 py-1 border ${
                tipo === t.valor ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              {t.label} <span className="opacity-60">{t.valor}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 mb-1.5">
        <span className="w-16 text-slate-500 shrink-0">Dividir</span>
        <input
          type="number"
          min={1}
          max={8}
          value={dividir}
          onChange={(e) => setDividir(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
          data-crear-dividir
          className="w-14 rounded border border-slate-300 px-1 py-1"
        />
        <span className="text-slate-500">
          caja{dividir > 1 ? 's' : ''}
          {dividir > 1 && ` de ${Math.round(cajas[0].w)}pt`}
        </span>
      </label>

      <div className="flex items-start gap-2 mb-1.5">
        <span className="w-16 text-slate-500 shrink-0 pt-1">Fila</span>
        <div className="flex-1 min-w-0">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={`Buscar entre ${filas.length} filas…`}
            className="w-full rounded border border-slate-300 px-2 py-1 mb-1"
          />
          <select
            value={filaIdx ?? ''}
            onChange={(e) => setFilaIdx(e.target.value === '' ? null : Number(e.target.value))}
            data-crear-fila
            size={4}
            className="w-full rounded border border-slate-300 px-1 py-0.5"
          >
            <option value="">— sin fila (se reporta como huérfano) —</option>
            {visibles.map((f) => (
              <option key={f.idx} value={f.idx}>
                {f.np.fila.hoja}·{f.np.fila.fila} {f.np.fila.nombrePdf || f.np.fila.label}
                {f.np.fila.instancia ? ` (${f.np.fila.instancia.codigo})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {previsualizacion.length > 0 && (
        <p className="text-[11px] text-slate-500 mb-2">
          Se {previsualizacion.length > 1 ? 'crean' : 'crea'}:{' '}
          <span className="font-mono text-slate-700">{previsualizacion.join(' · ')}</span>
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={() => onCrear({ nombre: base, tipo, dividir, filaIdx })}
          disabled={!puedeCrear}
          data-crear-confirmar
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-40"
        >
          <Check size={14} /> Crear
        </button>
        <button
          onClick={onCancelar}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
