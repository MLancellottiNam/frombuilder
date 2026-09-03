import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';
import { colorRegion, type Region } from '../../lib/etapa0/regiones';

/** Overlay ya proyectado a píxeles del canvas. */
interface Box {
  leaf: PdfLeaf;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Banda de fondo de una región, proyectada a píxeles del canvas. */
interface Banda {
  codigo: string;
  idx: number;
  top: number;
  height: number;
}

/**
 * Render del PDF a canvas con `pdfjs-dist` (lazy) y overlay de cada widget del
 * AcroForm con su nombre ACTUAL. Sirve para validar la lectura del AcroForm
 * antes de meter la lógica de alineación.
 */
export default function PdfPreview({
  file,
  leaves,
  selected,
  onSelect,
  confianza,
  nombreFinal,
  colisiones,
  regiones,
  regionPorLeaf,
  escalaMinima,
  onDibujar,
  esCreado,
}: {
  file: File | null;
  leaves: PdfLeaf[];
  selected: string | null;
  onSelect: (name: string) => void;
  /** leafName -> confianza de la pre-alineación (pinta el overlay) */
  confianza?: Map<string, string>;
  /** leafName(actual) -> nombre final que va a escribirse */
  nombreFinal?: Map<string, string>;
  /** nombres finales duplicados: se pintan en rojo y bloquean la descarga */
  colisiones?: Set<string>;
  /** regiones de las instancias, para pintarlas como bandas de fondo */
  regiones?: Region[];
  /** leafIdx -> código de instancia */
  regionPorLeaf?: Map<number, string>;
  /**
   * Se llama al soltar el rectángulo dibujado, con el rect ya en coordenadas
   * PDF (origen abajo-izquierda) y la página 0-based. Si no se pasa, el modo
   * dibujo no está disponible.
   */
  onDibujar?: (page: number, rect: { x: number; y: number; w: number; h: number }) => void;
  /** distintivo de los campos creados a mano: borde punteado */
  esCreado?: (leafName: string) => boolean;
  /**
   * Zoom mínimo garantizado. El modo revisión lo sube para que se lea la
   * etiqueta impresa alrededor del campo, que es lo que permite decidir de un
   * vistazo si el nombre está bien.
   */
  escalaMinima?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [bandas, setBandas] = useState<Banda[]>([]);
  const [dibujando, setDibujando] = useState(false);
  /** rect en píxeles del canvas mientras se arrastra */
  const [trazo, setTrazo] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const viewportRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Cargar el documento (pdfjs lazy).
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      docRef.current = null;
      setPageCount(0);
      setBoxes([]);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjs: any = await import('pdfjs-dist');
        // El worker se resuelve desde el propio paquete (Vite lo empaqueta).
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPage(1);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Render de la página + cálculo del overlay.
  useEffect(() => {
    let cancelled = false;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === 0) return;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const viewport = p.getViewport({ scale });
      viewportRef.current = viewport;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;

      // Proyectar cada widget de esta página a coordenadas del canvas.
      const out: Box[] = [];
      for (const leaf of leaves) {
        for (const w of leaf.widgets) {
          if (w.page !== page - 1) continue;
          // esquinas del rect en espacio PDF -> viewport
          const [x1, y1] = viewport.convertToViewportPoint(w.rect.x, w.rect.y);
          const [x2, y2] = viewport.convertToViewportPoint(w.rect.x + w.rect.w, w.rect.y + w.rect.h);
          out.push({
            leaf,
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          });
        }
      }
      setBoxes(out);

      // Bandas de región: el rango vertical que ocupan sus campos en ESTA
      // página. Se ve de un vistazo si una región quedó corrida.
      const bs: Banda[] = [];
      (regiones ?? []).forEach((r, idx) => {
        let minTop = Infinity;
        let maxBottom = -Infinity;
        for (let j = r.desdeLeaf; j <= r.hastaLeaf; j++) {
          const l = leaves[j];
          if (!l) continue;
          for (const w of l.widgets) {
            if (w.page !== page - 1) continue;
            const [, y1] = viewport.convertToViewportPoint(w.rect.x, w.rect.y);
            const [, y2] = viewport.convertToViewportPoint(w.rect.x, w.rect.y + w.rect.h);
            minTop = Math.min(minTop, y1, y2);
            maxBottom = Math.max(maxBottom, y1, y2);
          }
        }
        if (!Number.isFinite(minTop)) return;
        bs.push({ codigo: r.codigo, idx, top: minTop - 4, height: maxBottom - minTop + 8 });
      });
      setBandas(bs);
    })();
    return () => {
      cancelled = true;
    };
  }, [page, scale, pageCount, leaves, regiones]);

  // Zoom mínimo pedido por el modo revisión.
  useEffect(() => {
    if (escalaMinima != null) setScale((s) => (s < escalaMinima ? escalaMinima : s));
  }, [escalaMinima]);

  // Esc sale del modo dibujo y cancela el trazo en curso.
  useEffect(() => {
    if (!dibujando) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTrazo(null);
      setDibujando(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dibujando]);

  // Al seleccionar desde la tabla: saltar a su página y hacer scroll.
  useEffect(() => {
    if (!selected) return;
    const leaf = leaves.find((l) => l.name === selected);
    if (!leaf) return;
    const target = leaf.widgets[0].page + 1;
    if (target !== page) setPage(target);
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-box="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selected, leaves]); // eslint-disable-line react-hooks/exhaustive-deps

  // A.2: si el campo seleccionado tiene widgets en varias páginas, avisarlo.
  // Todos sus widgets se resaltan; los de otra página no se ven en este canvas.
  const selLeaf = selected ? leaves.find((l) => l.name === selected) : undefined;
  const selMultiPagina = selLeaf && selLeaf.paginas.length > 1 ? selLeaf.paginas.map((x) => x + 1) : null;

  /** Convierte el trazo (píxeles del canvas) a coordenadas PDF. */
  const trazoAPdf = (t: { x0: number; y0: number; x1: number; y1: number }) => {
    const vp = viewportRef.current;
    if (!vp) return null;
    // `convertToPdfPoint` deshace la escala y el flip vertical, así que el rect
    // sale en coordenadas de página con origen abajo-izquierda y no depende del
    // zoom con el que se dibujó.
    const [ax, ay] = vp.convertToPdfPoint(t.x0, t.y0);
    const [bx, by] = vp.convertToPdfPoint(t.x1, t.y1);
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    return { x, y, w, h };
  };

  const posEnCanvas = (e: React.MouseEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!dibujando) return;
    e.preventDefault();
    const p = posEnCanvas(e);
    setTrazo({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dibujando || !trazo) return;
    const p = posEnCanvas(e);
    setTrazo({ ...trazo, x1: p.x, y1: p.y });
  };
  const onMouseUp = () => {
    if (!dibujando || !trazo) return;
    const rect = trazoAPdf(trazo);
    setTrazo(null);
    setDibujando(false);
    // Un click sin arrastre no es un campo.
    if (rect && rect.w >= 4 && rect.h >= 4) onDibujar?.(page - 1, rect);
  };

  if (!file) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400 px-6 text-center">
        Cargá el PDF crudo para ver los campos del AcroForm marcados encima.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 text-xs">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-slate-600">
          {pageCount ? `${page} / ${pageCount}` : '—'}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
        <div className="flex-1" />
        <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="p-1 rounded hover:bg-slate-100">
          <ZoomOut size={15} />
        </button>
        <span className="text-slate-500 w-10 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="p-1 rounded hover:bg-slate-100">
          <ZoomIn size={15} />
        </button>
        {onDibujar && (
          <button
            onClick={() => {
              setTrazo(null);
              setDibujando((v) => !v);
            }}
            data-dibujar
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 border text-[11px] ${
              dibujando ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300 text-slate-600'
            }`}
            title="Dibujá un rectángulo sobre el preview para crear el campo (Esc cancela)"
          >
            <Plus size={12} /> {dibujando ? 'Dibujá el rectángulo…' : 'Agregar campo'}
          </button>
        )}
        <span className="text-slate-400 ml-2">{boxes.length} widgets en esta página</span>
        {selMultiPagina && (
          <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px]">
            «{selected}» tiene widgets en las páginas {selMultiPagina.join(', ')}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-600 p-3">No se pudo renderizar: {error}</p>}
      {loading && <p className="text-xs text-slate-500 p-3">Cargando PDF…</p>}

      {dibujando && (
        <p className="px-3 py-1 text-[11px] bg-brand-50 text-brand-800 border-b border-brand-200" data-aviso-dibujo>
          Dibujá un rectángulo sobre el preview para crear el campo. <b>Esc</b> cancela.
        </p>
      )}

      <div ref={wrapRef} className="flex-1 overflow-auto scroll-thin bg-slate-200 p-3">
        <div
          className={`relative inline-block shadow-sm ${dibujando ? 'cursor-crosshair' : ''}`}
          style={{ lineHeight: 0 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <canvas ref={canvasRef} className="block bg-white" />
          {bandas.map((b) => (
            <div
              key={b.codigo}
              data-banda={b.codigo}
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: b.top,
                height: b.height,
                background: colorRegion(b.idx, 0.07),
                borderTop: `2px solid ${colorRegion(b.idx, 0.5)}`,
                borderBottom: `2px solid ${colorRegion(b.idx, 0.5)}`,
              }}
            >
              <span
                className="absolute right-1 top-1 rounded px-1 text-[9px] font-mono"
                style={{ background: colorRegion(b.idx, 0.85), color: 'white' }}
              >
                {b.codigo}
              </span>
            </div>
          ))}
          {trazo && (
            <div
              className="absolute border-2 border-brand-600 bg-brand-500/20 pointer-events-none"
              style={{
                left: Math.min(trazo.x0, trazo.x1),
                top: Math.min(trazo.y0, trazo.y1),
                width: Math.abs(trazo.x1 - trazo.x0),
                height: Math.abs(trazo.y1 - trazo.y0),
              }}
            />
          )}
          {boxes.map((b, i) => {
            const isSel = b.leaf.name === selected;
            // alta=azul · media/revisar=ámbar · sin asignar=gris
            const conf = confianza?.get(b.leaf.name);
            const final = nombreFinal?.get(b.leaf.name) ?? b.leaf.name;
            const choca = colisiones?.has(final) ?? false;
            const tono = choca
              ? 'border-red-500 bg-red-500/25 hover:bg-red-500/35'
              :
              conf === 'alta'
                ? 'border-blue-500/80 bg-blue-500/15 hover:bg-blue-500/25'
                : conf === 'media' || conf === 'revisar'
                  ? 'border-amber-500/80 bg-amber-500/20 hover:bg-amber-500/30'
                  : 'border-slate-400/70 bg-slate-400/10 hover:bg-slate-400/20';
            const tonoBadge = choca
              ? 'bg-red-600 text-white'
              :
              conf === 'alta'
                ? 'bg-blue-100 text-blue-800'
                : conf === 'media' || conf === 'revisar'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-200 text-slate-600';
            return (
              <button
                key={i}
                data-box={b.leaf.name}
                title={
                `#${b.leaf.readingIndex} · ${b.leaf.name} · ${b.leaf.ft}` +
                (regionPorLeaf?.get(b.leaf.readingIndex - 1)
                  ? ` · región ${regionPorLeaf.get(b.leaf.readingIndex - 1)}`
                  : '')
              }
                onClick={() => onSelect(b.leaf.name)}
                className={`absolute transition-colors ${
                  esCreado?.(b.leaf.name) ? 'border-2 border-dashed' : 'border'
                } ${isSel ? 'border-brand-600 bg-brand-500/30 ring-1 ring-brand-600' : tono} ${
                  dibujando ? 'pointer-events-none' : ''
                }`}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              >
                <span
                  className={`absolute left-0 -top-[13px] whitespace-nowrap rounded px-1 text-[9px] leading-[13px] font-mono ${
                    isSel ? 'bg-brand-600 text-white' : tonoBadge
                  }`}
                >
                  {b.leaf.readingIndex}. {final}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
