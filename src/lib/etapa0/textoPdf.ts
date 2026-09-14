// ---------------------------------------------------------------------------
// Etapa 0 — Texto impreso del PDF (v3.0.0).
//
// Es lo que sobrevive de `regiones.ts` después del recorte: el módulo grande
// existía para MAPEAR ficha↔PDF con regiones, anclas y segmentos, y eso se fue
// afuera. Lo que queda es puro dato de salida, sin heurística de mapeo:
//
//   - leer el texto del PDF con pdfjs,
//   - encontrar el rótulo que el PDF tiene impreso al lado de un widget,
//   - derivar los sufijos de un campo troceado por su formato de fecha.
//
// Las tres cosas alimentan las columnas del paquete de campos y el troceado.
// ---------------------------------------------------------------------------

import type { PdfLeaf } from './pdfFields';

/** Un fragmento de texto del PDF, en coordenadas de página. */
export interface TextItem {
  str: string;
  /** 0-based */
  page: number;
  x: number;
  y: number;
  /** ancho del texto en su propia dirección de escritura */
  w: number;
  /** true si está rotado (etiquetas laterales verticales) */
  rotado: boolean;
}

/** Distancia horizontal máxima para considerar un texto como rótulo. */
export const MAX_DIST_ETIQUETA = 90;

/** Convierte un item de pdfjs a `TextItem`. */
export function textItemDePdfjs(
  it: { str: string; transform: number[]; width: number },
  page: number,
): TextItem {
  const [a, b, , , e, f] = it.transform;
  return {
    str: it.str,
    page,
    x: e,
    y: f,
    w: it.width,
    rotado: Math.abs(b) > Math.abs(a),
  };
}

/** Todo el texto del PDF. `pdfjs` se carga lazy: solo se usa en Etapa 0. */
export async function extraerTextoPdf(data: ArrayBuffer | Uint8Array): Promise<TextItem[]> {
  const pdfjs: any = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data as ArrayBuffer) }).promise;
  const out: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
      out.push(textItemDePdfjs(it, p - 1));
    }
  }
  return out;
}

export interface EtiquetaLeaf {
  /** texto pegado a la izquierda, en la misma línea */
  izq: string;
  /** texto pegado a la derecha, en la misma línea */
  der: string;
}

/**
 * Etiquetas candidatas de un campo. Los campos de texto llevan el rótulo a la
 * IZQUIERDA («1er Apellido:» y después la caja); las casillas lo llevan a la
 * DERECHA («☐ Cédula ☐ DIMEX»). Se devuelven las dos y decide quien las use.
 */
export function etiquetasDeLeaf(leaf: PdfLeaf, texto: TextItem[]): EtiquetaLeaf {
  const cy = leaf.rect.y + leaf.rect.h / 2;
  const buscar = (tol: number): EtiquetaLeaf => {
    const enLinea = texto.filter(
      (t) =>
        !t.rotado &&
        t.page === leaf.page &&
        Math.abs(t.y + 3 - cy) <= tol &&
        // Un texto de solo guiones, puntos o espacios no es una etiqueta: es el
        // placeholder de la línea a completar. En el CSC la fecha del
        // representante trae "_____ / _____ /_______" entre sus tres cajas.
        /[a-z0-9]/i.test(t.str),
    );
    const izq = enLinea
      .filter((t) => t.x + t.w <= leaf.rect.x + 4 && leaf.rect.x - (t.x + t.w) <= MAX_DIST_ETIQUETA)
      .sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    const der = enLinea
      .filter((t) => t.x >= leaf.rect.x - 4 && t.x - leaf.rect.x <= MAX_DIST_ETIQUETA)
      .sort((a, b) => a.x - b.x)[0];
    return { izq: izq?.str ?? '', der: der?.str ?? '' };
  };

  const propia = buscar(9);
  if (propia.izq || propia.der) return propia;
  // Si en su propia línea no hay candidato, mirar la de arriba y la de abajo:
  // en formularios densos un campo cae ENTRE dos filas y su rótulo no está en
  // su línea.
  return buscar(22);
}

/**
 * La etiqueta que corresponde al tipo de campo, y SOLO esa.
 * Una casilla lleva el rótulo a la derecha; una caja de texto, a la izquierda.
 * Mirar los dos lados parece más generoso pero genera cruces. El otro lado solo
 * se usa si el preferido está vacío.
 */
export function etiquetaPreferida(leaf: PdfLeaf, e: EtiquetaLeaf): string[] {
  const [primero, segundo] = leaf.ft === '/Btn' ? [e.der, e.izq] : [e.izq, e.der];
  return primero ? [primero] : segundo ? [segundo] : [];
}

/**
 * Sufijos de un campo troceado, derivados del formato de la fila.
 * `dd/mm/aaaa` con n=3 -> `['dia','mes','ano']`. Si no se puede derivar, quien
 * llama usa sufijos posicionales `_1.._n`. Es estructural y editable, no
 * desambiguación de una colisión.
 */
export function sufijosDeFormato(valor: string, n: number): string[] | undefined {
  const partes = (valor ?? '').split(/[/\-.]/).map((x) => x.trim().toLowerCase());
  if (partes.length !== n) return undefined;
  const nombre = (p: string): string | null => {
    if (/^d+$/.test(p)) return 'dia';
    if (/^m+$/.test(p)) return 'mes';
    if (/^a+$/.test(p) || /^y+$/.test(p)) return 'ano';
    return null;
  };
  const out = partes.map(nombre);
  return out.every((x): x is string => !!x) ? out : undefined;
}
