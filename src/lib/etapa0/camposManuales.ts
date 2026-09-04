// ---------------------------------------------------------------------------
// Etapa 0 — Campos creados y borrados a mano (v1.4.4).
//
// EL PROBLEMA. El PDF del INS no siempre tiene los campos que el formulario
// necesita, y a veces tiene el campo equivocado. En el CSC:
//  - las cuatro firmas de la página 2 son líneas DIBUJADAS: hay 115 widgets y
//    cero `/Sig`, así que no existe ningún campo de firma;
//  - la misma fecha de nacimiento está resuelta distinto según la instancia: el
//    asegurado tiene UNA caja de 88pt encima de las tres rayas y el
//    representante tiene TRES de 22/22/31. Para que la skill pueda armar el
//    `autoFillConcat` igual en las dos hay que poder borrar la caja grande y
//    dibujar tres en su lugar.
//
// Y tiene que pasar ACÁ: el PDF renombrado se sube a Signframe y de ahí sale el
// `sourceMeta`. Un campo que no existe en ese momento no se arregla después sin
// rehacer el import del PDF entero.
//
// IDENTIDAD ESTABLE. Un campo creado lleva un `uid` propio que NO depende de su
// nombre. Si se identificaran por nombre, borrar `X` y crear otro `X` haría que
// las ediciones se reengancharan al campo equivocado, en silencio.
// ---------------------------------------------------------------------------

import type { PdfLeaf, Rect } from './pdfFields';
import { compareReadingOrder } from './pdfFields';

export interface CampoCreado {
  uid: string;
  nombre: string;
  /** '/Tx' | '/Btn' | '/Sig' */
  tipo: string;
  /** 0-based */
  page: number;
  rect: Rect;
  /** uid del grupo cuando salió de trocear un rect en N cajas */
  grupo?: string;
  /** posición dentro del grupo troceado (1-based) */
  parte?: number;
}

/**
 * Identidad de un campo a través de un recálculo de la lista.
 * Los creados usan su `uid`; los detectados, su AcroName ORIGINAL, que es
 * inmutable (el nombre nuevo vive aparte, en las ediciones).
 */
export function claveEstable(leaf: PdfLeaf): string {
  return leaf.uid ? `uid:${leaf.uid}` : `pdf:${leaf.name}`;
}

export interface CambiosResult {
  /** lista efectiva, ya en orden de lectura y con `readingIndex` recalculado */
  efectivos: PdfLeaf[];
  detectados: number;
  borrados: number;
  creados: number;
}

/**
 * Aplica los borrados y los creados sobre los campos detectados y devuelve la
 * lista EFECTIVA: la que ve la UI, la que se alinea y la que se escribe.
 * Se reordena por `(page, -Y, X)` para que un campo creado caiga en su lugar
 * visual, no al final.
 */
export function aplicarCambios(
  detectados: PdfLeaf[],
  creados: CampoCreado[],
  borrados: string[],
): CambiosResult {
  const fuera = new Set(borrados);
  const quedan = detectados.filter((l) => !fuera.has(l.name));

  const nuevos: PdfLeaf[] = creados.map((c) => ({
    name: c.nombre,
    ft: c.tipo,
    page: c.page,
    rect: c.rect,
    widgets: [{ page: c.page, rect: c.rect }],
    readingIndex: 0,
    multiWidgetSospechoso: false,
    paginas: [c.page],
    origen: 'creado' as const,
    uid: c.uid,
  }));

  const efectivos = [...quedan, ...nuevos]
    .sort(compareReadingOrder)
    .map((l, i) => ({ ...l, readingIndex: i + 1 }));

  return {
    efectivos,
    detectados: detectados.length,
    borrados: detectados.length - quedan.length,
    creados: nuevos.length,
  };
}

/**
 * Reparte un rect en `n` cajas horizontales con un hueco entre ellas.
 * Es el troceado de §4: se marca la zona una vez y salen las N cajas parejas.
 */
export function trocearRect(rect: Rect, n: number, gap = 4): Rect[] {
  if (n <= 1) return [rect];
  const total = rect.w - gap * (n - 1);
  const ancho = total / n;
  if (ancho <= 0) return [rect];
  return Array.from({ length: n }, (_, i) => ({
    x: rect.x + i * (ancho + gap),
    y: rect.y,
    w: ancho,
    h: rect.h,
  }));
}

/**
 * Remapea un estado indexado POR POSICIÓN a la nueva lista de campos.
 *
 * Sin esto, crear o borrar un campo corre todos los índices y el nombre nuevo se
 * muda de campo sin que nadie lo note: es el peor tipo de bug, silencioso y en
 * el entregable. El remapeo va por `claveEstable`, así que sobrevive tanto al
 * reordenamiento como al caso de borrar un campo y crear otro con el mismo
 * nombre.
 */
export function remapearPorClave<T>(
  previo: Record<number, T>,
  antes: PdfLeaf[],
  despues: PdfLeaf[],
): Record<number, T> {
  const porClave = new Map<string, T>();
  antes.forEach((l, i) => {
    const v = previo[i];
    if (v !== undefined) porClave.set(claveEstable(l), v);
  });
  const out: Record<number, T> = {};
  despues.forEach((l, i) => {
    const v = porClave.get(claveEstable(l));
    if (v !== undefined) out[i] = v;
  });
  return out;
}

/** Nombre sugerido para una caja troceada. */
export function nombreDeParte(base: string, sufijo: string): string {
  return base ? `${base}_${sufijo}` : '';
}
