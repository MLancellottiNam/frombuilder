import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
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
import { nanoid } from 'nanoid';
import { useStore } from '../../store/store';
import { BADGE } from '../../version';
import { Button } from '../ui';
import { readFichaRaw, norm, type FichaRawResult, type RowDestino } from '../../lib/etapa0/fichaRaw';
import { readPdfFields, type PdfFieldsResult, type PdfLeaf as PdfLeafTipo } from '../../lib/etapa0/pdfFields';
import {
  detectarBloquesInstanciables,
  instanciasPorDefecto,
  expandirInstancias,
  generarNombres,
  contarColisiones,
  marcarGruposDeOpciones,
  type Instancia,
} from '../../lib/etapa0/acroName';
import { alinear, alinearPorSegmentos, type Asignacion, type Confianza, type Segmento } from '../../lib/etapa0/align';
import {
  anclasDeTexto,
  colorRegion,
  construirSegmentos,
  elegibilidadPorRegion,
  etiquetasDeLeaf,
  evidenciaEnContra,
  evidenciaFuerte,
  extraerTextoPdf,
  sembrarRegiones,
  type BandaOpciones,
  type FilaAncla,
  type GrupoOpciones,
  type Region,
  type TextItem,
} from '../../lib/etapa0/regiones';
import { escribirPdfRenombrado } from '../../lib/etapa0/writePdf';
import { escribirFichaConColN, detectarAvisosColM, etiquetaAviso, type ValoresColN } from '../../lib/etapa0/writeFicha';
import { construirReporte } from '../../lib/etapa0/reporte';
import { downloadCsv } from '../../lib/matrixOut';
import { slugify } from '../../lib/exporter';
import {
  aplicarCambios,
  claveEstable,
  remapearPorClave,
  trocearRect,
  type CampoCreado,
} from '../../lib/etapa0/camposManuales';
import { sufijosDeFormato } from '../../lib/etapa0/regiones';
import { aplicarRects, claveRect, paraEscritura, type RectsEditados } from '../../lib/etapa0/rects';
import TablaCampos, { nombreEfectivo, type Ediciones } from './TablaCampos';
import ModoRevision from './ModoRevision';
import PanelCampo from './PanelCampo';
import PanelCrearCampo, { type DatosCampoNuevo } from './PanelCrearCampo';
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

