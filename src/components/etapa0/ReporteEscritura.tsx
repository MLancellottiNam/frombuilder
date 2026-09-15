import { AlertTriangle } from 'lucide-react';
import type { WritePdfResult } from '../../lib/etapa0/writePdf';

/**
 * Qué salió en el PDF generado (v3.4.0).
 *
 * Los números están para que el renombrado no sea una caja negra: si el PDF
 * entra con 82 campos y salen 80, eso tiene que verse acá y no descubrirse en
 * Signframe. Lo mismo con los estados de exportación de las casillas: es el
 * valor que hay que configurar como `checkedPdfValue`, y si hay más de uno o
 * tiene acentos, el que arma la definición se tiene que enterar.
 */
export default function ReporteEscritura({ r }: { r: WritePdfResult }) {
  const estados = Object.entries(r.estados.porEstado);
  const escapados = Object.entries(r.estados.escapados);
  const ojo = estados.length > 1 || escapados.length > 0 || r.estados.sinEstado > 0 || r.sinEmparejar > 0;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[11px]" data-reporte>
      <p className="font-medium text-slate-700">Qué salió en el PDF</p>
      <ul className="mt-1 space-y-0.5 text-slate-600">
        <li>
          <b data-reporte-campos>{r.campos}</b> campos · <b data-reporte-widgets>{r.widgets}</b> widgets ·{' '}
          <b data-reporte-renombrados>{r.renombrados}</b> renombrados
          {r.creados ? ` · ${r.creados} creados` : ''}
          {r.borrados ? ` · ${r.borrados} borrados` : ''}
          {r.movidos ? ` · ${r.movidos} cajas movidas` : ''}
        </li>
        {r.sinEmparejar > 0 && (
          <li className="text-amber-700" data-reporte-sinemparejar>
            <b>{r.sinEmparejar}</b> caja(s) editada(s) a mano no se pudieron emparejar con ningún widget del PDF.
          </li>
        )}
        <li data-reporte-estados>
          Casillas: <b>{r.estados.widgets}</b> con estado de exportación
          {estados.length > 0 ? (
            <>
              {' '}
              — {estados.map(([e, n]) => `«${e}» ×${n}`).join(' · ')}
            </>
          ) : (
            ' — ninguno'
          )}
        </li>
      </ul>

      {ojo && (
        <div
          className="mt-2 flex gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800"
          data-reporte-warning
        >
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <div className="space-y-0.5">
            {estados.length > 1 && (
              <p>
                Las casillas <b>no usan un único estado</b>: el <code>checkedPdfValue</code> de Signframe no puede ser
                el mismo para todas.
              </p>
            )}
            {escapados.length > 0 && (
              <p>
                Estado con caracteres no ASCII:{' '}
                {escapados.map(([texto, lit]) => (
                  <span key={lit}>
                    «<b>{texto}</b>» (en el archivo: <code>{lit}</code>){' '}
                  </span>
                ))}
                — el valor a configurar es el de las comillas, no el escapado.
              </p>
            )}
            {r.estados.sinEstado > 0 && (
              <p>
                <b>{r.estados.sinEstado}</b> casilla(s) sin <code>/AP/N</code>: no se pueden marcar de ninguna manera.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
