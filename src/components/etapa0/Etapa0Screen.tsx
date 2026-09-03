// ---------------------------------------------------------------------------
// Etapa 0 — Detector y editor de campos del PDF (v2.0.0).
//
// EL CAMBIO DE FOCO. Hasta v1.4.5 esta pantalla intentaba resolver el mapeo
// ficha↔PDF sola (regiones, DP, anclas, confianza). El techo no era de
// calibración: la ficha y el PDF no comparten ninguna clave —la col N, que era
// LA clave, viene vacía— y hay decisiones que solo salen de entender el
// formulario. Así que la app se queda con lo que una máquina hace mejor que una
// persona (leer el AcroForm, medir geometría, extraer el texto impreso, escribir
// el PDF) y el mapeo se resuelve AFUERA, sobre el paquete que exporta.
//
// El circuito:
//   1. acá: detectar · editar · exportar el paquete + el PDF
//   2. afuera: resolver el mapeo leyendo formulario + ficha + paquete
//   3. acá: importar los nombres y escribir el PDF renombrado
//   4. Signframe: subir el renombrado, bajar el JSON main
//   5. Etapa 1 / 2: esqueleto y bind 1:1
//
// EL PDF ES EL ÚNICO INPUT OBLIGATORIO. La ficha pasó a ser opcional y entra
// solo para importar nombres.
//
// El código de la alineación automática (`align.ts`, las regiones y anclas de
// `regiones.ts`, `acroName.ts`, `reporte.ts`, `ModoRevision` y la pantalla vieja
// en `Etapa0ScreenV1.tsx.bak`) queda en el repo con sus tests, pero YA NO SE
// CABLEA desde acá.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
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
import { readFichaSheets } from '../../lib/etapa0/fichaRaw';
import { readPdfFields, type PdfFieldsResult, type PdfLeaf, type Rect } from '../../lib/etapa0/pdfFields';
import { extraerTextoPdf, sufijosDeFormato, type TextItem } from '../../lib/etapa0/regiones';
import { escribirPdfRenombrado } from '../../lib/etapa0/writePdf';
import { escribirPdfConNombresImpresos } from '../../lib/etapa0/writePdfImpreso';
import {
  candidatasDeWidget,
  construirPaquete,
  paqueteAXlsx,
  textoDeZona,
  type FilaPaquete,
} from '../../lib/etapa0/paquete';
import { importarColNDeFicha, importarDesdePaquete, type ResultadoImport } from '../../lib/etapa0/importarNombres';
import { slugify } from '../../lib/exporter';
import {
  aplicarCambios,
  claveEstable,
  remapearPorClave,
  trocearRect,
  type CampoCreado,
} from '../../lib/etapa0/camposManuales';
import { aplicarRects, claveRect, paraEscritura, type RectsEditados } from '../../lib/etapa0/rects';
import TablaCampos, { nombreEfectivo, FILTROS, type Ediciones, type FiltroCampos } from './TablaCampos';
import PanelCampo from './PanelCampo';
import PanelCrearCampo, { type DatosCampoNuevo } from './PanelCrearCampo';
import PdfPreview from './PdfPreview';

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

