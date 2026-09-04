// ---------------------------------------------------------------------------
// Etapa 1 — Ancho de cada campo, derivado del rect del main (v3.0.0).
//
// Es lo que más tiempo llevaba a mano. El main trae el rect real de cada campo,
// así que el ancho sale de la proporción entre el campo y el ancho ÚTIL de la
// página, no de la página entera: en estos formularios del INS hay márgenes de
// ~30pt por lado, y sobre 612pt de ancho el útil es ~552. Un campo de 552 tiene
// que dar `full`, no `half`.
//
// El margen NO es una constante: se deriva del propio main, con el mínimo X y el
// máximo X+W de los campos de cada página.
//
// Y se usa UN ancho útil para todo el documento (la mediana de las páginas), no
// el de cada página. Medido en el CSC: la página 1 tiene una banda vertical con
// el rótulo «DATOS DEL CLIENTE» que le come 29pt, así que su útil es 524 contra
// los 554 de la página 2. Con un útil por página, el MISMO campo de 382pt
// (`asg_detalle` y `rpl_detalle`) caía en dos escalones distintos según la
// página. El ancho es una decisión de layout web, no de la banda del PDF.
//
// Las casillas quedan afuera de la escala: el rect de un `/Btn` es el cuadradito
// (~10pt), no el ancho visual de la pregunta. En el CSC 66 de 84 campos de la
// página 1 son casillas y la mediana de ancho da 10.7pt — usar el rect ahí no
// mide nada. Una pregunta con opciones ocupa su renglón: `full`.
// ---------------------------------------------------------------------------

import type { AcroField, FieldWidth } from '../../types';

/** Rect tal como lo trae el `sourceMeta` del main de Signframe. */
export interface RectMain {
  X: number;
  Y: number;
  Width: number;
  Height: number;
}

/** Escalones, de más ancho a más angosto. */
export const UMBRALES: { min: number; ancho: FieldWidth }[] = [
  { min: 0.72, ancho: 'full' },
  { min: 0.42, ancho: 'half' },
  { min: 0.28, ancho: 'third' },
  { min: 0, ancho: 'quarter' },
];

export function rectDeAcro(a: AcroField): RectMain | null {
  const sm = a.sourceMeta as Record<string, unknown> | undefined;
  const r = (sm?.rect ?? sm?.Rect) as Record<string, unknown> | undefined;
  if (!r) return null;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const X = num(r.X ?? r.x);
  const Y = num(r.Y ?? r.y);
  const Width = num(r.Width ?? r.width ?? r.w);
  const Height = num(r.Height ?? r.height ?? r.h);
  if ([X, Y, Width, Height].some((n) => !Number.isFinite(n))) return null;
  return { X, Y, Width, Height };
}

function paginaDeAcro(a: AcroField): number {
  const sm = a.sourceMeta as Record<string, unknown> | undefined;
  const p = a.page ?? (typeof sm?.page === 'number' ? (sm.page as number) : undefined);
  return typeof p === 'number' ? p : 1;
}

export interface AnchoUtil {
  /** el ancho útil que se usa para todo el documento */
  util: number;
  /** por página: `{ pagina, min, max, util }` (para poder explicarlo en la UI) */
  porPagina: { pagina: number; min: number; max: number; util: number }[];
}

/**
 * Ancho útil del documento: la mediana de los anchos útiles por página, donde el
 * útil de una página es `max(X+Width) - min(X)` de sus campos.
 */
export function anchoUtil(campos: AcroField[]): AnchoUtil {
  const porPag = new Map<number, RectMain[]>();
  for (const a of campos) {
    const r = rectDeAcro(a);
    if (!r || r.Width <= 0) continue;
    const p = paginaDeAcro(a);
    if (!porPag.has(p)) porPag.set(p, []);
    porPag.get(p)!.push(r);
  }
  const porPagina = [...porPag.entries()]
    .map(([pagina, rects]) => {
      const min = Math.min(...rects.map((r) => r.X));
      const max = Math.max(...rects.map((r) => r.X + r.Width));
      return { pagina, min, max, util: max - min };
    })
    .sort((a, b) => a.pagina - b.pagina);

  if (porPagina.length === 0) return { util: 0, porPagina };
  const utiles = porPagina.map((p) => p.util).sort((a, b) => a - b);
  const mid = Math.floor(utiles.length / 2);
  const util = utiles.length % 2 === 1 ? utiles[mid] : (utiles[mid - 1] + utiles[mid]) / 2;
  return { util, porPagina };
}

/** Escalón que le corresponde a un ancho, contra el ancho útil. */
export function escalonDeAncho(width: number, util: number): FieldWidth {
  if (!(util > 0) || !(width > 0)) return 'full';
  const r = width / util;
  for (const u of UMBRALES) if (r >= u.min) return u.ancho;
  return 'quarter';
}

/**
 * Ancho de un campo del formulario.
 * Las casillas y los grupos de opciones no se miden por su rect: la pregunta
 * ocupa su renglón.
 */
export function anchoDeCampo(
  campo: { tipo: string; esOpcion?: boolean },
  rect: RectMain | null,
  util: number,
): FieldWidth {
  if (campo.esOpcion || campo.tipo === 'checkbox' || campo.tipo === 'radio') return 'full';
  if (campo.tipo === 'textarea' || campo.tipo === 'signature') return 'full';
  if (!rect) return 'full';
  return escalonDeAncho(rect.Width, util);
}
