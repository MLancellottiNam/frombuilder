import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { PdfLeaf } from '../../lib/etapa0/pdfFields';

/** Overlay ya proyectado a píxeles del canvas. */
interface Box {
  leaf: PdfLeaf;
  left: number;
  top: number;
  width: number;
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
}: {
  file: File | null;
  leaves: PdfLeaf[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [boxes, setBoxes] = useState<Box[]>([]);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [page, scale, pageCount, leaves]);

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
        <span className="text-slate-400 ml-2">{boxes.length} widgets en esta página</span>
        {selMultiPagina && (
          <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px]">
            «{selected}» tiene widgets en las páginas {selMultiPagina.join(', ')}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-600 p-3">No se pudo renderizar: {error}</p>}
      {loading && <p className="text-xs text-slate-500 p-3">Cargando PDF…</p>}

      <div ref={wrapRef} className="flex-1 overflow-auto scroll-thin bg-slate-200 p-3">
        <div className="relative inline-block shadow-sm" style={{ lineHeight: 0 }}>
          <canvas ref={canvasRef} className="block bg-white" />
          {boxes.map((b, i) => {
            const isSel = b.leaf.name === selected;
            return (
              <button
                key={i}
                data-box={b.leaf.name}
                title={`#${b.leaf.readingIndex} · ${b.leaf.name} · ${b.leaf.ft}`}
                onClick={() => onSelect(b.leaf.name)}
                className={`absolute border transition-colors ${
                  isSel ? 'border-brand-600 bg-brand-500/25' : 'border-brand-500/70 bg-brand-500/10 hover:bg-brand-500/20'
                }`}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              >
                <span
                  className={`absolute left-0 -top-[13px] whitespace-nowrap rounded px-1 text-[9px] leading-[13px] font-mono ${
                    isSel ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-800'
                  }`}
                >
                  {b.leaf.readingIndex}. {b.leaf.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