export default function Etapa0Screen() {
  const setView = useStore((s) => s.setView);
  const pdfInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const [pdf, setPdf] = useState<PdfFieldsResult | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [textoPdf, setTextoPdf] = useState<TextItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const [ediciones, setEdiciones] = useState<Ediciones>({});
  const [creados, setCreados] = useState<CampoCreado[]>([]);
  const [borrados, setBorrados] = useState<string[]>([]);
  const [rectsEditados, setRectsEditados] = useState<RectsEditados>({});
  const [notasImportadas, setNotasImportadas] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FiltroCampos>('todos');
  const [dibujo, setDibujo] = useState<{ page: number; rect: Rect } | null>(null);
  const [limitarFuente, setLimitarFuente] = useState(true);
  const [tamanoFuente, setTamanoFuente] = useState(10);
  const [descargas, setDescargas] = useState({ pdf: false, impreso: false, paquete: false });
  /** resultado de una importación esperando confirmación */
  const [pendiente, setPendiente] = useState<{ r: ResultadoImport; archivo: string } | null>(null);

  const invalidarDescargas = () => setDescargas({ pdf: false, impreso: false, paquete: false });

  // --- carga del PDF (único input obligatorio) -----------------------------

  const onPdf = async () => {
    const f = pdfInput.current?.files?.[0];
    if (!f) return;
    setError(null);
    setPdfFile(f);
    invalidarDescargas();
    try {
      const buf = await f.arrayBuffer();
      setPdf(await readPdfFields(buf));
      try {
        setTextoPdf(await extraerTextoPdf(buf));
      } catch (e) {
        setTextoPdf([]);
        setAviso('No se pudo leer el texto del PDF: el paquete va a salir sin las columnas de texto. ' + String(e));
      }
    } catch (e) {
      setError('PDF: ' + String(e));
    }
    if (pdfInput.current) pdfInput.current.value = '';
  };

  /**
   * Lista EFECTIVA de campos: detectados con su geometría editada, menos los
   * borrados, más los creados, reordenada por orden de lectura. Es la que ve la
   * UI, la que va al paquete y la que se escribe.
   */
  const cambios = useMemo(
    () => (pdf ? aplicarCambios(aplicarRects(pdf.leaves, rectsEditados), creados, borrados) : null),
    [pdf, creados, borrados, rectsEditados],
  );
  const leaves = cambios?.efectivos ?? [];

  /**
   * `ediciones` está indexada por posición, y crear, borrar o mover un campo
   * corre todos los índices: sin remapear, el nombre nuevo se mudaría de campo
   * en silencio. El remapeo va por identidad estable (uid para los creados,
   * AcroName original para los detectados).
   */
  const leavesPrevios = useRef<PdfLeaf[]>([]);
  useEffect(() => {
    const antes = leavesPrevios.current;
    leavesPrevios.current = leaves;
    if (antes.length === 0 || antes === leaves) return;
    const mismos =
      antes.length === leaves.length && antes.every((l, i) => claveEstable(l) === claveEstable(leaves[i]));
    if (mismos) return;
    setEdiciones((prev) => remapearPorClave(prev, antes, leaves));
  }, [leaves]);

  // --- nombres y colisiones ------------------------------------------------

  const nombreFinalPorLeaf = useMemo(() => {
    const m = new Map<string, string>();
    leaves.forEach((l, i) => m.set(l.name, nombreEfectivo(l, ediciones[i])));
    return m;
  }, [leaves, ediciones]);

  const colisiones = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const final of nombreFinalPorLeaf.values()) cuenta.set(final, (cuenta.get(final) ?? 0) + 1);
    return new Set([...cuenta.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [nombreFinalPorLeaf]);

  const conNombre = useMemo(
    () => new Set(leaves.filter((_, i) => (ediciones[i]?.nombreNuevo ?? '').trim() !== '').map((l) => l.name)),
    [leaves, ediciones],
  );

  // --- crear, borrar, trocear, mover --------------------------------------

  const crearCampos = (d: DatosCampoNuevo, rect: Rect, page: number) => {
    const cajas = trocearRect(rect, d.dividir);
    const grupo = d.dividir > 1 ? nanoid(6) : undefined;
    const nuevos: CampoCreado[] = cajas.map((r, i) => ({
      uid: nanoid(8),
      nombre: d.dividir > 1 ? `${d.nombre}_${i + 1}` : d.nombre,
      tipo: d.tipo,
      page,
      rect: r,
      filaClave: null,
      grupo,
      parte: d.dividir > 1 ? i + 1 : undefined,
    }));
    setCreados((prev) => [...prev, ...nuevos]);
    setDibujo(null);
    invalidarDescargas();
  };

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
    if (selected === l.name) setSelected(null);
    invalidarDescargas();
  };

  /**
   * Reemplaza un campo por N cajas dentro de su mismo rect. Es el caso de la
   * fecha del CSC: el asegurado tiene una caja de 88pt donde el representante
   * tiene tres, y así quedan iguales.
   */
  const reemplazarPorN = (i: number, n: number) => {
    const l = leaves[i];
    if (!l || n < 2) return;
    const base = nombreEfectivo(l, ediciones[i]);
    const sufijos = sufijosDeFormato('', n);
    const grupo = nanoid(6);
    const nuevos: CampoCreado[] = trocearRect(l.rect, n).map((r, k) => ({
      uid: nanoid(8),
      nombre: `${base}_${sufijos?.[k] ?? k + 1}`,
      tipo: ediciones[i]?.tipo ?? l.ft,
      page: l.page,
      rect: r,
      filaClave: null,
      grupo,
      parte: k + 1,
    }));
    if (l.origen === 'creado' && l.uid) setCreados((prev) => [...prev.filter((c) => c.uid !== l.uid), ...nuevos]);
    else {
      setBorrados((prev) => (prev.includes(l.name) ? prev : [...prev, l.name]));
      setCreados((prev) => [...prev, ...nuevos]);
    }
    setSelected(null);
    invalidarDescargas();
  };

  /**
   * Mueve o redimensiona la caja de un campo. Un campo creado lleva su rect en
   * su propia definición (su identidad es el `uid`); uno detectado va a
   * `rectsEditados`, con la clave calculada sobre la lista ORIGINAL.
   */
  const editarRect = (leaf: PdfLeaf, widgetIdx: number, rect: Rect) => {
    if (leaf.origen === 'creado' && leaf.uid) {
      setCreados((prev) => prev.map((c) => (c.uid === leaf.uid ? { ...c, rect } : c)));
    } else {
      const original = pdf?.leaves.find((l) => l.name === leaf.name);
      if (!original) return;
      setRectsEditados((prev) => ({ ...prev, [claveRect(original, widgetIdx)]: rect }));
    }
    invalidarDescargas();
  };

  // --- selección ----------------------------------------------------------

  const seleccionar = (name: string) => {
    setSelected(name);
    // Un buscador o un filtro puede tener esa fila afuera: si no, el click en el
    // PDF no lleva a ninguna parte.
    if (q && !name.toLowerCase().includes(q.toLowerCase())) {
      const i = leaves.findIndex((l) => l.name === name);
      if (!(ediciones[i]?.nombreNuevo ?? '').toLowerCase().includes(q.toLowerCase())) setQ('');
    }
    if (filtro !== 'todos') setFiltro('todos');
  };

  const idxSeleccionado = useMemo(
    () => (selected ? leaves.findIndex((l) => l.name === selected) : -1),
    [selected, leaves],
  );

  /** Etiqueta impresa y texto de zona del campo seleccionado. */
  const contexto = useMemo<{ etiqueta?: string; zona?: string }>(() => {
    if (idxSeleccionado < 0 || textoPdf.length === 0) return {};
    const l = leaves[idxSeleccionado];
    return {
      etiqueta: candidatasDeWidget(l.page, l.rect, textoPdf)[0],
      zona: textoDeZona(l.page, l.rect, textoPdf),
    };
  }, [idxSeleccionado, leaves, textoPdf]);

  // --- el paquete ---------------------------------------------------------

  const paquete = useMemo<FilaPaquete[]>(() => {
    if (!pdf) return [];
    return construirPaquete({
      leaves,
      nombreFinal: (i) => nombreEfectivo(leaves[i], ediciones[i]),
      texto: textoPdf,
      borrados: pdf.leaves.filter((l) => borrados.includes(l.name)),
      notaDeLeaf: (i) => notasImportadas[leaves[i].name],
    });
  }, [pdf, leaves, ediciones, textoPdf, borrados, notasImportadas]);

  const baseNombre = useMemo(() => slugify((pdfFile?.name ?? 'formulario').replace(/\.pdf$/i, '')), [pdfFile]);

  // --- las tres descargas -------------------------------------------------

  /** Todo lo que la escritura necesita, en un solo lugar. */
  const opcionesEscritura = () => {
    const renombres = new Map<string, string>();
    const creadosFinales: CampoCreado[] = [];
    leaves.forEach((l, i) => {
      const final = nombreEfectivo(l, ediciones[i]);
      if (l.origen === 'creado' && l.uid) {
        const c = creados.find((x) => x.uid === l.uid);
        if (c) creadosFinales.push({ ...c, nombre: final, tipo: ediciones[i]?.tipo ?? c.tipo });
        return;
      }
      if (final !== l.name) renombres.set(l.name, final);
    });
    return {
      renombres,
      opts: {
        limitarFuente,
        tamanoFuente,
        creados: creadosFinales,
        borrados,
        rects: pdf ? paraEscritura(pdf.leaves, rectsEditados) : undefined,
      },
    };
  };

  const doDescargarPdf = async () => {
    if (!pdfFile || !pdf) return;
    if (colisiones.size > 0) {
      setError('Hay nombres repetidos: resolvelos antes de escribir el PDF.');
      return;
    }
    setTrabajando('pdf');
    setError(null);
    try {
      const { renombres, opts } = opcionesEscritura();
      const r = await escribirPdfRenombrado(await pdfFile.arrayBuffer(), renombres, opts);
      descargarBytes(r.bytes, `${baseNombre}-renombrado.pdf`, 'application/pdf');
      setDescargas((d) => ({ ...d, pdf: true }));
      setAviso(
        `PDF renombrado: ${r.renombrados} de ${r.campos} campos renombrados` +
          (r.creados ? `, ${r.creados} creados` : '') +
          (r.borrados ? `, ${r.borrados} borrados` : '') +
          (r.movidos ? `, ${r.movidos} cajas movidas` : '') +
          '.' +
          (r.warnings.length ? ' · ' + r.warnings.join(' · ') : ''),
      );
    } catch (e) {
      setError('No se pudo escribir el PDF: ' + String(e));
    } finally {
      setTrabajando(null);
    }
  };

  const doDescargarImpreso = async () => {
    if (!pdfFile || !pdf) return;
    if (colisiones.size > 0) {
      setError('Hay nombres repetidos: resolvelos antes de escribir el PDF.');
      return;
    }
    setTrabajando('impreso');
    setError(null);
    try {
      const { renombres, opts } = opcionesEscritura();
      const base = await escribirPdfRenombrado(await pdfFile.arrayBuffer(), renombres, opts);
      // Se rotula sobre el PDF ya escrito: los nombres impresos son exactamente
      // los que van a estar en los campos.
      const leidos = (await readPdfFields(base.bytes)).leaves;
      const campos = leidos.flatMap((l) =>
        l.widgets.map((w) => ({ nombre: l.name, indice: l.readingIndex, page: w.page, rect: w.rect, tipo: l.ft })),
      );
      const r = await escribirPdfConNombresImpresos(base.bytes, campos);
      descargarBytes(r.bytes, `${baseNombre}-nombres-impresos.pdf`, 'application/pdf');
      setDescargas((d) => ({ ...d, impreso: true }));
      setAviso(
        `PDF con nombres impresos: ${r.dibujados} campos rotulados. Es una copia para revisar — a Signframe va el renombrado.` +
          (r.warnings.length ? ' · ' + r.warnings.join(' · ') : ''),
      );
    } catch (e) {
      setError('No se pudo escribir el PDF impreso: ' + String(e));
    } finally {
      setTrabajando(null);
    }
  };

  const doDescargarPaquete = async () => {
    if (!pdf) return;
    setTrabajando('paquete');
    setError(null);
    try {
      const bytes = await paqueteAXlsx(paquete);
      descargarBytes(
        bytes,
        `${baseNombre}-paquete-campos.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      setDescargas((d) => ({ ...d, paquete: true }));
      const conEtiqueta = paquete.filter((f) => f.etiqueta_impresa).length;
      setAviso(`Paquete: ${paquete.length} filas (una por widget), ${conEtiqueta} con etiqueta impresa.`);
    } catch (e) {
      setError('No se pudo escribir el paquete: ' + String(e));
    } finally {
      setTrabajando(null);
    }
  };

  // --- importar los nombres ------------------------------------------------

  const onImportar = async () => {
    const f = importInput.current?.files?.[0];
    if (!f || !pdf) return;
    setError(null);
    try {
      const sheets = await readFichaSheets(await f.arrayBuffer());
      const esManual = (nombreActual: string) => {
        const i = leaves.findIndex((l) => l.name === nombreActual);
        const ed = i >= 0 ? ediciones[i] : undefined;
        return ed?.manual && ed.nombreNuevo ? ed.nombreNuevo : undefined;
      };
      // El paquete es una hoja con `nombre_actual`/`nombre_nuevo`; la ficha son
      // las hojas del INS con la col N. Se distingue por el contenido, no por el
      // nombre del archivo.
      const hojaPaquete = sheets.find((s) =>
        s.aoa.some((fila) => {
          const c = fila.map((x) => String(x ?? '').trim().toLowerCase());
          return c.includes('nombre_actual') && c.includes('nombre_nuevo');
        }),
      );
      const r = hojaPaquete
        ? importarDesdePaquete(hojaPaquete.aoa, leaves, esManual)
        : importarColNDeFicha(sheets, leaves, esManual);
      setPendiente({ r, archivo: f.name });
    } catch (e) {
      setError('No se pudo leer el archivo: ' + String(e));
    }
    if (importInput.current) importInput.current.value = '';
  };

  const aplicarImport = (pisarManual: boolean) => {
    if (!pendiente) return;
    const { r } = pendiente;
    const idxPorNombre = new Map(leaves.map((l, i) => [l.name, i]));
    const pisa = new Set(r.pisaManual.map((x) => x.nombreActual));
    setEdiciones((prev) => {
      const next = { ...prev };
      for (const x of r.aplicar) {
        if (!pisarManual && pisa.has(x.nombreActual)) continue;
        const i = idxPorNombre.get(x.nombreActual);
        if (i == null) continue;
        const b = next[i] ?? { nombreNuevo: '', filaIdx: null, tipo: leaves[i].ft, manual: false };
        next[i] = { ...b, nombreNuevo: x.nombreNuevo, manual: true };
      }
      return next;
    });
    // De dónde salió cada nombre viaja al paquete, columna `notas`.
    setNotasImportadas((prev) => {
      const next = { ...prev };
      for (const x of r.aplicar) next[x.nombreActual] = `nombre importado de ${x.fuente}`;
      return next;
    });
    invalidarDescargas();
    const salteados = pisarManual ? 0 : r.pisaManual.length;
    setAviso(
      `Importados ${r.aplicar.length - salteados} nombres de «${pendiente.archivo}»` +
        (salteados ? `; ${salteados} no se aplicaron para no pisar lo editado a mano` : '') +
        '.',
    );
    setPendiente(null);
  };

  // --- persistencia dentro del proyecto -----------------------------------

  const etapa0Guardado = useStore((s) => s.project.etapa0);
  const setEtapa0 = useStore((s) => s.setEtapa0);
  const hidratado = useRef(false);

  useEffect(() => {
    if (!pdf || hidratado.current) return;
    hidratado.current = true;
    const g = etapa0Guardado;
    if (!g) return;
    setLimitarFuente(g.limitarFuente);
    setTamanoFuente(g.tamanoFuente);
    if (g.camposCreados?.length) setCreados(g.camposCreados);
    if (g.camposBorrados?.length) setBorrados(g.camposBorrados);
    if (g.rectsEditados && Object.keys(g.rectsEditados).length) setRectsEditados(g.rectsEditados);
    if (g.ediciones && Object.keys(g.ediciones).length) {
      setEdiciones((prev) => {
        const next: Ediciones = { ...prev };
        leaves.forEach((l, i) => {
          const e = g.ediciones[l.name];
          if (!e) return;
          next[i] = { nombreNuevo: e.nombreNuevo, filaIdx: null, tipo: e.tipo, manual: e.manual };
        });
        return next;
      });
    }
  }, [pdf, etapa0Guardado]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pdf) return;
    const eds: Record<string, import('../../types').Etapa0Edicion> = {};
    leaves.forEach((l, i) => {
      const e = ediciones[i];
      if (!e) return;
      eds[l.name] = { nombreNuevo: e.nombreNuevo, filaClave: null, tipo: e.tipo, manual: e.manual };
    });
    setEtapa0({
      pdfNombre: pdfFile?.name,
      hojaInstanciable: null,
      instancias: [],
      ediciones: eds,
      limitarFuente,
      tamanoFuente,
      pdfDescargado: descargas.pdf,
      fichaDescargada: false,
      reporteDescargado: descargas.paquete,
      camposCreados: creados,
      camposBorrados: borrados,
      rectsEditados,
    });
  }, [
    pdf, pdfFile, leaves, ediciones, limitarFuente, tamanoFuente, descargas, creados, borrados, rectsEditados,
    setEtapa0,
  ]);

  // --- UI ------------------------------------------------------------------

  const totalWidgets = leaves.reduce((n, l) => n + l.widgets.length, 0);

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0 flex-wrap">
        <Button onClick={() => setView('home')}>
          <ArrowLeft size={15} /> Inicio
        </Button>
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <FileSignature size={16} /> Etapa 0 · Campos del PDF
        </span>
        <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{BADGE}</span>

        {pdf && (
          <span className="text-[11px] text-slate-600 ml-2" data-contadores>
            <b>{leaves.length}</b> campos ({totalWidgets} widgets) · <b className="text-blue-700">{conNombre.size}</b>{' '}
            con nombre · <b className={colisiones.size ? 'text-red-600' : 'text-slate-500'}>{colisiones.size}</b>{' '}
            colisiones
          </span>
        )}

        <div className="flex-1" />
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={onPdf} />
        <input ref={importInput} type="file" accept=".xlsx,.xls" hidden onChange={onImportar} />
        <Button onClick={() => pdfInput.current?.click()}>
          <FileText size={15} /> PDF crudo{pdf ? ' ✓' : ''}
        </Button>
        <Button
          onClick={() => importInput.current?.click()}
          disabled={!pdf}
          title="Ficha con la col N llena, o el paquete de campos con nombre_nuevo"
        >
          <Upload size={15} /> Cargar nombres
        </Button>
      </header>

      {pdf && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-b border-slate-200 shrink-0 flex-wrap">
          <Button
            onClick={doDescargarPdf}
            disabled={colisiones.size > 0 || trabajando !== null}
            title={
              colisiones.size > 0
                ? `Bloqueado por ${colisiones.size} nombre(s) repetido(s): ` + [...colisiones].slice(0, 5).join(' · ')
                : 'El PDF que se sube a Signframe'
            }
            data-dl="pdf"
          >
            <Download size={14} /> {trabajando === 'pdf' ? 'Escribiendo…' : 'PDF renombrado'}
          </Button>
          <Button
            onClick={doDescargarImpreso}
            disabled={colisiones.size > 0 || trabajando !== null}
            title="Copia visual con el nombre de cada campo dibujado encima. NO se sube a Signframe."
            data-dl="impreso"
          >
            <FileText size={14} /> {trabajando === 'impreso' ? 'Escribiendo…' : 'PDF con nombres impresos'}
          </Button>
          <Button onClick={doDescargarPaquete} disabled={trabajando !== null} data-dl="paquete">
            <FileSpreadsheet size={14} /> {trabajando === 'paquete' ? 'Escribiendo…' : 'Paquete de campos (xlsx)'}
          </Button>
          <span className="text-[10px] text-slate-400">
            el impreso es para revisar · a Signframe va el renombrado
          </span>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <input type="checkbox" checked={limitarFuente} onChange={(e) => setLimitarFuente(e.target.checked)} />
            fuente máx.
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
      )}

      <div className="flex-1 min-h-0 flex gap-2 p-3">
        {/* Izquierda: la tabla de campos */}
        <div className="w-1/2 min-w-0 flex flex-col gap-2 overflow-auto scroll-thin">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700" data-error>
              {error}
            </p>
          )}

          {!pdf && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <b>Importante:</b> el renombrado del PDF va <b>siempre antes</b> de cargar el PDF en Signframe. Si lo
              cargás primero, el <code>sourceMeta</code> queda clavado a los nombres genéricos del AcroForm.
              <div className="mt-1.5 text-amber-900">
                Cargá el <b>PDF crudo</b> con el botón de arriba. La ficha no hace falta para empezar: acá se detectan y
                se editan los campos, y el mapeo se resuelve después sobre el paquete.
              </div>
            </div>
          )}

          {aviso && (
            <p
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800"
              data-aviso
            >
              {aviso}
            </p>
          )}

          {/* Resultado de una importación, esperando confirmación */}
          {pendiente && (
            <div className="rounded-md border border-brand-300 bg-brand-50/40 px-3 py-2.5 text-xs" data-panel-import>
              <p className="font-medium text-slate-800">Nombres de «{pendiente.archivo}»</p>
              <ul className="mt-1.5 space-y-0.5 text-slate-600">
                <li>
                  <b data-import-aplicables>{pendiente.r.aplicar.length}</b> campos recibirían nombre
                </li>
                {pendiente.r.sinCampoEnPdf.length > 0 && (
                  <li className="text-amber-700">
                    <b>{pendiente.r.sinCampoEnPdf.length}</b> valores del archivo no corresponden a ningún campo del
                    PDF: {pendiente.r.sinCampoEnPdf.slice(0, 4).map((x) => x.valor).join(' · ')}
                    {pendiente.r.sinCampoEnPdf.length > 4 ? ' …' : ''}
                  </li>
                )}
                {pendiente.r.camposSinNombre.length > 0 && (
                  <li className="text-slate-500">
                    <b>{pendiente.r.camposSinNombre.length}</b> campos del PDF que el archivo no menciona
                  </li>
                )}
                {pendiente.r.pisaManual.length > 0 && (
                  <li className="text-amber-700">
                    <b>{pendiente.r.pisaManual.length}</b> pisarían un nombre que pusiste a mano
                  </li>
                )}
                {pendiente.r.colisiones.length > 0 && (
                  <li className="text-red-600">
                    <b>{pendiente.r.colisiones.length}</b> nombres quedarían repetidos:{' '}
                    {pendiente.r.colisiones.slice(0, 4).join(' · ')}
                    {pendiente.r.colisiones.length > 4 ? ' …' : ''} — no se aplica nada hasta resolverlo
                  </li>
                )}
                {pendiente.r.avisos.map((a, i) => (
                  <li key={i} className="text-slate-500">
                    {a}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => aplicarImport(false)}
                  disabled={pendiente.r.colisiones.length > 0 || pendiente.r.aplicar.length === 0}
                  data-import-aplicar
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-40"
                >
                  Aplicar
                </button>
                {pendiente.r.pisaManual.length > 0 && (
                  <button
                    onClick={() => aplicarImport(true)}
                    disabled={pendiente.r.colisiones.length > 0}
                    data-import-pisar
                    className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-amber-800 disabled:opacity-40"
                  >
                    Aplicar y pisar lo manual
                  </button>
                )}
                <button
                  onClick={() => setPendiente(null)}
                  data-import-cancelar
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600"
                >
                  Cancelar
                </button>
              </div>
            </div>
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
                  invalidarDescargas();
                }}
                data-restaurar
                className="rounded border border-amber-400 bg-white px-2 py-0.5 text-amber-800 whitespace-nowrap"
              >
                Restaurar campos borrados
              </button>
            </div>
          )}

          {colisiones.size > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={15} className="mt-[1px] shrink-0" />
              <span data-linea-colisiones>
                <b>{colisiones.size} nombre(s) repetido(s)</b> — bloquean la escritura del PDF:{' '}
                {[...colisiones].slice(0, 6).join(' · ')}
                {colisiones.size > 6 ? ' …' : ''}
              </span>
            </div>
          )}

          {/* Panel de creación: aparece al soltar el rectángulo dibujado */}
          {dibujo && (
            <PanelCrearCampo
              page={dibujo.page}
              rect={dibujo.rect}
              filas={[]}
              onCrear={(d) => crearCampos(d, dibujo.rect, dibujo.page)}
              onCancelar={() => setDibujo(null)}
            />
          )}

          {pdf && idxSeleccionado >= 0 && (
            <PanelCampo
              leaf={leaves[idxSeleccionado]}
              idx={idxSeleccionado}
              ediciones={ediciones}
              setEdiciones={setEdiciones}
              colisiones={colisiones}
              etiquetaImpresa={contexto.etiqueta}
              textoZona={contexto.zona}
              onEditarRect={editarRect}
              onBorrar={borrarCampo}
              onReemplazarPorN={reemplazarPorN}
              onCerrar={() => setSelected(null)}
            />
          )}

          {pdf && (
            <div className="flex flex-col rounded-md border border-slate-200 bg-white flex-1 min-h-[320px]" data-tabla>
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 flex-wrap">
                <div className="relative flex-1 min-w-[140px]">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar un campo…"
                    className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1 text-xs outline-none focus:border-brand-500"
                  />
                </div>
                <div className="flex gap-1">
                  {FILTROS.map((f) => (
                    <button
                      key={f.valor}
                      onClick={() => setFiltro(f.valor)}
                      data-filtro={f.valor}
                      className={`text-[11px] rounded px-2 py-0.5 border ${
                        filtro === f.valor
                          ? 'bg-slate-700 text-white border-slate-700'
                          : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <TablaCampos
                leaves={leaves}
                ediciones={ediciones}
                setEdiciones={setEdiciones}
                colisiones={colisiones}
                selected={selected}
                onSelect={seleccionar}
                query={q}
                filtro={filtro}
                onBorrar={borrarCampo}
                onReemplazarPorN={reemplazarPorN}
              />
            </div>
          )}

          {descargas.pdf && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs" data-handoff>
              <p className="flex items-center gap-1.5 font-medium text-emerald-800">
                <CheckCircle2 size={15} /> PDF renombrado descargado
              </p>
              <p className="mt-1 mb-2 text-slate-600">
                Subí <b>ESE</b> PDF a Signframe (no el original ni el de nombres impresos) y bajá el <b>JSON main</b>.
              </p>
              <Button onClick={() => setView('builder')} data-continuar>
                Continuar a Etapa 1 <ArrowRight size={14} />
              </Button>
            </div>
          )}
        </div>

        {/* Derecha: el PDF con el overlay */}
        <div className="w-1/2 min-w-0 rounded-md border border-slate-200 bg-white">
          <PdfPreview
            file={pdfFile}
            leaves={leaves}
            selected={selected}
            onSelect={seleccionar}
            renombrado={conNombre}
            nombreFinal={nombreFinalPorLeaf}
            colisiones={colisiones}
            onDibujar={(page, rect) => setDibujo({ page, rect })}
            onEditarRect={editarRect}
            esCreado={(nombre) => leaves.some((l) => l.name === nombre && l.origen === 'creado')}
          />
        </div>
      </div>
    </div>
  );
}
