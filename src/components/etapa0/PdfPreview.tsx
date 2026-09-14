import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import type { PdfLeaf, Rect } from '../../lib/etapa0/pdfFields';

import { moverRect, redimensionarRect, type Handle } from '../../lib/etapa0/rects';

/** Overlay ya proyectado a píxeles del canvas. */
interface Box {
  leaf: PdfLeaf;
  /** índice del widget dentro del campo: un campo puede tener varias cajas */
  widgetIdx: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Arrastre en curso sobre una caja: mover el campo entero o estirar un borde.
 * El delta se mide en píxeles de pantalla y se traduce a puntos PDF con el
 * viewport, así que no depende del zoom (ni de una página rotada).
 */
interface Arrastre {
  tipo: 'mover' | Handle;
  box: Box;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** un click sin desplazamiento es una selección, no una edición */
  movido: boolean;
}

/** Los 8 tiradores, en el orden en que se dibujan. */
const HANDLES: { h: Handle; cx: number; cy: number; cursor: string }[] = [
  { h: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { h: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { h: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { h: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { h: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' },
  { h: 's', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { h: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { h: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

/** Cuadradito de color de la leyenda del overlay. */
function Muestra({ clase, children }: { clase: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-3 h-2.5 rounded-sm border ${clase}`} />
      {children}
    </span>
  );
}

/**
 * Render del PDF a canvas con `pdfjs-dist` (lazy) y overlay de cada widget del
 * AcroForm con su nombre final. Es el panel derecho: se ve dónde cae cada campo,
 * se dibujan campos nuevos y se mueve o redimensiona el seleccionado.
 */
export default function PdfPreview({
  file,
  leaves,
  selected,
  onSelect,
  renombrado,
  nombreFinal,
  colisiones,
  onDibujar,
  onEditarRect,
  esCreado,
}: {
  file: File | null;
  leaves: PdfLeaf[];
  selected: string | null;
  onSelect: (name: string) => void;
  /**
   * Nombres ACTUALES de los campos que ya tienen nombre nuevo. Es lo único que
   * el overlay necesita pintar distinto desde v2.0.0: antes era la confianza de
   * la alineación automática, que ya no existe.
   */
  renombrado?: Set<string>;
  /** leafName(actual) -> nombre final que va a escribirse */
  nombreFinal?: Map<string, string>;
  /** nombres finales duplicados: se pintan en rojo y bloquean la descarga */
  colisiones?: Set<string>;
  /**
   * Se llama al soltar el rectángulo dibujado, con el rect ya en coordenadas
   * PDF (origen abajo-izquierda) y la página 0-based. Si no se pasa, el modo
   * dibujo no está disponible.
   */
  onDibujar?: (page: number, rect: { x: number; y: number; w: number; h: number }) => void;
  /**
   * v2.0.0: mover o redimensionar la caja de un campo. Llega el rect ya en
   * coordenadas PDF y el índice del widget dentro del campo (un campo puede
   * tener varias cajas y se edita la que se arrastró, no todas).
   */
  onEditarRect?: (leaf: PdfLeaf, widgetIdx: number, rect: Rect) => void;
  /** distintivo de los campos creados a mano: borde punteado */
  esCreado?: (leafName: string) => boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [dibujando, setDibujando] = useState(false);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const arrastreRef = useRef<Arrastre | null>(null);
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
            widgetIdx: leaf.widgets.indexOf(w),
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          });
        }
      }
      setBoxes(out);

    })();
    return () => {
      cancelled = true;
    };
  }, [page, scale, pageCount, leaves]);

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

  // Al seleccionar desde la tabla: saltar a su página.
  useEffect(() => {
    if (!selected) return;
    const leaf = leaves.find((l) => l.name === selected);
    if (!leaf) return;
    const target = leaf.widgets[0].page + 1;
    if (target !== page) setPage(target);
  }, [selected, leaves]); // eslint-disable-line react-hooks/exhaustive-deps

  // El scroll va en su propio efecto, atado a `boxes`: cuando el campo está en
  // otra página, el `setPage` de arriba no alcanza a renderizar la caja en el
  // mismo tick y el scroll se perdía. Al depender de `boxes` corre recién
  // cuando la caja existe, así que el salto entre páginas también centra.
  //
  // Pero `boxes` también cambia al EDITAR la geometría, y ahí re-centrar es
  // molesto: la página salta abajo del puntero mientras se arrastra. Así que se
  // scrollea una sola vez por (campo, página).
  const scrollHecho = useRef('');
  useEffect(() => {
    if (!selected) return;
    const clave = `${selected}@${page}`;
    if (scrollHecho.current === clave) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-box="${CSS.escape(selected)}"]`);
    if (!el) return;
    scrollHecho.current = clave;
    // Vertical al centro, horizontal lo mínimo: centrar en X corría la página y
    // dejaba fuera la etiqueta impresa a la izquierda del campo, que es
    // justamente lo que hay que leer para decidir si el nombre está bien.
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [selected, boxes, page]);

  // A.2: si el campo seleccionado tiene widgets en varias páginas, avisarlo.
  // Todos sus widgets se resaltan; los de otra página no se ven en este canvas.
  const selLeaf = selected ? leaves.find((l) => l.name === selected) : undefined;
  const selMultiPagina = selLeaf && selLeaf.paginas.length > 1 ? selLeaf.paginas.map((x) => x + 1) : null;

  // --- v2.0.0: mover y redimensionar la caja de un campo -------------------

  /** Delta del arrastre en puntos PDF. Sale del viewport, así que el zoom (y
   * una página rotada) no lo afectan. */
  const deltaPdf = (dx: number, dy: number): [number, number] => {
    const vp = viewportRef.current;
    if (!vp) return [0, 0];
    const [x0, y0] = vp.convertToPdfPoint(0, 0);
    const [x1, y1] = vp.convertToPdfPoint(dx, dy);
    return [x1 - x0, y1 - y0];
  };

  /** El rect que tendría el widget si el arrastre terminara ahora. */
  const rectArrastrado = (a: Arrastre): Rect => {
    const base = a.box.leaf.widgets[a.box.widgetIdx]?.rect ?? a.box.leaf.rect;
    const [dx, dy] = deltaPdf(a.dx, a.dy);
    return a.tipo === 'mover' ? moverRect(base, dx, dy) : redimensionarRect(base, a.tipo, dx, dy);
  };

  /** Ese mismo rect proyectado a píxeles del canvas, para el fantasma. */
  const cajaArrastrada = (a: Arrastre) => {
    const vp = viewportRef.current;
    const r = rectArrastrado(a);
    if (!vp) return null;
    const [x1, y1] = vp.convertToViewportPoint(r.x, r.y);
    const [x2, y2] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  };

  const iniciarArrastre = (e: React.MouseEvent, box: Box, tipo: 'mover' | Handle) => {
    if (dibujando || !onEditarRect) return;
    e.preventDefault();
    e.stopPropagation();
    const a: Arrastre = { tipo, box, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, movido: false };
    arrastreRef.current = a;
    setArrastre(a);
  };

  // Los listeners van en `window` y no en la caja: si el puntero se sale del
  // widget a mitad del arrastre —lo normal al agrandar— el drag no se corta.
  const arrastrando = arrastre !== null;
  useEffect(() => {
    if (!arrastrando) return;
    const mover = (ev: MouseEvent) => {
      const a = arrastreRef.current;
      if (!a) return;
      const dx = ev.clientX - a.x0;
      const dy = ev.clientY - a.y0;
      const next = { ...a, dx, dy, movido: a.movido || Math.abs(dx) > 2 || Math.abs(dy) > 2 };
      arrastreRef.current = next;
      setArrastre(next);
    };
    const soltar = () => {
      const a = arrastreRef.current;
      arrastreRef.current = null;
      setArrastre(null);
      if (!a) return;
      // Sin desplazamiento fue un click: seleccionar, no editar.
      if (!a.movido) {
        onSelect(a.box.leaf.name);
        return;
      }
      onEditarRect?.(a.box.leaf, a.box.widgetIdx, rectArrastrado(a));
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    return () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
  }, [arrastrando]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Qué significa cada color del overlay. Sin esto hay que adivinarlo. */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 border-b border-slate-100 text-[10px] text-slate-500"
        data-leyenda
      >
        <span className="text-slate-400">Colores:</span>
        <Muestra clase="border-blue-500/80 bg-blue-500/15">con nombre nuevo</Muestra>
        <Muestra clase="border-slate-400/70 bg-slate-400/10">sin nombre nuevo</Muestra>
        <Muestra clase="border-red-500 bg-red-500/25">nombre repetido</Muestra>
        <Muestra clase="border-2 border-dashed border-slate-500">creado a mano</Muestra>
        <span className="text-slate-400">· click abre el campo · arrastrá para mover</span>
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
            // con nombre nuevo = azul · sin nombre = gris · repetido = rojo
            const tieneNombre = renombrado?.has(b.leaf.name) ?? false;
            const final = nombreFinal?.get(b.leaf.name) ?? b.leaf.name;
            const choca = colisiones?.has(final) ?? false;
            const tono = choca
              ? 'border-red-500 bg-red-500/25 hover:bg-red-500/35'
              : tieneNombre
                ? 'border-blue-500/80 bg-blue-500/15 hover:bg-blue-500/25'
                : 'border-slate-400/70 bg-slate-400/10 hover:bg-slate-400/20';
            const tonoBadge = choca
              ? 'bg-red-600 text-white'
              : tieneNombre
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-200 text-slate-600';
            // Mientras se arrastra, la caja se dibuja donde va a quedar.
            const enArrastre =
              arrastre && arrastre.box.leaf.name === b.leaf.name && arrastre.box.widgetIdx === b.widgetIdx;
            const fantasma = enArrastre ? cajaArrastrada(arrastre!) : null;
            const geo = fantasma ?? { left: b.left, top: b.top, width: b.width, height: b.height };
            const editable = !!onEditarRect && !dibujando;
            return (
              <div
                key={i}
                data-box={b.leaf.name}
                data-widget={b.widgetIdx}
                title={
                  `#${b.leaf.readingIndex} · ${b.leaf.name} · ${b.leaf.ft}` +
                  (b.leaf.widgets.length > 1 ? ` · caja ${b.widgetIdx + 1} de ${b.leaf.widgets.length}` : '') +
                  (editable ? ' · arrastrá para mover, los tiradores para redimensionar' : '')
                }
                onMouseDown={(e) => (editable ? iniciarArrastre(e, b, 'mover') : undefined)}
                onClick={() => (editable ? undefined : onSelect(b.leaf.name))}
                className={`absolute transition-colors ${
                  esCreado?.(b.leaf.name) ? 'border-2 border-dashed' : 'border'
                } ${isSel ? 'border-brand-600 bg-brand-500/30 ring-1 ring-brand-600' : tono} ${
                  dibujando ? 'pointer-events-none' : editable ? 'cursor-move' : 'cursor-pointer'
                }`}
                style={{ left: geo.left, top: geo.top, width: geo.width, height: geo.height }}
              >
                <span
                  className={`absolute left-0 -top-[13px] whitespace-nowrap rounded px-1 text-[9px] leading-[13px] font-mono ${
                    isSel ? 'bg-brand-600 text-white' : tonoBadge
                  }`}
                >
                  {b.leaf.readingIndex}. {final}
                </span>
                {/* Tiradores: solo en el campo seleccionado, para no llenar la
                    pantalla de cuadraditos en un formulario de 111 campos. */}
                {isSel &&
                  editable &&
                  HANDLES.map((hh) => (
                    <span
                      key={hh.h}
                      data-handle={hh.h}
                      onMouseDown={(e) => iniciarArrastre(e, b, hh.h)}
                      style={{
                        position: 'absolute',
                        left: `calc(${hh.cx * 100}% - 3px)`,
                        top: `calc(${hh.cy * 100}% - 3px)`,
                        cursor: hh.cursor,
                      }}
                      className="w-[7px] h-[7px] bg-white border border-brand-600 rounded-sm"
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
