// ---------------------------------------------------------------------------
// Etapa 0 — Edición de la geometría de un campo (v2.0.0).
//
// Hasta v1.4.5 se podían crear campos nuevos con el rect que uno dibujaba, pero
// un campo YA detectado solo se podía renombrar: si el PDF del INS trae la caja
// corrida, corta o encimada con la de al lado, no había cómo arreglarlo. Ahora
// se mueve y se redimensiona, y aplica igual a detectados y a creados.
//
// DOS CLAVES DISTINTAS, a propósito:
//
//  - En la UI el override se indexa por `claveEstable(leaf)#índiceDeWidget`. El
//    índice es estable porque se toma sobre la lista ORIGINAL de campos, que no
//    cambia nunca (los cambios viven en overrides, no en la lista).
//
//  - Para ESCRIBIR no se puede usar ese índice: `readPdfFields` ordena los
//    widgets por orden de lectura y `writePdf` los recorre en el orden de
//    /Kids, que no es el mismo. Un índice movería el widget equivocado en
//    silencio, que es el peor error posible. Así que la escritura empareja por
//    el rect ORIGINAL del widget (`{desde, hasta}`), que no depende del orden.
// ---------------------------------------------------------------------------

import type { PdfLeaf, Rect } from './pdfFields';
import { claveEstable } from './camposManuales';

export type RectsEditados = Record<string, Rect>;

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Tamaño mínimo de un campo, en puntos PDF. */
export const MIN_LADO = 4;

export function claveRect(leaf: PdfLeaf, widgetIdx: number): string {
  return `${claveEstable(leaf)}#${widgetIdx}`;
}

/** w/h siempre positivos (arrastrar hacia arriba/izquierda los invierte). */
export function normalizarRect(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function moverRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/**
 * Redimensiona desde un handle. `dx`/`dy` van en coordenadas PDF (y crece hacia
 * arriba), así que un handle `n` mueve el borde superior con `dy` positivo.
 */
export function redimensionarRect(r: Rect, handle: Handle, dx: number, dy: number, min = MIN_LADO): Rect {
  let { x, y, w, h } = r;
  // El borde que se arrastra NO puede cruzar al de enfrente. Dejarlo invertir
  // —como hace un editor de dibujo— acá desorienta: el campo salta al otro lado
  // de su rótulo. Se topea en `min` y el borde fijo se queda donde está.
  if (handle.includes('w')) {
    const nx = Math.min(x + dx, x + w - min);
    w = x + w - nx;
    x = nx;
  }
  if (handle.includes('e')) w = Math.max(min, w + dx);
  if (handle.includes('s')) {
    const ny = Math.min(y + dy, y + h - min);
    h = y + h - ny;
    y = ny;
  }
  if (handle.includes('n')) h = Math.max(min, h + dy);
  return normalizarRect({ x, y, w, h });
}

/**
 * Devuelve la lista de campos con los rects editados aplicados. Se usa ANTES de
 * `aplicarCambios`, para que el reordenamiento por orden de lectura tenga en
 * cuenta la posición nueva: un campo que se movió a otra parte de la página
 * tiene que aparecer donde está, no donde estaba.
 */
export function aplicarRects(detectados: PdfLeaf[], edit: RectsEditados): PdfLeaf[] {
  if (Object.keys(edit).length === 0) return detectados;
  return detectados.map((leaf) => {
    let tocado = false;
    const widgets = leaf.widgets.map((w, k) => {
      const r = edit[claveRect(leaf, k)];
      if (!r) return w;
      tocado = true;
      return { page: w.page, rect: r };
    });
    if (!tocado) return leaf;
    // El widget primario es el primero en orden de lectura, y moverlo puede
    // cambiar cuál es: se recalcula.
    //
    // Lo que NO se hace es reordenar `widgets`: el índice de widget es la clave
    // del override, y si la lista se reordenara, el próximo arrastre sobre ese
    // campo escribiría en la clave de otro widget. El orden se queda como lo
    // dejó la lectura original.
    const primero = [...widgets].sort((a, b) =>
      a.page !== b.page
        ? a.page - b.page
        : b.rect.y + b.rect.h !== a.rect.y + a.rect.h
          ? b.rect.y + b.rect.h - (a.rect.y + a.rect.h)
          : a.rect.x - b.rect.x,
    )[0];
    return {
      ...leaf,
      page: primero.page,
      rect: primero.rect,
      widgets,
      paginas: Array.from(new Set(widgets.map((w) => w.page))).sort((a, b) => a - b),
    };
  });
}

export interface CambioRect {
  desde: Rect;
  hasta: Rect;
}

/**
 * Traduce los overrides a lo que necesita la escritura: por nombre ACTUAL del
 * campo, la lista de `{rect original -> rect nuevo}`. Sin índices.
 */
export function paraEscritura(detectados: PdfLeaf[], edit: RectsEditados): Map<string, CambioRect[]> {
  const out = new Map<string, CambioRect[]>();
  for (const leaf of detectados) {
    leaf.widgets.forEach((w, k) => {
      const hasta = edit[claveRect(leaf, k)];
      if (!hasta) return;
      if (!out.has(leaf.name)) out.set(leaf.name, []);
      out.get(leaf.name)!.push({ desde: w.rect, hasta });
    });
  }
  return out;
}

/** Dos rects son el mismo widget si coinciden dentro de medio punto. */
export function mismoRect(a: Rect, b: Rect, tol = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.w - b.w) <= tol &&
    Math.abs(a.h - b.h) <= tol
  );
}