/** Un paso del resumen: número, título y el contenido accionable. */
function Bloque({
  n,
  titulo,
  ok,
  children,
}: {
  n: number;
  titulo: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0" data-bloque={n}>
      <span
        className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0 ${
          ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
        }`}
      >
        {ok ? '✓' : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{titulo}</div>
        <div className="text-xs mt-0.5">{children}</div>
      </div>
    </div>
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
  const [hojasBloque, setHojasBloque] = useState<string[]>([]);
  const [textoPdf, setTextoPdf] = useState<TextItem[]>([]);
  const [regiones, setRegiones] = useState<Region[]>([]);
  const [avisosRegion, setAvisosRegion] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [ediciones, setEdiciones] = useState<Ediciones>({});
  const [limitarFuente, setLimitarFuente] = useState(true);
  const [tamanoFuente, setTamanoFuente] = useState(10);
  const [descargas, setDescargas] = useState({ pdf: false, ficha: false, reporte: false });
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [avisoEscritura, setAvisoEscritura] = useState<string | null>(null);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  /**
   * v1.4.5: la vista simple es el default. Deja adelante lo que hay que decidir
   * y guarda el diagnóstico del motor —stats, instancias, regiones, tabla de
   * ficha, edición en lote— en la avanzada. No cambia ningún cálculo: los
   * mismos números se siguen calculando, solo no se muestran todos a la vez.
   */
  const [vistaSimple, setVistaSimple] = useState(true);
  const [modoRevision, setModoRevision] = useState(false);
  const [revIdx, setRevIdx] = useState(0);
  /** nombres ACTUALES de campos que el usuario confirmó a mano en la revisión */
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [creados, setCreados] = useState<CampoCreado[]>([]);
  const [borrados, setBorrados] = useState<string[]>([]);
  const [dibujo, setDibujo] = useState<{ page: number; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  /** v2.0.0: geometría editada a mano, por `claveEstable#widget` del ORIGINAL */
  const [rectsEditados, setRectsEditados] = useState<RectsEditados>({});

  const onFicha = async () => {
    const f = fichaInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    setFichaFile(f);
    setDescargas((d) => ({ ...d, ficha: false, reporte: false }));
    try {
      const r = await readFichaRaw(f);
      setFicha(r);
      const bloques = detectarBloquesInstanciables(r.rows, r.routing);
      if (bloques.length > 0) {
        setHojaInstanciable(bloques[0].hoja);
        setHojasBloque(bloques[0].hojas);
        setInstancias(instanciasPorDefecto(bloques[0].codigos));
      } else {
        setHojaInstanciable(null);
        setHojasBloque([]);
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
    setRegiones([]);
    try {
      const buf = await f.arrayBuffer();
      setPdf(await readPdfFields(buf));
      setTab('pdf');
      // El texto del PDF es lo que ancla las regiones de las instancias.
      try {
        setTextoPdf(await extraerTextoPdf(buf));
      } catch (e) {
        setTextoPdf([]);
        setAvisosRegion(['No se pudo leer el texto del PDF: las regiones hay que definirlas a mano. ' + String(e)]);
      }
    } catch (e) {
      setError('PDF: ' + String(e));
    }
    if (pdfInput.current) pdfInput.current.value = '';
  };

  /**
   * Lista EFECTIVA de campos: detectados − borrados + creados, reordenada por
   * orden de lectura. Es la que ve la UI, la que se alinea y la que se escribe.
   */
  // Los rects editados se aplican ANTES de `aplicarCambios` para que el
  // reordenamiento por orden de lectura vea la posición nueva: un campo que se
  // movió tiene que aparecer donde está, no donde estaba.
  const cambios = useMemo(
    () => (pdf ? aplicarCambios(aplicarRects(pdf.leaves, rectsEditados), creados, borrados) : null),
    [pdf, creados, borrados, rectsEditados],
  );
  const leaves = cambios?.efectivos ?? [];

  /**
   * Crear o borrar un campo corre TODOS los índices, y `ediciones` está indexada
   * por posición: sin remapear, el nombre nuevo se mudaría de campo en silencio.
   * El remapeo va por identidad estable (uid para los creados, AcroName original
   * para los detectados), así que también sobrevive al caso de borrar un campo y
   * crear otro con el mismo nombre.
   */
  const leavesPrevios = useRef<typeof leaves>([]);
  useEffect(() => {
    const antes = leavesPrevios.current;
    leavesPrevios.current = leaves;
    if (antes.length === 0 || antes === leaves) return;
    const mismos =
      antes.length === leaves.length && antes.every((l, i) => claveEstable(l) === claveEstable(leaves[i]));
    if (mismos) return;
    setEdiciones((prev) => remapearPorClave(prev, antes, leaves));
  }, [leaves]);

  const nombres = useMemo(() => {
    if (!ficha) return [];
    const expandidas = hojasBloque.length
      ? expandirInstancias(ficha.rows, hojasBloque, instancias)
      : ficha.rows.map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
    return generarNombres(expandidas);
  }, [ficha, hojasBloque, instancias]);

  const colisiones = useMemo(() => contarColisiones(nombres), [nombres]);

  /** Solo las filas que van al PDF participan de la alineación. */
  const filasPdf = useMemo(() => nombres.filter((n) => n.fila.destino === 'pdf'), [nombres]);

  /**
   * Grupos de opciones del bloque repetible, contados UNA sola vez (sin
   * expandir): son las anclas con las que se siembran las regiones.
   */
  const gruposBloque = useMemo<GrupoOpciones[]>(() => {
    if (!ficha || hojasBloque.length === 0) return [];
    const filas = ficha.rows
      .filter((r) => hojasBloque.includes(r.hoja) && r.destino === 'pdf')
      .map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
    const esG = marcarGruposDeOpciones(filas);
    const out: GrupoOpciones[] = [];
    for (let i = 0; i < filas.length; ) {
      if (!esG[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < filas.length && esG[j + 1] && norm(filas[j + 1].label) === norm(filas[i].label)) j++;
      // El label del grupo es la MISMA clave con la que se identifica la fila
      // (col C, con col D como respaldo), si no la señal de banda no coincide.
      out.push({
        label: filas[i].nombrePdf || filas[i].label,
        valores: filas.slice(i, j + 1).map((x) => x.valor),
      });
      i = j + 1;
    }
    return out;
  }, [ficha, hojasBloque]);

  const activas = useMemo(() => instancias.filter((i) => i.activa), [instancias]);

  const siembra = useMemo(() => {
    if (!pdf || activas.length === 0 || textoPdf.length === 0) return null;
    return sembrarRegiones(leaves, textoPdf, activas, gruposBloque);
  }, [pdf, textoPdf, activas, gruposBloque]);

  // Las regiones sembradas son ORIENTATIVAS: entran como estado editable y las
  // que el usuario ya tocó (`origen === 'manual'`) no se pisan.
  const bandas = useMemo<BandaOpciones[]>(() => siembra?.bandas ?? [], [siembra]);

  useEffect(() => {
    if (!siembra) return;
    setAvisosRegion(siembra.avisos);
    setRegiones((prev) => {
      const manuales = new Map(prev.filter((r) => r.origen === 'manual').map((r) => [r.codigo, r]));
      return siembra.regiones.map((r) => manuales.get(r.codigo) ?? r);
    });
  }, [siembra]);

  /**
   * Un segmento por región (filas de esa instancia contra campos de esa región)
   * más un segmento `libre` con todo lo que queda afuera.
   */
  /**
   * A qué instancias se le ofrece cada fila del bloque: solo a aquellas cuya
   * región tiene su clave IMPRESA. Sin este filtro, ASG recibía las filas de
   * Persona Jurídica y el DP las metía en los huecos de la sección Física.
   */
  const elegibilidad = useMemo(() => {
    if (!pdf || regiones.length === 0 || textoPdf.length === 0) return null;
    return elegibilidadPorRegion(
      leaves,
      regiones,
      textoPdf,
      filasPdf
        .filter((n) => n.fila.instancia)
        .map((n) => ({
          clave: `${n.fila.hoja}|${n.fila.fila}`,
          nombrePdf: n.fila.nombrePdf,
          valor: n.fila.valor,
          esOpcion: !!n.partes.sufijo,
        })),
    );
  }, [pdf, regiones, textoPdf, filasPdf]);

  const segmentos = useMemo<Segmento[]>(() => {
    if (!pdf || regiones.length === 0) return [];
    const segs = construirSegmentos(
      leaves.length,
      regiones,
      filasPdf.map((n) => {
        if (!n.fila.instancia || !elegibilidad) return { codigo: n.fila.instancia?.codigo ?? null };
        const donde = elegibilidad.porFila.get(`${n.fila.hoja}|${n.fila.fila}`) ?? [];
        // Sin match en ninguna región = hueco de vocabulario: elegible en todas.
        return { codigo: n.fila.instancia.codigo, elegibleEn: donde.length ? donde : null };
      }),
    );
    if (textoPdf.length === 0) return segs;
    // Anclas por la etiqueta impresa del PDF, dentro de cada segmento.
    for (const seg of segs) {
      const fa: FilaAncla[] = seg.filaIdxs.map((i) => ({
        idx: i,
        nombrePdf: filasPdf[i].fila.nombrePdf,
        valor: filasPdf[i].fila.valor,
        // `partes.sufijo` no está vacío exactamente cuando la fila es una opción
        // de un grupo: es la misma señal con la que se armó el nombre.
        esOpcion: !!filasPdf[i].partes.sufijo,
        grupo: filasPdf[i].partes.base,
        tipo: filasPdf[i].fila.tipo,
      }));
      const r = anclasDeTexto(fa, leaves, seg.leafIdxs, textoPdf);
      seg.anclas = r.anclas;
      // `opcionesForaneas` NO se aplica: desde v1.4.3 lo hace `elegibilidad`,
      // que además distingue "vive en otra región" de "se llama distinto en el
      // PDF" y no deja huérfana a la opción «Física» (impresa «Cédula»).
    }
    return segs;
  }, [pdf, regiones, filasPdf, textoPdf, elegibilidad]);

  const align = useMemo(() => {
    if (!pdf || filasPdf.length === 0) return null;
    const alineables = filasPdf.map((n) => ({
      nombrePdf: n.fila.nombrePdf,
      valor: n.fila.valor,
      tipo: n.fila.tipo,
      nombrePropuesto: n.nombre,
    }));
    if (segmentos.length === 0) return alinear(alineables, leaves);
    // Con regiones se alinea por segmentos, y se degrada a «revisar» todo par
    // del que haya evidencia POSITIVA de que está mal.
    const esOpcion = (i: number) => !!filasPdf[i].partes.sufijo;
    const entrada = {
      leaves: leaves,
      texto: textoPdf,
      bandas,
      claveDeFila: (k: number) => (esOpcion(k) ? filasPdf[k].fila.valor : filasPdf[k].fila.nombrePdf),
      grupoDeFila: (k: number) => (esOpcion(k) ? filasPdf[k].fila.nombrePdf : ''),
      filasDelSegmento: (k: number) => segmentos.find((sg) => sg.filaIdxs.includes(k))?.filaIdxs ?? [],
    };
    return alinearPorSegmentos(alineables, leaves, segmentos, {
      // Solo la evidencia PRECISA penaliza dentro del DP; la de banda es más
      // gruesa y como penalidad dura dejaba campos buenos sin asignar.
      evidenciaFuerte: (i, j) => evidenciaFuerte(entrada, i, j),
      evidenciaEnContra: (i, j) => evidenciaEnContra(entrada, i, j),
    });
  }, [pdf, filasPdf, segmentos, textoPdf, bandas]);

  // --- v1.4.4: crear, borrar y trocear campos -----------------------------

  /** Filas elegibles en la región donde cae un punto del PDF. */
  const filasParaDibujo = useMemo(() => {
    const todas = filasPdf.map((np, idx) => ({ idx, np }));
    if (!dibujo || segmentos.length === 0) return todas;
    const j = leaves.findIndex(
      (l) =>
        l.page === dibujo.page &&
        l.rect.y <= dibujo.rect.y + dibujo.rect.h + 20 &&
        l.rect.y + l.rect.h >= dibujo.rect.y - 20,
    );
    const seg = j >= 0 ? segmentos.find((sg) => sg.leafIdxs.includes(j)) : undefined;
    if (!seg) return todas;
    const permitidas = new Set(seg.filaIdxs);
    const filtradas = todas.filter((x) => permitidas.has(x.idx));
    return filtradas.length > 0 ? filtradas : todas;
  }, [dibujo, filasPdf, segmentos, leaves]);

  /** Crea 1 o N campos a partir del rect dibujado. */
  const crearCampos = (d: DatosCampoNuevo, rect: { x: number; y: number; w: number; h: number }, page: number) => {
    const np = d.filaIdx == null ? null : filasPdf[d.filaIdx];
    const filaClave = np ? claveFila(np.fila.hoja, np.fila.fila, np.fila.instancia?.codigo) : null;
    const cajas = trocearRect(rect, d.dividir);
    const sufijos = np ? sufijosDeFormato(np.fila.valor, d.dividir) : undefined;
    const grupo = d.dividir > 1 ? nanoid(6) : undefined;
    const nuevos: CampoCreado[] = cajas.map((r, i) => ({
      uid: nanoid(8),
      nombre: d.dividir > 1 ? `${d.nombre}_${sufijos?.[i] ?? i + 1}` : d.nombre,
      tipo: d.tipo,
      page,
      rect: r,
      filaClave,
      grupo,
      parte: d.dividir > 1 ? i + 1 : undefined,
    }));
    setCreados((prev) => [...prev, ...nuevos]);
    setDibujo(null);
    setDescargas((x) => ({ ...x, pdf: false }));
  };

  /** Borra un campo. Los detectados piden confirmación explícita. */
  const borrarCampo = (i: number) => {
    const l = leaves[i];
    if (!l) return;
    if (l.origen === 'creado' && l.uid) {
      setCreados((prev) => prev.filter((c) => c.uid !== l.uid));
    } else {
      if (
        !confirm(
          `¿Borrar el campo «${l.name}»?\n\nSe elimina del PDF de salida. Es reversible con «Restaurar campos borrados».`,
        )
      )
        return;
      setBorrados((prev) => (prev.includes(l.name) ? prev : [...prev, l.name]));
    }
    setDescargas((x) => ({ ...x, pdf: false }));
  };

  /**
   * Reemplaza un campo por N cajas dentro de su mismo rect, heredando su fila.
   * Es el caso de la fecha del CSC en un paso: el asegurado tiene una caja de
   * 88pt donde el representante tiene tres, y así quedan iguales.
   */
  const reemplazarPorN = (i: number, n: number) => {
    const l = leaves[i];
    if (!l || n < 2) return;
    const ed = ediciones[i];
    const np = ed?.filaIdx == null ? null : filasPdf[ed.filaIdx];
    const base = nombreEfectivo(l, ed);
    const sufijos = np ? sufijosDeFormato(np.fila.valor, n) : undefined;
    const grupo = nanoid(6);
    const nuevos: CampoCreado[] = trocearRect(l.rect, n).map((r, k) => ({
      uid: nanoid(8),
      nombre: `${base}_${sufijos?.[k] ?? k + 1}`,
      tipo: l.ft,
      page: l.page,
      rect: r,
      filaClave: np ? claveFila(np.fila.hoja, np.fila.fila, np.fila.instancia?.codigo) : null,
      grupo,
      parte: k + 1,
    }));
    if (l.origen === 'creado' && l.uid) setCreados((prev) => [...prev.filter((c) => c.uid !== l.uid), ...nuevos]);
    else {
      setBorrados((prev) => (prev.includes(l.name) ? prev : [...prev, l.name]));
      setCreados((prev) => [...prev, ...nuevos]);
    }
    setDescargas((x) => ({ ...x, pdf: false }));
  };

  /**
   * Mueve o redimensiona la caja de un campo. Un campo creado lleva su rect en
   * su propia definición (su identidad es el `uid`); uno detectado va a
   * `rectsEditados`, con la clave calculada sobre la lista ORIGINAL.
   */
  const editarRect = (leaf: PdfLeafTipo, widgetIdx: number, rect: { x: number; y: number; w: number; h: number }) => {
    if (leaf.origen === 'creado' && leaf.uid) {
      setCreados((prev) => prev.map((c) => (c.uid === leaf.uid ? { ...c, rect } : c)));
    } else {
      const original = pdf?.leaves.find((l) => l.name === leaf.name);
      if (!original) return;
      setRectsEditados((prev) => ({ ...prev, [claveRect(original, widgetIdx)]: rect }));
    }
    setDescargas((x) => ({ ...x, pdf: false }));
  };

  /** Mueve un borde de región a mano. Queda marcada como `manual` y no se pisa. */
  const moverRegion = (i: number, campo: 'desdeLeaf' | 'hastaLeaf', valor: number) =>
    setRegiones((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, [campo]: valor, origen: 'manual' as const, detalle: 'borde ajustado a mano' };
        // Un borde invertido no tiene sentido: se arrastra el otro.
        if (next.desdeLeaf > next.hastaLeaf) {
          if (campo === 'desdeLeaf') next.hastaLeaf = valor;
          else next.desdeLeaf = valor;
        }
        return next;
      }),
    );

  const totalAnclas = useMemo(() => segmentos.reduce((n, s2) => n + (s2.anclas?.length ?? 0), 0), [segmentos]);


  /** leafIdx -> código de instancia, para pintar las bandas y la tabla. */
  const regionPorLeaf = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of segmentos) if (s.etiqueta !== 'libre') for (const j of s.leafIdxs) m.set(j, s.etiqueta);
    return m;
  }, [segmentos]);

  // Siembra las ediciones con lo que propuso la pre-alineación. Nunca pisa lo
  // que el usuario tocó a mano (`manual`).
  //
  // El estado se RECONSTRUYE en cada alineación en vez de acumularse: si no, un
  // campo que la alineación anterior nombraba y la nueva ya no asigna se queda
  // con el nombre viejo. Eso pasaba al llegar las regiones (el pase global
  // sembraba 111 campos y el por regiones asigna 101) y producía colisiones
  // fantasma con nombres de una alineación que ya no existe.
  useEffect(() => {
    if (!align || !pdf) return;
    setEdiciones((prev) => {
      const next: Ediciones = {};
      for (const [k, v] of Object.entries(prev)) if (v.manual) next[Number(k)] = v;
      for (const a of align.asignaciones) {
        const propuesto = filasPdf[a.filaIdx]?.nombre ?? '';
        a.leafIdx.forEach((li, parte) => {
          if (next[li]?.manual) return;
          // En una relación 1:N cada caja necesita nombre propio; se numeran por
          // posición (estructural, no es desambiguación de colisión).
          // En una relación 1:N cada caja necesita nombre propio. El sufijo sale
          // del formato de la fila cuando se puede derivar (`dd/mm/aaaa` ->
          // dia/mes/ano) y si no es posicional. Es estructural y editable, no
          // desambiguación de colisión.
          const sufijo = a.sufijos?.[parte] ?? String(parte + 1);
          const nombre = propuesto && a.leafIdx.length > 1 ? `${propuesto}_${sufijo}` : propuesto;
          next[li] = {
            nombreNuevo: nombre,
            filaIdx: a.filaIdx,
            tipo: leaves[li].ft,
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
    (leaves).forEach((l, i) => {
      const n = nombreEfectivo(l, ediciones[i]);
      cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
    });
    return new Set([...cuenta.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [pdf, ediciones]);

  /** leafName(actual) -> nombre final, para el badge del overlay. */
  const nombreFinalPorLeaf = useMemo(() => {
    const m = new Map<string, string>();
    (leaves).forEach((l, i) => m.set(l.name, nombreEfectivo(l, ediciones[i])));
    return m;
  }, [pdf, ediciones]);

  /** leafName -> confianza, para pintar el overlay. */
  const confianzaPorLeaf = useMemo(() => {
    const m = new Map<string, Confianza>();
    if (!align || !pdf) return m;
    for (const a of align.asignaciones) {
      for (const li of a.leafIdx) m.set(leaves[li].name, a.confianza);
    }
    return m;
  }, [align, pdf]);

  /** filaIdx (dentro de filasPdf) -> asignación */
  const asigPorFila = useMemo(() => {
    const m = new Map<number, (typeof align extends null ? never : NonNullable<typeof align>)['asignaciones'][number]>();
    align?.asignaciones.forEach((a) => m.set(a.filaIdx, a));
    return m;
  }, [align]);

  /** leafIdx -> motivos de la asignación, para explicarlos en la revisión. */
  const motivosPorLeaf = useMemo(() => {
    const m = new Map<number, string[]>();
    align?.asignaciones.forEach((a) => a.leafIdx.forEach((li) => m.set(li, a.motivos)));
    return m;
  }, [align]);

  /**
   * Campos que necesitan atención: confianza media/revisar, o sin asignar.
   * Un campo confirmado a mano sale de la lista (pero no cambia su confianza:
   * la confirmación es estado de UI, no una re-clasificación).
   */
  const pendientes = useMemo(() => {
    if (!pdf) return [];
    return leaves
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => {
        if (confirmados.has(l.name)) return false;
        const c = confianzaPorLeaf.get(l.name);
        return c === undefined || c === 'media' || c === 'revisar';
      })
      .map(({ i }) => i);
  }, [pdf, confianzaPorLeaf, confirmados]);

  const resueltos = (pdf?.leaves.length ?? 0) - pendientes.length;

  /**
   * Seleccionar un campo —haciendo click en el PDF o en la tabla— tiene que
   * LLEVAR hasta él. Antes solo se pintaba: con 111 filas, la seleccionada
   * quedaba fuera de la pantalla y el click parecía no hacer nada. Acá se
   * asegura que la fila esté visible; el scroll lo hacen la tabla y el preview.
   */
  const seleccionar = (name: string) => {
    setSelected(name);
    setTab('pdf');
    if (!vistaSimple) setDetalleAbierto(true);
    // Un buscador con texto puede tener la fila filtrada afuera.
    if (q && !name.toLowerCase().includes(q.toLowerCase())) {
      const ed = ediciones[leaves.findIndex((l) => l.name === name)];
      if (!(ed?.nombreNuevo ?? '').toLowerCase().includes(q.toLowerCase())) setQ('');
    }
  };

  /** Índice del campo seleccionado en la lista efectiva. */
  const idxSeleccionado = useMemo(
    () => (selected ? leaves.findIndex((l) => l.name === selected) : -1),
    [selected, leaves],
  );

  /**
   * Lo que el PDF tiene IMPRESO al lado del campo seleccionado. Es el dato con
   * el que el usuario decide si el nombre está bien, y hasta ahora había que
   * buscarlo a ojo en el preview.
   */
  const etiquetaImpresa = useMemo(() => {
    if (idxSeleccionado < 0 || textoPdf.length === 0) return undefined;
    return etiquetasDeLeaf(leaves[idxSeleccionado], textoPdf);
  }, [idxSeleccionado, leaves, textoPdf]);

  /** Regiones que quedaron sin sembrar o vacías: eso sí exige intervenir. */
  const regionesProblema = useMemo(() => {
    if (!pdf || activas.length === 0) return [] as string[];
    const out: string[] = [];
    for (const inst of activas) {
      const r = regiones.find((x) => x.codigo === inst.codigo);
      if (!r) out.push(`${inst.codigo}: sin región asignada`);
      else {
        const n = (segmentos.find((sg) => sg.etiqueta === inst.codigo)?.leafIdxs.length ?? 0);
        if (n === 0) out.push(`${inst.codigo}: región con 0 campos`);
      }
    }
    return out;
  }, [pdf, activas, regiones, segmentos]);

  /**
   * Filas de ficha sin campo, partidas en dos. Las del bloque repetible que no
   * aplican a su instancia NO son un problema: son el subset por geometría
   * funcionando. En el CSC son 70 de 71, y llamarlas «huérfanas» asustaba sin
   * motivo. Ninguna fila `solo-json` ni `excluida` entra acá: la alineación
   * corre únicamente sobre las filas clasificadas como `pdf`.
   */
  const huerfanosFichaPartidos = useMemo(() => {
    const noAplican: number[] = [];
    const sinCampo: number[] = [];
    for (const i of align?.huerfanosFicha ?? []) {
      const np = filasPdf[i];
      if (!np) continue;
      if (np.fila.instancia && hojasBloque.includes(np.fila.hoja)) noAplican.push(i);
      else sinCampo.push(i);
    }
    return { noAplican, sinCampo };
  }, [align, filasPdf, hojasBloque]);

  /**
   * Confirmar saca el campo de la lista de pendientes, así que quedarse en el
   * MISMO índice ya es avanzar al siguiente. Incrementarlo además salteaba uno.
   */
  const confirmar = (leafName: string) => {
    setConfirmados((prev) => new Set(prev).add(leafName));
  };

  // Al entrar en revisión, el foco arranca en el primer pendiente.
  useEffect(() => {
    if (!modoRevision || !pdf) return;
    const i = pendientes[Math.min(revIdx, Math.max(0, pendientes.length - 1))];
    if (i != null) setSelected(leaves[i].name);
  }, [modoRevision, revIdx, pendientes, pdf]);

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
      // Los creados llevan su nombre final en la definición que se manda a
      // escribir, así que acá solo van los renombres de los detectados.
      const creadosFinales: CampoCreado[] = [];
      leaves.forEach((l, i) => {
        const final = nombreEfectivo(l, ediciones[i]);
        if (l.origen === 'creado' && l.uid) {
          const c = creados.find((x) => x.uid === l.uid);
          if (c) creadosFinales.push({ ...c, nombre: final });
          return;
        }
        if (final !== l.name) renombres.set(l.name, final);
      });
      const r = await escribirPdfRenombrado(await pdfFile.arrayBuffer(), renombres, {
        limitarFuente,
        tamanoFuente,
        creados: creadosFinales,
        borrados,
        rects: pdf ? paraEscritura(pdf.leaves, rectsEditados) : undefined,
      });
      descargarBytes(r.bytes, `${baseNombre}-renombrado.pdf`, 'application/pdf');
      setDescargas((d) => ({ ...d, pdf: true }));
      setAvisoEscritura(
        `PDF escrito: ${r.renombrados} de ${r.campos} campos renombrados, ${r.limpiados} con valor borrado` +
          (r.creados ? `, ${r.creados} creados` : '') +
          (r.borrados ? `, ${r.borrados} borrados` : '') +
          (r.movidos ? `, ${r.movidos} movidos` : '') +
          '.' +
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
      leaves.forEach((l, i) => {
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
      leaves: leaves,
      nombreFinal: (i) => nombreEfectivo(leaves[i], ediciones[i]),
      origenDeLeaf: (i) => (leaves[i].origen === 'creado' ? 'creado' : 'detectado'),
      borradosDelPdf: borrados,
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

  // La vista elegida es una preferencia de UI y no depende de los archivos: se
  // restaura al entrar a la pantalla, no al re-adjuntar la ficha.
  useEffect(() => {
    const v = useStore.getState().project.etapa0?.vistaSimple;
    if (v != null) setVistaSimple(v);
  }, []);

  // Hidratar instancias cuando entra la ficha.
  useEffect(() => {
    if (!ficha || hidratado.current.ficha) return;
    hidratado.current.ficha = true;
    const g = etapa0Guardado;
    if (!g) return;
    if (g.hojaInstanciable) setHojaInstanciable(g.hojaInstanciable);
    if (g.hojasBloque?.length) setHojasBloque(g.hojasBloque);
    if (g.instancias.length) setInstancias(g.instancias);
    setLimitarFuente(g.limitarFuente);
    setTamanoFuente(g.tamanoFuente);
    if (g.detalleAbierto != null) setDetalleAbierto(g.detalleAbierto);
    if (g.confirmados?.length) setConfirmados(new Set(g.confirmados));
    if (g.camposCreados?.length) setCreados(g.camposCreados);
    if (g.camposBorrados?.length) setBorrados(g.camposBorrados);
    if (g.rectsEditados && Object.keys(g.rectsEditados).length) setRectsEditados(g.rectsEditados);
  }, [ficha, etapa0Guardado]);

  // Hidratar ediciones cuando entra el PDF (se re-atan por nombre y por clave
  // de fila; los índices no sobreviven a un cambio de instancias).
  useEffect(() => {
    if (!pdf || hidratado.current.pdf) return;
    hidratado.current.pdf = true;
    const g = etapa0Guardado;
    if (!g) return;
    // Regiones guardadas a mano: se re-atan por nombre de campo.
    const guardadasManual = (g.regiones ?? []).filter((r) => r.manual);
    if (guardadasManual.length) {
      const idxDe = new Map(leaves.map((l, i) => [l.name, i]));
      setRegiones(
        guardadasManual
          .map((r) => ({
            codigo: r.codigo,
            desdeLeaf: idxDe.get(r.desdeNombre) ?? -1,
            hastaLeaf: idxDe.get(r.hastaNombre) ?? -1,
            origen: 'manual' as const,
            detalle: 'borde ajustado a mano (restaurado del proyecto)',
          }))
          .filter((r) => r.desdeLeaf >= 0 && r.hastaLeaf >= 0),
      );
    }
    if (!Object.keys(g.ediciones).length) return;
    const porClave = new Map(filasPdf.map((n, i) => [claveFila(n.fila.hoja, n.fila.fila, n.fila.instancia?.codigo), i]));
    setEdiciones((prev) => {
      const next: Ediciones = { ...prev };
      leaves.forEach((l, i) => {
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
    (leaves).forEach((l, i) => {
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
      hojasBloque,
      instancias,
      regiones: regiones.map((r) => ({
        codigo: r.codigo,
        desdeNombre: pdf?.leaves[r.desdeLeaf]?.name ?? '',
        hastaNombre: pdf?.leaves[r.hastaLeaf]?.name ?? '',
        manual: r.origen === 'manual',
      })),
      ediciones: eds,
      limitarFuente,
      tamanoFuente,
      pdfDescargado: descargas.pdf,
      fichaDescargada: descargas.ficha,
      reporteDescargado: descargas.reporte,
      detalleAbierto,
      vistaSimple,
      confirmados: [...confirmados],
      camposCreados: creados,
      camposBorrados: borrados,
      rectsEditados,
    });
  }, [
    ficha, pdf, fichaFile, pdfFile, hojaInstanciable, hojasBloque, instancias, regiones, ediciones, filasPdf,
    limitarFuente, tamanoFuente, descargas, detalleAbierto, vistaSimple, confirmados, creados, borrados,
    rectsEditados, setEtapa0,
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


  const nDescargas = (descargas.pdf ? 1 : 0) + (descargas.ficha ? 1 : 0) + (descargas.reporte ? 1 : 0);
  const botonesDescarga = (
    <div className="flex flex-wrap items-center gap-1.5">
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
        <FileSpreadsheet size={14} /> {trabajando === 'ficha' ? 'Escribiendo…' : 'Ficha col N'}
      </Button>
      <Button onClick={doDescargarReporte} disabled={trabajando !== null} data-dl="reporte">
        <FileText size={14} /> Reporte CSV
      </Button>
    </div>
  );

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
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{BADGE}</span>
        <div className="flex-1" />
        {/* Vista simple vs. avanzada: lo mismo calculado, distinto cuánto se muestra. */}
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-[11px]" data-vista={vistaSimple ? 'simple' : 'avanzada'}>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => setVistaSimple(v)}
              data-vista-btn={v ? 'simple' : 'avanzada'}
              className={`px-2 py-1 ${
                vistaSimple === v ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title={
                v
                  ? 'Solo lo que hay que decidir'
                  : 'Agrega el diagnóstico del motor: stats, instancias, regiones, tabla de ficha y edición en lote'
              }
            >
              {v ? 'Simple' : 'Avanzada'}
            </button>
          ))}
        </div>
        <input ref={fichaInput} type="file" accept=".xlsx,.xls" hidden onChange={onFicha} />
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={onPdf} />
        <Button onClick={() => fichaInput.current?.click()}>
          <Upload size={15} /> Ficha cruda{ficha ? ' ✓' : ''}
        </Button>
        <Button onClick={() => pdfInput.current?.click()}>
          <FileText size={15} /> PDF crudo{pdf ? ' ✓' : ''}
        </Button>
      </header>

      <div className="flex-1 min-h-0 flex gap-2 p-3">
        {/* Columna izquierda */}
        <div className="w-1/2 min-w-0 flex flex-col gap-2 overflow-auto scroll-thin">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          {/* Antes de tener los dos archivos: la advertencia de orden es lo único
              accionable, así que ocupa la pantalla. */}
          {!(ficha && pdf) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <b>Importante:</b> el renombrado va <b>siempre antes</b> de cargar el PDF en Signframe. Si lo cargás
              primero, el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
              <div className="mt-1.5 text-amber-900">
                Cargá la <b>ficha cruda (.xlsx)</b> y el <b>PDF crudo</b> con los botones de arriba.
              </div>
            </div>
          )}

          {/* El campo en el que se hizo click, sea en el PDF o en la tabla. */}
          {ficha && pdf && !modoRevision && idxSeleccionado >= 0 && (
            <PanelCampo
              leaf={leaves[idxSeleccionado]}
              idx={idxSeleccionado}
              filasPdf={filasPdf}
              ediciones={ediciones}
              setEdiciones={setEdiciones}
              confianza={confianzaPorLeaf.get(leaves[idxSeleccionado].name)}
              motivos={motivosPorLeaf.get(idxSeleccionado) ?? []}
              colisiones={colisionesPdf}
              confirmado={confirmados.has(leaves[idxSeleccionado].name)}
              etiquetaImpresa={etiquetaImpresa}
              onConfirmar={confirmar}
              onBorrar={borrarCampo}
              onReemplazarPorN={reemplazarPorN}
              onCerrar={() => setSelected(null)}
            />
          )}

          {ficha && pdf && modoRevision && (
            <ModoRevision
              leaves={leaves}
              filasPdf={filasPdf}
              pendientes={pendientes}
              idx={Math.min(revIdx, Math.max(0, pendientes.length - 1))}
              setIdx={setRevIdx}
              ediciones={ediciones}
              setEdiciones={setEdiciones}
              confianzaPorLeaf={confianzaPorLeaf}
              motivosPorLeaf={motivosPorLeaf}
              colisiones={colisionesPdf}
              confirmados={confirmados}
              onConfirmar={confirmar}
              onSalir={() => setModoRevision(false)}
            />
          )}

          {/* Panel de creación: aparece al soltar el rectángulo dibujado */}
          {dibujo && (
            <PanelCrearCampo
              page={dibujo.page}
              rect={dibujo.rect}
              filas={filasParaDibujo}
              onCrear={(d) => crearCampos(d, dibujo.rect, dibujo.page)}
              onCancelar={() => setDibujo(null)}
            />
          )}

          {borrados.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              <span data-borrados>
                <b>{borrados.length} campo(s) borrado(s)</b> — no van a estar en el PDF de salida:{' '}
                {borrados.slice(0, 4).join(' · ')}
                {borrados.length > 4 ? ' …' : ''}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setBorrados([]);
                  setDescargas((x) => ({ ...x, pdf: false }));
                }}
                data-restaurar
                className="rounded border border-amber-400 bg-white px-2 py-0.5 text-amber-800 whitespace-nowrap"
              >
                Restaurar campos borrados
              </button>
            </div>
          )}

          {/* --- RESUMEN: el estado en tres líneas, no el razonamiento --- */}
          {ficha && pdf && !modoRevision && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-3" data-resumen>
              {colisionesPdf.size > 0 && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-red-400 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  <AlertTriangle size={15} className="mt-[1px] shrink-0" />
                  <span data-linea-colisiones>
                    <b>{colisionesPdf.size} colisión(es) de nombre</b> — bloquean la descarga del PDF hasta resolverlas:{' '}
                    {[...colisionesPdf].slice(0, 6).join(' · ')}
                    {colisionesPdf.size > 6 ? ' …' : ''}
                  </span>
                </div>
              )}

              {regionesProblema.length > 0 && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                  <AlertTriangle size={15} className="mt-[1px] shrink-0" />
                  <span data-linea-regiones>
                    <b>Hay regiones sin resolver</b> ({regionesProblema.join(' · ')}). Pasá a la vista{' '}
                    <b>Avanzada</b> y elegí el primer y último campo de cada instancia.
                  </span>
                </div>
              )}

              {/* Los tres pasos, en orden, con el número adelante. */}
              <Bloque n={1} titulo="Archivos" ok>
                <span className="text-slate-600">
                  ficha <b className="text-emerald-700">✓</b> · PDF <b className="text-emerald-700">✓</b> ·{' '}
                  <span data-linea-resueltos>
                    <b className="text-slate-800">{resueltos}</b> de {leaves.length} campos listos
                  </span>
                </span>
              </Bloque>

              <Bloque
                n={2}
                titulo="Revisión"
                ok={pendientes.length === 0 && colisionesPdf.size === 0}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-600" data-linea-pendientes>
                    <b className="text-slate-800">{pendientes.length}</b> necesitan tu revisión
                  </span>
                  {colisionesPdf.size > 0 && (
                    <span className="text-red-600">
                      · <b>{colisionesPdf.size}</b> con el nombre repetido
                    </span>
                  )}
                  {pendientes.length > 0 && (
                    <button
                      onClick={() => {
                        setRevIdx(0);
                        setModoRevision(true);
                      }}
                      data-revisar
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-700"
                    >
                      Revisar los {pendientes.length} de a uno <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </Bloque>

              <Bloque n={3} titulo="Descargar" ok={nDescargas === 3}>
                {botonesDescarga}
              </Bloque>

              {!vistaSimple && (
                <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <input type="checkbox" checked={limitarFuente} onChange={(e) => setLimitarFuente(e.target.checked)} />
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
              )}
              {avisoEscritura && <p className="mt-1.5 text-[11px] text-emerald-700">{avisoEscritura}</p>}
            </div>
          )}

          {/* --- HAND-OFF: aparece recién al descargar el PDF --- */}
          {ficha && pdf && !modoRevision && descargas.pdf && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs" data-handoff>
              <p className="flex items-center gap-1.5 font-medium text-emerald-800">
                <CheckCircle2 size={15} /> PDF renombrado descargado
              </p>
              <p className="mt-2 text-slate-600">Ahora:</p>
              <ol className="mt-0.5 space-y-1 text-slate-700">
                <Paso ok n={1}>
                  Descargar el <b>PDF renombrado</b>
                </Paso>
                <Paso ok={false} n={2}>
                  Subí <b>ESTE</b> PDF a Signframe (no el original)
                </Paso>
                <Paso ok={false} n={3}>
                  Descargá el <b>JSON main</b> que genera
                </Paso>
                <Paso ok={descargas.ficha && descargas.reporte} n={4}>
                  Volvé acá con la <b>ficha col N</b> y el <b>reporte</b> descargados
                </Paso>
              </ol>
              <Button
                onClick={() => setView('builder')}
                title="Etapa 1 y 2 trabajan sobre el PDF renombrado"
                data-continuar
              >
                Continuar a Etapa 1 <ArrowRight size={14} />
              </Button>
            </div>
          )}

          {/* --- VISTA SIMPLE: la tabla de campos y nada más --- */}
          {pdf && !modoRevision && vistaSimple && (
            <div className="flex flex-col rounded-md border border-slate-200 bg-white h-[440px]" data-tabla-simple>
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200">
                <span className="text-xs font-medium text-slate-700 shrink-0">Campos del PDF</span>
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar un campo…"
                    className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1 text-xs outline-none focus:border-brand-500"
                  />
                </div>
              </div>
              <TablaCampos
                leaves={leaves}
                filasPdf={filasPdf}
                ediciones={ediciones}
                setEdiciones={setEdiciones}
                confianzaPorLeaf={confianzaPorLeaf}
                colisiones={colisionesPdf}
                selected={selected}
                onSelect={seleccionar}
                query={q}
                onBorrar={borrarCampo}
                onReemplazarPorN={reemplazarPorN}
                simple
              />
            </div>
          )}

          {/* --- VER DETALLE: todo el diagnóstico, colapsado --- */}
          {(ficha || pdf) && !modoRevision && !vistaSimple && (
            <details
              open={detalleAbierto}
              onToggle={(e) => setDetalleAbierto((e.currentTarget as HTMLDetailsElement).open)}
              className="rounded-md border border-slate-200 bg-white"
              data-detalle
            >
              <summary className="cursor-pointer px-3 py-2 text-xs text-slate-600 select-none" data-ver-detalle>
                Ver detalle
              </summary>

              <div className="px-3 pb-3 space-y-2">
                {/* stats */}
                <div className="grid grid-cols-4 gap-2">
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
                        l="colisiones ficha"
                        tone={Object.keys(colisiones).length ? 'text-red-600' : 'text-slate-700'}
                      />
                    </>
                  )}
                  {regiones.length > 0 && <Stat n={regiones.length} l="regiones" tone="text-brand-700" />}
                  {totalAnclas > 0 && <Stat n={totalAnclas} l="anclas por texto" tone="text-brand-700" />}
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
                      <Stat n={leaves.length} l="campos PDF" tone="text-brand-700" />
                      {cambios && cambios.creados > 0 && (
                        <Stat n={cambios.creados} l="creados" tone="text-brand-700" />
                      )}
                      {cambios && cambios.borrados > 0 && (
                        <Stat n={cambios.borrados} l="borrados" tone="text-amber-600" />
                      )}
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

                {pdf && pdf.sospechosos.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <b>{pdf.sospechosos.length} campo(s) /Tx con varios widgets</b> — un /Btn multi-widget es normal
                    (grupo de radios), pero un /Tx no: suele ser una colisión del PDF original.{' '}
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

                {/* Filas sin campo, partidas: las del bloque que no aplican a su
                    instancia no son un problema, son el subset por geometría. */}
                {align && (
                  <div className="rounded-md border border-slate-200 px-3 py-2 text-[11px] text-slate-600" data-huerfanos>
                    <div>
                      <b>{huerfanosFichaPartidos.sinCampo.length}</b> fila(s) de ficha sin campo en el PDF
                      {huerfanosFichaPartidos.sinCampo.length > 0 && (
                        <span className="text-slate-400">
                          {' '}
                          ({huerfanosFichaPartidos.sinCampo
                            .slice(0, 6)
                            .map((i) => `${filasPdf[i].fila.hoja}-${filasPdf[i].fila.fila}`)
                            .join(', ')}
                          {huerfanosFichaPartidos.sinCampo.length > 6 ? '…' : ''})
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500">
                      <b>{huerfanosFichaPartidos.noAplican.length}</b> fila(s) del bloque repetible que no aplican a su
                      instancia — es el subset por geometría, no un error.
                    </div>
                    <div>
                      <b>{align.huerfanosPdf.length}</b> campo(s) del PDF sin fila
                      {align.huerfanosPdf.length > 0 && (
                        <span className="text-slate-400">
                          {' '}
                          ({align.huerfanosPdf.slice(0, 6).map((i) => pdf!.leaves[i].name).join(', ')}
                          {align.huerfanosPdf.length > 6 ? '…' : ''})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {Object.keys(colisiones).length > 0 && (
                  <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    <b>Colisiones entre nombres propuestos</b> (se marcan, no se desambiguan solas):{' '}
                    {Object.entries(colisiones).map(([n, c]) => `${n} ×${c}`).join(' · ')}
                  </div>
                )}

                {ficha && ficha.filasIgnoradas.length > 0 && (
                  <div className="rounded-md border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600">
                    <b>{ficha.filasIgnoradas.length} fila(s) con contenido no contadas:</b>{' '}
                    {ficha.filasIgnoradas.map((f) => `${f.hoja} R${f.fila}`).join(', ')}
                  </div>
                )}

                {avisosColM.length > 0 && (
                  <details className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px]" data-avisos-colm>
                    <summary className="cursor-pointer text-amber-700">
                      {avisosColM.length} aviso(s) de tipeo en la col M — son una consulta al cliente, ya salen en el
                      reporte CSV
                    </summary>
                    <ul className="mt-1 list-disc pl-4 text-slate-600">
                      {avisosColM.map((a, i) => (
                        <li key={i}>
                          {a.hoja}·{a.fila} — {etiquetaAviso(a.tipo)}: {a.detalle}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Instancias y regiones */}
                {hojaInstanciable && instancias.length > 0 && (
                  <div className="rounded-md border border-slate-200 px-3 py-2">
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
                              setInstancias((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, activa: e.target.checked } : x)),
                              )
                            }
                          />
                          <span className="font-medium text-slate-700 w-10">{inst.codigo}</span>
                          <label className="text-slate-400">prefijo</label>
                          <input
                            value={inst.prefijo}
                            onChange={(e) =>
                              setInstancias((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, prefijo: e.target.value } : x)),
                              )
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

                    {pdf && (
                      <div className="mt-2 pt-2 border-t border-slate-100" data-regiones>
                        <div className="text-[11px] font-medium text-slate-600 mb-1">
                          Región de cada instancia en el PDF — la alineación corre <b>dentro</b> de la región y nunca
                          cruza el límite. La siembra automática es orientativa: si algo quedó corrido, mové el primer o
                          el último campo.
                        </div>
                        {regiones.length === 0 && (
                          <p className="text-[11px] text-amber-700">
                            No se pudo sembrar ninguna región: la alineación cae al pase global. Elegí el primer y
                            último campo de cada instancia.
                          </p>
                        )}
                        {regiones.map((r, i) => (
                          <div key={r.codigo} className="flex flex-wrap items-center gap-1.5 text-[11px] mb-1">
                            <span
                              className="w-10 font-medium rounded px-1"
                              style={{ background: colorRegion(i, 0.18), color: colorRegion(i, 1) }}
                            >
                              {r.codigo}
                            </span>
                            <span className="text-slate-400">desde</span>
                            <select
                              value={r.desdeLeaf}
                              data-region-desde={r.codigo}
                              onChange={(e) => moverRegion(i, 'desdeLeaf', Number(e.target.value))}
                              className="rounded border border-slate-300 px-1 py-0.5 max-w-[200px]"
                            >
                              {leaves.map((l, j) => (
                                <option key={j} value={j}>
                                  #{l.readingIndex} p{l.page + 1} · {l.name}
                                </option>
                              ))}
                            </select>
                            <span className="text-slate-400">hasta</span>
                            <select
                              value={r.hastaLeaf}
                              data-region-hasta={r.codigo}
                              onChange={(e) => moverRegion(i, 'hastaLeaf', Number(e.target.value))}
                              className="rounded border border-slate-300 px-1 py-0.5 max-w-[200px]"
                            >
                              {leaves.map((l, j) => (
                                <option key={j} value={j}>
                                  #{l.readingIndex} p{l.page + 1} · {l.name}
                                </option>
                              ))}
                            </select>
                            <span className="text-slate-500">
                              {Math.max(0, r.hastaLeaf - r.desdeLeaf + 1)} campos ·{' '}
                              {segmentos.find((x) => x.etiqueta === r.codigo)?.filaIdxs.length ?? 0} filas
                            </span>
                            <span className="text-slate-400" title={r.detalle}>
                              {r.origen === 'manual' ? '(a mano)' : `(${r.origen})`}
                            </span>
                          </div>
                        ))}
                        {avisosRegion.length > 0 && (
                          <details className="text-[11px] text-slate-500 mt-1">
                            <summary className="cursor-pointer" data-avisos-regiones>
                              {avisosRegion.length} aviso(s) de la siembra de regiones
                            </summary>
                            <ul className="list-disc pl-4 mt-0.5">
                              {avisosRegion.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Tablas completas */}
                <div className="flex flex-col rounded-md border border-slate-200 h-[440px]">
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
                        Campos PDF {pdf ? `(${leaves.length})` : ''}
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
                              filtro === f
                                ? 'bg-slate-700 text-white border-slate-700'
                                : 'bg-white border-slate-300 text-slate-600'
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
                                      <span className="ml-1 text-brand-600">
                                        {r.instancia.codigo}[{r.indiceInstancia}]
                                      </span>
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
                                        title={[
                                          ...asig.motivos,
                                          `campo(s): ${asig.leafIdx.map((li) => pdf!.leaves[li].name).join(', ')}`,
                                        ].join(' · ')}
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
                                      <span
                                        className="ml-1 rounded px-1 bg-red-50 text-red-500"
                                        title="La hoja no aplica a este formulario"
                                      >
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
                        leaves={leaves}
                        filasPdf={filasPdf}
                        ediciones={ediciones}
                        setEdiciones={setEdiciones}
                        confianzaPorLeaf={confianzaPorLeaf}
                        colisiones={colisionesPdf}
                        selected={selected}
                        onSelect={seleccionar}
                        query={q}
                        onBorrar={borrarCampo}
                        onReemplazarPorN={reemplazarPorN}
                      />
                    ))}
                </div>
              </div>
            </details>
          )}

          {nDescargas > 0 && !modoRevision && (
            <p className="text-[10px] text-slate-400 px-1">
              descargado: {descargas.pdf ? 'PDF · ' : ''}
              {descargas.ficha ? 'ficha · ' : ''}
              {descargas.reporte ? 'reporte' : ''}
            </p>
          )}
        </div>

        {/* Derecha: PDF con overlay */}
        <div className="w-1/2 min-w-0 rounded-md border border-slate-200 bg-white">
          <PdfPreview
            file={pdfFile}
            leaves={leaves}
            regiones={regiones}
            regionPorLeaf={regionPorLeaf}
            selected={selected}
            onSelect={seleccionar}
            confianza={confianzaPorLeaf}
            nombreFinal={nombreFinalPorLeaf}
            colisiones={colisionesPdf}
            escalaMinima={modoRevision ? 1.75 : undefined}
            onDibujar={(page, rect) => setDibujo({ page, rect })}
            onEditarRect={editarRect}
            esCreado={(nombre) => leaves.some((l) => l.name === nombre && l.origen === 'creado')}
          />
        </div>
      </div>
    </div>
  );
}
