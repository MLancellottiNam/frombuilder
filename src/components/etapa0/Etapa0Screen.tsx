import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Download,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Search,
  Upload,
} from 'lucide-react';
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
import { alinear, type Asignacion, type Confianza } from '../../lib/etapa0/align';
import { escribirPdfRenombrado } from '../../lib/etapa0/writePdf';
import { escribirFichaConColN, detectarAvisosColM, etiquetaAviso, type ValoresColN } from '../../lib/etapa0/writeFicha';
import { construirReporte } from '../../lib/etapa0/reporte';
import { downloadCsv } from '../../lib/matrixOut';
import { slugify } from '../../lib/exporter';
import TablaCampos, { nombreEfectivo, type Ediciones } from './TablaCampos';
import PdfPreview from './PdfPreview';

/** Clave estable de una fila de ficha (sobrevive a reordenamientos). */
function claveFila(hoja: string, fila: number, codigo?: string | null): string {
  return `${hoja}|${fila}|${codigo ?? ''}`;
}

function descargarBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Paso({ ok, n, children }: { ok: boolean; n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      {ok ? (
        <CheckCircle2 size={13} className="text-emerald-600 mt-[1px] shrink-0" />
      ) : (
        <Circle size={13} className="text-slate-300 mt-[1px] shrink-0" />
      )}
      <span className={ok ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-700'}>
        <b className="text-slate-400 mr-1">{n}.</b>
        {children}
      </span>
    </li>
  );
}

const CONF_STYLE: Record<string, string> = {
  alta: 'bg-blue-50 text-blue-700',
  media: 'bg-amber-50 text-amber-700',
  revisar: 'bg-red-50 text-red-600',
};

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
  const [fichaFile, setFichaFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<PdfFieldsResult | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ficha' | 'pdf'>('ficha');
  const [filtro, setFiltro] = useState<RowDestino | 'todas' | 'colision'>('pdf');
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [hojaInstanciable, setHojaInstanciable] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [ediciones, setEdiciones] = useState<Ediciones>({});
  const [limitarFuente, setLimitarFuente] = useState(true);
  const [tamanoFuente, setTamanoFuente] = useState(10);
  const [descargas, setDescargas] = useState({ pdf: false, ficha: false, reporte: false });
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [avisoEscritura, setAvisoEscritura] = useState<string | null>(null);

  const onFicha = async () => {
    const f = fichaInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    setFichaFile(f);
    setDescargas((d) => ({ ...d, ficha: false, reporte: false }));
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
    setDescargas({ pdf: false, ficha: false, reporte: false });
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

  /** Solo las filas que van al PDF participan de la alineación. */
  const filasPdf = useMemo(() => nombres.filter((n) => n.fila.destino === 'pdf'), [nombres]);

  const align = useMemo(() => {
    if (!pdf || filasPdf.length === 0) return null;
    return alinear(
      filasPdf.map((n) => ({
        nombrePdf: n.fila.nombrePdf,
        valor: n.fila.valor,
        tipo: n.fila.tipo,
        nombrePropuesto: n.nombre,
      })),
      pdf.leaves,
    );
  }, [pdf, filasPdf]);

  // Siembra las ediciones con lo que propuso la pre-alineación. Nunca pisa lo
  // que el usuario tocó a mano (`manual`).
  useEffect(() => {
    if (!align || !pdf) return;
    setEdiciones((prev) => {
      const next: Ediciones = { ...prev };
      for (const a of align.asignaciones) {
        const propuesto = filasPdf[a.filaIdx]?.nombre ?? '';
        a.leafIdx.forEach((li, parte) => {
          if (next[li]?.manual) return;
          // En una relación 1:N cada caja necesita nombre propio; se numeran por
          // posición (estructural, no es desambiguación de colisión).
          const nombre = propuesto && a.leafIdx.length > 1 ? `${propuesto}_${parte + 1}` : propuesto;
          next[li] = {
            nombreNuevo: nombre,
            filaIdx: a.filaIdx,
            tipo: pdf.leaves[li].ft,
            manual: false,
          };
        });
      }
      return next;
    });
  }, [align, pdf, filasPdf]);

  /** Nombre final de cada campo (editado o el actual) + colisiones. */
  const colisionesPdf = useMemo(() => {
    const cuenta = new Map<string, number>();
    (pdf?.leaves ?? []).forEach((l, i) => {
      const n = nombreEfectivo(l, ediciones[i]);
      cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
    });
    return new Set([...cuenta.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [pdf, ediciones]);

  /** leafName(actual) -> nombre final, para el badge del overlay. */
  const nombreFinalPorLeaf = useMemo(() => {
    const m = new Map<string, string>();
    (pdf?.leaves ?? []).forEach((l, i) => m.set(l.name, nombreEfectivo(l, ediciones[i])));
    return m;
  }, [pdf, ediciones]);

  /** leafName -> confianza, para pintar el overlay. */
  const confianzaPorLeaf = useMemo(() => {
    const m = new Map<string, Confianza>();
    if (!align || !pdf) return m;
    for (const a of align.asignaciones) {
      for (const li of a.leafIdx) m.set(pdf.leaves[li].name, a.confianza);
    }
    return m;
  }, [align, pdf]);

  /** filaIdx (dentro de filasPdf) -> asignación */
  const asigPorFila = useMemo(() => {
    const m = new Map<number, (typeof align extends null ? never : NonNullable<typeof align>)['asignaciones'][number]>();
    align?.asignaciones.forEach((a) => m.set(a.filaIdx, a));
    return m;
  }, [align]);

  /** leafIdx -> asignación de la pre-alineación (para el reporte). */
  const asigPorLeaf = useMemo(() => {
    const m = new Map<number, Asignacion>();
    align?.asignaciones.forEach((a) => a.leafIdx.forEach((li) => m.set(li, a)));
    return m;
  }, [align]);

  /** Erratas de tipeo de la col M. Se reportan, NO se corrigen. */
  const avisosColM = useMemo(() => (ficha ? detectarAvisosColM(ficha.rows) : []), [ficha]);

  // --- v1.5.0: escritura --------------------------------------------------

  const baseNombre = useMemo(
    () => slugify((pdfFile?.name ?? ficha?.sheets[0]?.name ?? 'formulario').replace(/\.pdf$/i, '')),
    [pdfFile, ficha],
  );

  /** leafIdx -> fila de ficha asignada (según la edición vigente). */
  const filaDeLeaf = (i: number) => {
    const idx = ediciones[i]?.filaIdx;
    return idx == null ? null : (filasPdf[idx] ?? null);
  };

  const doDescargarPdf = async () => {
    if (!pdfFile || !pdf) return;
    if (colisionesPdf.size > 0) {
      setError('Hay colisiones de nombre: resolvelas antes de escribir el PDF.');
      return;
    }
    setTrabajando('pdf');
    setError(null);
    try {
      const renombres = new Map<string, string>();
      pdf.leaves.forEach((l, i) => {
        const final = nombreEfectivo(l, ediciones[i]);
        if (final !== l.name) renombres.set(l.name, final);
      });
      const r = await escribirPdfRenombrado(await pdfFile.arrayBuffer(), renombres, {
        limitarFuente,
        tamanoFuente,
      });
      descargarBytes(r.bytes, `${baseNombre}-renombrado.pdf`, 'application/pdf');
      setDescargas((d) => ({ ...d, pdf: true }));
      setAvisoEscritura(
        `PDF escrito: ${r.renombrados} de ${r.campos} campos renombrados, ${r.limpiados} con valor borrado.` +
          (r.warnings.length ? ' · ' + r.warnings.join(' · ') : ''),
      );
    } catch (e) {
      setError('No se pudo escribir el PDF: ' + String(e));
    } finally {
      setTrabajando(null);
    }
  };

  const doDescargarFicha = async () => {
    if (!fichaFile || !ficha || !pdf) return;
    setTrabajando('ficha');
    setError(null);
    try {
      // Una fila de ficha puede corresponder a varios campos del PDF (1:N, y
      // también las instancias, que comparten la fila de origen). Se listan
      // todos separados por coma: la col N tiene que decir la verdad completa.
      const porFila = new Map<string, { hoja: string; fila: number; nombres: string[] }>();
      pdf.leaves.forEach((l, i) => {
        const np = filaDeLeaf(i);
        if (!np) return;
        const k = claveFila(np.fila.hoja, np.fila.fila);
        if (!porFila.has(k)) porFila.set(k, { hoja: np.fila.hoja, fila: np.fila.fila, nombres: [] });
        porFila.get(k)!.nombres.push(nombreEfectivo(l, ediciones[i]));
      });
      const valores: ValoresColN = new Map();
      for (const { hoja, fila, nombres } of porFila.values()) {
        if (!valores.has(hoja)) valores.set(hoja, new Map());
        valores.get(hoja)!.set(fila, nombres.join(', '));
      }
      const colPorHoja = new Map(ficha.sheets.map((s) => [s.name, s.colCampoPdfInterno]));
      const r = await escribirFichaConColN(await fichaFile.arrayBuffer(), valores, { colPorHoja });
      descargarBytes(
        r.bytes,
        `${baseNombre}-ficha-col-n.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      setDescargas((d) => ({ ...d, ficha: true }));
      setAvisoEscritura(
        `Ficha escrita: ${r.celdasEscritas} celdas de col N en ${r.hojasTocadas} hoja(s).` +
          (r.warnings.length ? ' · ' + r.warnings.join(' · ') : ''),
      );
    } catch (e) {
      setError('No se pudo escribir la ficha: ' + String(e));
    } finally {
      setTrabajando(null);
    }
  };

  const doDescargarReporte = () => {
    if (!pdf) return;
    const rep = construirReporte({
      leaves: pdf.leaves,
      nombreFinal: (i) => nombreEfectivo(pdf.leaves[i], ediciones[i]),
      filaDeLeaf,
      confianzaDeLeaf: (i) => asigPorLeaf.get(i)?.confianza,
      motivosDeLeaf: (i) => asigPorLeaf.get(i)?.motivos ?? [],
      huerfanosFicha: (align?.huerfanosFicha ?? []).map((idx) => filasPdf[idx]).filter(Boolean),
      colisiones: colisionesPdf,
      avisosColM,
    });
    downloadCsv(rep.csv, `${baseNombre}-reporte-etapa0.csv`);
    setDescargas((d) => ({ ...d, reporte: true }));
    setAvisoEscritura(
      `Reporte: ${rep.resumen.asignados} asignados · ${rep.resumen.huerfanosPdf} huérfanos PDF · ` +
        `${rep.resumen.huerfanosFicha} huérfanos ficha · ${rep.resumen.colisiones} colisiones · ${rep.resumen.avisos} avisos col M.`,
    );
  };

  // --- persistencia dentro del proyecto ------------------------------------

  const etapa0Guardado = useStore((s) => s.project.etapa0);
  const setEtapa0 = useStore((s) => s.setEtapa0);
  const hidratado = useRef({ ficha: false, pdf: false });

  // Hidratar instancias cuando entra la ficha.
  useEffect(() => {
    if (!ficha || hidratado.current.ficha) return;
    hidratado.current.ficha = true;
    const g = etapa0Guardado;
    if (!g) return;
    if (g.hojaInstanciable) setHojaInstanciable(g.hojaInstanciable);
    if (g.instancias.length) setInstancias(g.instancias);
    setLimitarFuente(g.limitarFuente);
    setTamanoFuente(g.tamanoFuente);
  }, [ficha, etapa0Guardado]);

  // Hidratar ediciones cuando entra el PDF (se re-atan por nombre y por clave
  // de fila; los índices no sobreviven a un cambio de instancias).
  useEffect(() => {
    if (!pdf || hidratado.current.pdf) return;
    hidratado.current.pdf = true;
    const g = etapa0Guardado;
    if (!g || !Object.keys(g.ediciones).length) return;
    const porClave = new Map(filasPdf.map((n, i) => [claveFila(n.fila.hoja, n.fila.fila, n.fila.instancia?.codigo), i]));
    setEdiciones((prev) => {
      const next: Ediciones = { ...prev };
      pdf.leaves.forEach((l, i) => {
        const e = g.ediciones[l.name];
        if (!e) return;
        next[i] = {
          nombreNuevo: e.nombreNuevo,
          filaIdx: e.filaClave != null ? (porClave.get(e.filaClave) ?? null) : null,
          tipo: e.tipo,
          manual: e.manual,
        };
      });
      return next;
    });
  }, [pdf, etapa0Guardado, filasPdf]);

  // Guardar (solo decisiones; los archivos no viajan en el proyecto).
  useEffect(() => {
    if (!ficha && !pdf) return;
    const eds: Record<string, import('../../types').Etapa0Edicion> = {};
    (pdf?.leaves ?? []).forEach((l, i) => {
      const e = ediciones[i];
      if (!e) return;
      const np = e.filaIdx == null ? null : filasPdf[e.filaIdx];
      eds[l.name] = {
        nombreNuevo: e.nombreNuevo,
        filaClave: np ? claveFila(np.fila.hoja, np.fila.fila, np.fila.instancia?.codigo) : null,
        tipo: e.tipo,
        manual: e.manual,
      };
    });
    setEtapa0({
      fichaNombre: fichaFile?.name,
      pdfNombre: pdfFile?.name,
      hojaInstanciable,
      instancias,
      ediciones: eds,
      limitarFuente,
      tamanoFuente,
      pdfDescargado: descargas.pdf,
      fichaDescargada: descargas.ficha,
      reporteDescargado: descargas.reporte,
    });
  }, [
    ficha, pdf, fichaFile, pdfFile, hojaInstanciable, instancias, ediciones, filasPdf,
    limitarFuente, tamanoFuente, descargas, setEtapa0,
  ]);

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
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">v1.5.0 · escritura y hand-off</span>
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
                <Stat
                  n={ficha.stats.filasNota}
                  l="filas-nota"
                  tone={ficha.stats.filasNota ? 'text-amber-600' : 'text-slate-700'}
                />
                <Stat n={ficha.stats.filasMarcadorHoja} l="marcador hoja" />
                <Stat
                  n={Object.keys(colisiones).length}
                  l="colisiones"
                  tone={Object.keys(colisiones).length ? 'text-red-600' : 'text-slate-700'}
                />
              </>
            )}
            {align && (
              <>
                <Stat n={`${align.stats.pctAlta}%`} l="confianza alta" tone="text-emerald-700" />
                <Stat n={align.stats.media} l="media" tone="text-amber-600" />
                <Stat n={align.stats.revisar} l="revisar" tone="text-red-600" />
                <Stat n={align.stats.relaciones1aN} l="1:N" />
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
        {align && (align.huerfanosFicha.length > 0 || align.huerfanosPdf.length > 0) && (
          <div className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-600">
            <b>Huérfanos</b> — {align.huerfanosFicha.length} fila(s) de ficha sin campo PDF ·{' '}
            {align.huerfanosPdf.length} campo(s) PDF sin fila.{' '}
            {align.huerfanosPdf.length > 0 && (
              <span className="text-slate-400">
                ({align.huerfanosPdf.slice(0, 8).map((i) => pdf!.leaves[i].name).join(', ')}
                {align.huerfanosPdf.length > 8 ? '…' : ''})
              </span>
            )}
          </div>
        )}
        {colisionesPdf.size > 0 && (
          <div className="mt-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            <b>{colisionesPdf.size} colisión(es) de nombre en el PDF</b> — bloquean la descarga del PDF renombrado hasta
            resolverlas: {[...colisionesPdf].slice(0, 10).join(' · ')}
            {colisionesPdf.size > 10 ? '…' : ''}
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

      {/* Hand-off: escribir y pasar a Etapa 1 */}
      {ficha && pdf && (
        <div className="px-3 pb-2 shrink-0">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2" data-handoff>
            <div className="flex flex-wrap items-start gap-4">
              <ol className="text-[11px] space-y-0.5 min-w-[280px]">
                <Paso ok={!!ficha && !!pdf} n={1}>
                  Cargar la ficha cruda y el PDF crudo
                </Paso>
                <Paso ok={colisionesPdf.size === 0} n={2}>
                  Resolver colisiones y revisar los <b>media</b> / <b>revisar</b>
                </Paso>
                <Paso ok={descargas.pdf} n={3}>
                  Descargar el <b>PDF renombrado</b> — y recién ahí subirlo a Signframe
                </Paso>
                <Paso ok={descargas.ficha && descargas.reporte} n={4}>
                  Descargar la <b>ficha con la col N</b> y el <b>reporte</b>
                </Paso>
              </ol>

              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    onClick={doDescargarPdf}
                    disabled={colisionesPdf.size > 0 || trabajando !== null}
                    title={
                      colisionesPdf.size > 0
                        ? `Bloqueado por ${colisionesPdf.size} colisión(es) de nombre: ` +
                          [...colisionesPdf].slice(0, 5).join(' · ') +
                          (colisionesPdf.size > 5 ? ' …' : '')
                        : 'Escribe el PDF con los nombres nuevos'
                    }
                    data-dl="pdf"
                  >
                    <Download size={14} /> {trabajando === 'pdf' ? 'Escribiendo…' : 'PDF renombrado'}
                  </Button>
                  <Button onClick={doDescargarFicha} disabled={!fichaFile || trabajando !== null} data-dl="ficha">
                    <FileSpreadsheet size={14} /> {trabajando === 'ficha' ? 'Escribiendo…' : 'Ficha con col N'}
                  </Button>
                  <Button onClick={doDescargarReporte} disabled={trabajando !== null} data-dl="reporte">
                    <FileText size={14} /> Reporte CSV
                  </Button>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={limitarFuente}
                    onChange={(e) => setLimitarFuente(e.target.checked)}
                  />
                  Topear el tamaño de fuente en
                  <input
                    type="number"
                    min={4}
                    max={24}
                    value={tamanoFuente}
                    onChange={(e) => setTamanoFuente(Number(e.target.value) || 10)}
                    disabled={!limitarFuente}
                    className="w-12 rounded border border-slate-300 px-1 py-0.5 disabled:opacity-40"
                  />
                  pt
                </label>
              </div>

              <div className="flex-1" />
              <Button
                onClick={() => setView('builder')}
                disabled={!descargas.pdf}
                title={descargas.pdf ? '' : 'Descargá primero el PDF renombrado: Etapa 1 y 2 trabajan sobre ese PDF.'}
                data-continuar
              >
                Continuar a Etapa 1 <ArrowRight size={14} />
              </Button>
            </div>

            {avisoEscritura && <p className="mt-1.5 text-[11px] text-emerald-700">{avisoEscritura}</p>}
            {avisosColM.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-700">
                <b>{avisosColM.length} aviso(s) de tipeo en la col M</b> (se reportan, no se corrigen):{' '}
                {avisosColM.slice(0, 4).map((a) => `${a.hoja}·${a.fila} ${etiquetaAviso(a.tipo)} ${a.detalle}`).join(' · ')}
                {avisosColM.length > 4 ? ' …' : ''}
              </p>
            )}
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
                      const idxEnPdf = filasPdf.indexOf(n);
                      const asig = idxEnPdf >= 0 ? asigPorFila.get(idxEnPdf) : undefined;
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
                            {asig ? (
                              <span
                                className={`rounded px-1 ${CONF_STYLE[asig.confianza]}`}
                                title={[...asig.motivos, `campo(s): ${asig.leafIdx.map((li) => pdf!.leaves[li].name).join(', ')}`].join(' · ')}
                              >
                                {asig.confianza}
                                {asig.leafIdx.length > 1 ? ` 1:${asig.leafIdx.length}` : ''}
                              </span>
                            ) : (
                              <span
                                className={`rounded px-1 ${DESTINO_STYLE[r.destino]}`}
                                title={[r.motivo, ...(r.notaSeñales ?? [])].filter(Boolean).join(' · ')}
                              >
                                {r.motivo ?? r.destino}
                              </span>
                            )}
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

          {tab === 'pdf' &&
            (!pdf ? (
              <p className="text-xs text-slate-400 p-4 text-center">Cargá el PDF crudo.</p>
            ) : (
              <TablaCampos
                leaves={pdf.leaves}
                filasPdf={filasPdf}
                ediciones={ediciones}
                setEdiciones={setEdiciones}
                confianzaPorLeaf={confianzaPorLeaf}
                colisiones={colisionesPdf}
                selected={selected}
                onSelect={setSelected}
                query={q}
              />
            ))}
        </div>

        {/* Derecha: PDF con overlay */}
        <div className="w-1/2 min-w-0 rounded-md border border-slate-200 bg-white">
          <PdfPreview
            file={pdfFile}
            leaves={pdf?.leaves ?? []}
            selected={selected}
            onSelect={setSelected}
            confianza={confianzaPorLeaf}
            nombreFinal={nombreFinalPorLeaf}
            colisiones={colisionesPdf}
          />
        </div>
      </div>
    </div>
  );
}
