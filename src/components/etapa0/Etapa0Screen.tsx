import { useRef, useState } from 'react';
import { ArrowLeft, Upload, FileSignature } from 'lucide-react';
import { useStore } from '../../store/store';
import { Button } from '../ui';
import { readFichaRaw, type FichaRawResult, type RowDestino } from '../../lib/etapa0/fichaRaw';

const DESTINO_STYLE: Record<RowDestino, string> = {
  pdf: 'bg-emerald-50 text-emerald-700',
  'solo-json': 'bg-slate-100 text-slate-600',
  excluida: 'bg-red-50 text-red-600',
};

function Stat({ n, l, tone = 'slate' }: { n: number; l: string; tone?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center">
      <div className={`text-lg font-semibold leading-none text-${tone}-700`}>{n}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{l}</div>
    </div>
  );
}

export default function Etapa0Screen() {
  const setView = useStore((s) => s.setView);
  const input = useRef<HTMLInputElement>(null);
  const [res, setRes] = useState<FichaRawResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<RowDestino | 'todas'>('todas');

  const onFile = async () => {
    const f = input.current?.files?.[0];
    if (!f) return;
    setError(null);
    try {
      setRes(await readFichaRaw(f));
    } catch (e) {
      setError(String(e));
    }
    if (input.current) input.current.value = '';
  };

  const filas = res ? (filtro === 'todas' ? res.rows : res.rows.filter((r) => r.destino === filtro)) : [];

  return (
    <div className="h-full overflow-y-auto scroll-thin bg-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Button onClick={() => setView('home')}>
            <ArrowLeft size={15} /> Inicio
          </Button>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileSignature size={18} /> Etapa 0 · Renombrado asistido
          </h1>
          <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">v1.0.0 · solo análisis</span>
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-4">
          <b>Importante:</b> el renombrado va <b>siempre antes</b> de cargar el PDF en Signframe. Si lo cargás primero,
          el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
        </div>

        <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={onFile} />
        <Button variant="primary" onClick={() => input.current?.click()}>
          <Upload size={15} /> Cargar ficha cruda (.xlsx)
        </Button>

        {error && <p className="text-sm text-red-600 mt-3">No se pudo leer: {error}</p>}

        {res && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-4">
              <Stat n={res.stats.filasDatos} l="filas de datos" />
              <Stat n={res.stats.hojasNodo} l="hojas de nodo" />
              <Stat n={res.stats.hojasNoAplica} l="hojas no aplica" />
              <Stat n={res.stats.bloquesExcluidos} l="bloques excluidos" />
              <Stat n={res.stats.pdf} l="van al PDF" tone="emerald" />
              <Stat n={res.stats.soloJson} l="solo JSON" />
            </div>

            {res.warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {res.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}

            {/* Hojas */}
            <h2 className="text-sm font-semibold text-slate-700 mt-5 mb-1">Hojas</h2>
            <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100 text-sm">
              {res.sheets.map((s) => (
                <div key={s.name} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1 truncate text-slate-700">{s.name}</span>
                  {!s.esNodo && <span className="text-[10px] text-slate-400">no es hoja de nodo</span>}
                  {s.esNodo && !s.aplica && (
                    <span className="text-[10px] bg-red-50 text-red-600 rounded px-1.5 py-0.5" title={s.marcador}>
                      NO APLICA
                    </span>
                  )}
                  {s.esNodo && <span className="text-[11px] text-slate-400">{s.filasDatos} filas</span>}
                </div>
              ))}
            </div>

            {/* Bloques */}
            {res.bloquesExcluidos.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-700 mt-5 mb-1">Bloques excluidos</h2>
                <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
                  {res.bloquesExcluidos.map((b, i) => (
                    <div key={i} className="px-3 py-1.5 text-slate-600">
                      <b>{b.hoja}</b> · filas {b.desdeFila}–{b.hastaFila} · <span className="text-slate-400">{b.texto}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Filas */}
            <div className="flex items-center gap-2 mt-5 mb-1">
              <h2 className="text-sm font-semibold text-slate-700">Filas ({filas.length})</h2>
              <div className="flex gap-1">
                {(['todas', 'pdf', 'solo-json', 'excluida'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={`text-[11px] rounded px-2 py-0.5 border ${
                      filtro === f ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300 text-slate-600'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white max-h-[45vh] overflow-y-auto scroll-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Hoja</th>
                    <th className="text-left px-2 py-1 font-medium">Fila</th>
                    <th className="text-left px-2 py-1 font-medium">Nombre en PDF (C)</th>
                    <th className="text-left px-2 py-1 font-medium">Campo formulario (D)</th>
                    <th className="text-left px-2 py-1 font-medium">Valor (F)</th>
                    <th className="text-left px-2 py-1 font-medium">Path JSON (M)</th>
                    <th className="text-left px-2 py-1 font-medium">Destino</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="px-2 py-1 text-slate-500">{r.hoja}</td>
                      <td className="px-2 py-1 text-slate-400">{r.fila}</td>
                      <td className="px-2 py-1 text-slate-700 truncate max-w-[180px]">{r.nombrePdf}</td>
                      <td className="px-2 py-1 text-slate-700 truncate max-w-[180px]">{r.label}</td>
                      <td className="px-2 py-1 text-slate-500 truncate max-w-[120px]">{r.valor}</td>
                      <td className="px-2 py-1 font-mono text-[10px] text-slate-400 truncate max-w-[200px]">{r.campoJson}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1.5 py-0.5 ${DESTINO_STYLE[r.destino]}`} title={r.motivo}>
                          {r.destino}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-slate-400 mt-3">
              Próximo: v1.1.0 (instancias + generación de AcroNames), v1.2.0 (lectura del PDF), v1.3.0 (pre-alineación),
              v1.4.0 (tabla de corrección) y v1.4.1 (preview con overlay).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
