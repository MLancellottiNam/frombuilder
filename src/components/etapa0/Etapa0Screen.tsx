import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Upload, FileSignature, FileText, Search } from 'lucide-react';
import { useStore } from '../../store/store';
import { Button } from '../ui';
import { readFichaRaw, type FichaRawResult, type RowDestino } from '../../lib/etapa0/fichaRaw';
import { readPdfFields, type PdfFieldsResult } from '../../lib/etapa0/pdfFields';
import {
  detectarBloquesInstanciables,
  instanciasPorDefecto,
  expandirInstancias,
  generarNombres,
  contarColisiones,
  type Instancia,
} from '../../lib/etapa0/acroName';
import PdfPreview from './PdfPreview';

const DESTINO_STYLE: Record<RowDestino, string> = {
  pdf: 'bg-emerald-50 text-emerald-700',
  'solo-json': 'bg-slate-100 text-slate-600',
  excluida: 'bg-red-50 text-red-600',
};

function Stat({ n, l, tone }: { n: number | string; l: string; tone?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-center">
      <div className={`text-base font-semibold leading-none ${tone ?? 'text-slate-700'}`}>{n}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{l}</div>
    </div>
  );
}

export default function Etapa0Screen() {
  const setView = useStore((s) => s.setView);
  const fichaInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const [ficha, setFicha] = useState<FichaRawResult | null>(null);
  const [pdf, setPdf] = useState<PdfFieldsResult | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ficha' | 'pdf'>('ficha');
  const [filtro, setFiltro] = useState<RowDestino | 'todas' | 'colision'>('pdf');
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [hojaInstanciable, setHojaInstanciable] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const onFicha = async () => {
    const f = fichaInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const r = await readFichaRaw(f);
      setFicha(r);
      const bloques = detectarBloquesInstanciables(r.rows);
      if (bloques.length > 0) {
        setHojaInstanciable(bloques[0].hoja);
        setInstancias(instanciasPorDefecto(bloques[0].codigos));
      } else {
        setHojaInstanciable(null);
        setInstancias([]);
      }
    } catch (e) {
      setError('Ficha: ' + String(e));
    }
    if (fichaInput.current) fichaInput.current.value = '';
  };

  const onPdf = async () => {
    const f = pdfInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    setPdfFile(f);
    try {
      setPdf(await readPdfFields(await f.arrayBuffer()));
      setTab('pdf');
    } catch (e) {
      setError('PDF: ' + String(e));
    }
    if (pdfInput.current) pdfInput.current.value = '';
  };

  const nombres = useMemo(() => {
    if (!ficha) return [];
    const expandidas = hojaInstanciable
      ? expandirInstancias(ficha.rows, hojaInstanciable, instancias)
      : ficha.rows.map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
    return generarNombres(expandidas);
  }, [ficha, hojaInstanciable, instancias]);

  const colisiones = useMemo(() => contarColisiones(nombres), [nombres]);

  const filasFicha = useMemo(() => {
    const base =
      filtro === 'todas'
        ? nombres
        : filtro === 'colision'
          ? nombres.filter((n) => n.colision)
          : nombres.filter((n) => n.fila.destino === filtro);
    const s = q.toLowerCase();
    return s
      ? base.filter((n) =>
          (n.fila.nombrePdf + n.fila.label + n.fila.campoJson + n.fila.hoja + n.nombre).toLowerCase().includes(s),
        )
      : base;
  }, [nombres, filtro, q]);

  const leavesFiltradas = useMemo(() => {
    if (!pdf) return [];
    const s = q.toLowerCase();
    return s ? pdf.leaves.filter((l) => l.name.toLowerCase().includes(s)) : pdf.leaves;
  }, [pdf, q]);

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Barra */}
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0">
        <Button onClick={() => setView('home')}>
          <ArrowLeft size={15} /> Inicio
        </Button>
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <FileSignature size={16} /> Etapa 0 · Renombrado asistido
        </span>
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">v1.2.0 · nombres propuestos</span>
        <div className="flex-1" />
        <input ref={fichaInput} type="file" accept=".xlsx,.xls" hidden onChange={onFicha} />
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={onPdf} />
        <Button onClick={() => fichaInput.current?.click()}>
          <Upload size={15} /> Ficha cruda{ficha ? ' ✓' : ''}
        </Button>
        <Button onClick={() => pdfInput.current?.click()}>
          <FileText size={15} /> PDF crudo{pdf ? ' ✓' : ''}
        </Button>
      </header>

      <div className="px-3 py-2 shrink-0">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <b>Importante:</b> el renombrado va <b>siempre antes</b> de cargar el PDF en Signframe. Si lo cargás primero,
          el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        {(ficha || pdf) && (
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mt-2">
            {ficha && (
              <>
                <Stat n={ficha.stats.filasDatos} l="filas ficha" />
                <Stat n={ficha.stats.pdf} l="van al PDF" tone="text-emerald-700" />
                <Stat n={ficha.stats.soloJson} l="solo JSON" />
                <Stat n={ficha.stats.excluidas} l="excluidas" tone="text-red-600" />
                <Stat n={ficha.stats.filasMarcadorHoja} l="marcador hoja" />
                <Stat
                  n={Object.keys(colisiones).length}
                  l="colisiones"
                  tone={Object.keys(colisiones).length ? 'text-red-600' : 'text-slate-700'}
                />
              </>
            )}
            {pdf && (
              <>
                <Stat n={pdf.leaves.length} l="campos PDF" tone="text-brand-700" />
                <Stat n={pdf.totalWidgets} l="widgets" />
                <Stat n={pdf.pageCount} l="páginas" />
                <Stat
                  n={pdf.sospechosos.length}
                  l="multi-widget /Tx"
                  tone={pdf.sospechosos.length ? 'text-amber-600' : 'text-slate-700'}
                />
              </>
            )}
          </div>
        )}

        {pdf && pdf.sospechosos.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <b>{pdf.sospechosos.length} campo(s) /Tx con varios widgets</b> — un /Btn multi-widget es normal (grupo de
            radios), pero un /Tx no: suele ser una colisión del PDF original. Clickeá uno para resaltar todos sus
            widgets.{' '}
            {pdf.sospechosos.map((l) => (
              <button
                key={l.name}
                onClick={() => setSelected(l.name)}
                className="underline decoration-dotted mr-2"
                title={`páginas ${l.paginas.map((x) => x + 1).join(', ')}`}
              >
                {l.name} ×{l.widgets.length} [p{l.paginas.map((x) => x + 1).join(',')}]
              </button>
            ))}
          </div>
        )}
        {Object.keys(colisiones).length > 0 && (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            <b>Colisiones entre nombres propuestos</b> (se marcan, no se desambiguan solas):{' '}
            {Object.entries(colisiones).map(([n, c]) => `${n} ×${c}`).join(' · ')}
          </div>
        )}
        {ficha && ficha.filasIgnoradas.length > 0 && (
          <div className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-600">
            <b>{ficha.filasIgnoradas.length} fila(s) con contenido no contadas:</b>{' '}
            {ficha.filasIgnoradas.map((f) => `${f.hoja} R${f.fila}`).join(', ')}
          </div>
        )}
      </div>

      {/* Instancias */}
      {hojaInstanciable && instancias.length > 0 && (
        <div className="px-3 pb-2 shrink-0">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] font-medium text-slate-600 mb-1">
              Instancias del bloque <code>{hojaInstanciable}</code> — el PDF lo repite una vez por instancia.
              Los índices son decisión tuya.
            </div>
            <div className="flex flex-wrap gap-3">
              {instancias.map((inst, i) => (
                <div key={inst.codigo} className="flex items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={inst.activa}
                    onChange={(e) =>
                      setInstancias((prev) => prev.map((x, j) => (j === i ? { ...x, activa: e.target.checked } : x)))
                    }
                  />
                  <span className="font-medium text-slate-700 w-10">{inst.codigo}</span>
                  <label className="text-slate-400">prefijo</label>
                  <input
                    value={inst.prefijo}
                    onChange={(e) =>
                      setInstancias((prev) => prev.map((x, j) => (j === i ? { ...x, prefijo: e.target.value } : x)))
                    }
                    className="w-20 rounded border border-slate-300 px-1 py-0.5 font-mono"
                  />
                  <label className="text-slate-400">personas[</label>
                  <input
                    type="number"
                    value={inst.indice}
                    onChange={(e) =>
                      setInstancias((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, indice: Number(e.target.value) } : x)),
                      )
                    }
                    className="w-12 rounded border border-slate-300 px-1 py-0.5"
                  />
                  <span className="text-slate-400">]</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Dos paneles */}
      <div className="flex-1 min-h-0 flex gap-2 px-3 pb-3">
        {/* Izquierda */}
        <div className="w-1/2 min-w-0 flex flex-col rounded-md border border-slate-200 bg-white">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200">
            <div className="flex gap-1">
              <button
                onClick={() => setTab('ficha')}
                className={`text-xs rounded px-2 py-1 ${tab === 'ficha' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Ficha {ficha ? `(${ficha.stats.filasDatos})` : ''}
              </button>
              <button
                onClick={() => setTab('pdf')}
                className={`text-xs rounded px-2 py-1 ${tab === 'pdf' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Campos PDF {pdf ? `(${pdf.leaves.length})` : ''}
              </button>
            </div>
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1 text-xs outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {tab === 'ficha' && (
            <>
              <div className="flex gap-1 px-2 py-1 border-b border-slate-100">
                {(['pdf', 'solo-json', 'excluida', 'colision', 'todas'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={`text-[11px] rounded px-2 py-0.5 border ${
                      filtro === f ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-auto scroll-thin">
                {!ficha && <p className="text-xs text-slate-400 p-4 text-center">Cargá la ficha cruda (.xlsx).</p>}
                <table className="w-full text-[11px]">
                  <tbody>
                    {filasFicha.map((n, i) => {
                      const r = n.fila;
                      return (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-2 py-1 text-slate-400 whitespace-nowrap">
                            {r.hoja}·{r.fila}
                            {r.instancia && (
                              <span className="ml-1 text-brand-600">{r.instancia.codigo}[{r.indiceInstancia}]</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-slate-700 truncate max-w-[150px]" title={r.nombrePdf}>
                            {r.nombrePdf}
                          </td>
                          <td className="px-2 py-1 text-slate-400 truncate max-w-[80px]">{r.valor}</td>
                          <td
                            className={`px-2 py-1 font-mono truncate max-w-[190px] ${
                              n.colision ? 'text-red-600 font-semibold' : 'text-brand-700'
                            }`}
                            title={n.colision ? `COLISIÓN: ${n.nombre}` : n.nombre}
                          >
                            {n.nombre}
                          </td>
                          <td className="px-2 py-1">
                            <span className={`rounded px-1 ${DESTINO_STYLE[r.destino]}`} title={r.motivo}>
                              {r.motivo ?? r.destino}
                            </span>
                            {!r.hojaAplica && (
                              <span className="ml-1 rounded px-1 bg-red-50 text-red-500" title="La hoja no aplica a este formulario">
                                hoja✕
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'pdf' && (
            <div className="flex-1 overflow-auto scroll-thin">
              {!pdf && <p className="text-xs text-slate-400 p-4 text-center">Cargá el PDF crudo.</p>}
              <table className="w-full text-[11px]">
                <tbody>
                  {leavesFiltradas.map((l) => (
                    <tr
                      key={l.name + l.readingIndex}
                      onClick={() => setSelected(l.name)}
                      className={`border-b border-slate-50 cursor-pointer ${
                        selected === l.name ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-2 py-1 text-slate-400 w-8 text-right">{l.readingIndex}</td>
                      <td className="px-2 py-1 font-mono text-slate-700 truncate max-w-[240px]" title={l.name}>
                        {l.name}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{l.ft.replace('/', '')}</td>
                      <td className="px-2 py-1 text-slate-400">p{l.page + 1}</td>
                      <td className="px-2 py-1 text-slate-300">
                        {l.widgets.length > 1 ? `${l.widgets.length}w` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Derecha: PDF con overlay */}
        <div className="w-1/2 min-w-0 rounded-md border border-slate-200 bg-white">
          <PdfPreview file={pdfFile} leaves={pdf?.leaves ?? []} selected={selected} onSelect={setSelected} />
        </div>
      </div>
    </div>
  );
}
