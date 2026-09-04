import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Rect } from '../../lib/etapa0/pdfFields';
import { trocearRect } from '../../lib/etapa0/camposManuales';

export interface DatosCampoNuevo {
  nombre: string;
  tipo: string;
  /** en cuántas cajas se reparte el rect */
  dividir: number;
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
 *
 * En v1.5.0 este panel también elegía la fila de ficha del campo. Eso se fue con
 * el recorte: el mapeo lo resuelve la skill sobre el paquete, así que acá el
 * nombre se escribe o se importa.
 */
export default function PanelCrearCampo({
  page,
  rect,
  onCrear,
  onCancelar,
}: {
  /** 0-based */
  page: number;
  rect: Rect;
  onCrear: (d: DatosCampoNuevo) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('/Tx');
  const [dividir, setDividir] = useState(1);

  const cajas = trocearRect(rect, dividir);
  const base = nombre.trim();
  // El sufijo del troceado es posicional: es estructural y editable, no
  // desambiguación de una colisión.
  const previsualizacion = dividir > 1 && base ? cajas.map((_, i) => `${base}_${i + 1}`) : base ? [base] : [];

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
          placeholder="nombre_del_campo"
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

      {previsualizacion.length > 0 && (
        <p className="text-[11px] text-slate-500 mb-2">
          Se {previsualizacion.length > 1 ? 'crean' : 'crea'}:{' '}
          <span className="font-mono text-slate-700">{previsualizacion.join(' · ')}</span>
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={() => onCrear({ nombre: base, tipo, dividir })}
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
