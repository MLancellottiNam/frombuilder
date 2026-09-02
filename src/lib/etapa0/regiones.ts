// ---------------------------------------------------------------------------
// Etapa 0 — Regiones geométricas de las instancias (Fix B de v1.4.1).
//
// EL PROBLEMA. Un solo pase secuencial global no puede funcionar: la ficha está
// ordenada por contrato JSON y el PDF por layout visual, y el bloque repetible
// expandido da muchas más filas que campos (en el CSC 59 × 3 = 177 contra 111).
// La deriva es inevitable y termina con campos `rpl_*` en la página 1.
//
// LA SOLUCIÓN. Cada instancia ocupa una REGIÓN del PDF: un rango contiguo del
// orden de lectura. La alineación corre dentro de cada región y nunca cruza el
// límite. Así una fila que no tiene campo en su región queda huérfana en vez de
// robarle el campo a otra instancia.
//
// CÓMO SE SIEMBRAN LAS REGIONES (sin hardcodear nada del formulario):
//
//  1. Los grupos de opciones del bloque repetible se buscan en el TEXTO del PDF.
//     En el CSC "Tipo de Identificación" aparece en tres bandas —p1 y=578
//     (DIMEX/DIDI/Pasaporte/Otro), p1 y=278 (Jurídica Nacional/Gobierno/
//     Institución Autónoma/Jurídica Extranjera) y p2 y=712 (Cédula/DIMEX/DIDI/
//     Pasaporte/Otro)—. Tres bandas para tres instancias: la banda k ancla la
//     instancia k. Un grupo cuya cantidad de bandas NO coincide con la cantidad
//     de instancias se descarta: es ruido, no un ancla.
//
//  2. Una banda cae en el MEDIO del bloque, no en su borde. El borde exacto sale
//     de una señal distinta: el MAYOR SALTO VERTICAL entre campos consecutivos
//     dentro de la zona ambigua. En el CSC, entre el último campo de ASG (y=366)
//     y el primero de PJR (y=339) hay 27pt, contra 20–21pt de los saltos
//     internos del bloque; el corte cae exacto. Un cambio de página es un salto
//     infinito y siempre gana.
//
// La siembra es ORIENTATIVA: el usuario corrige `desdeLeaf`/`hastaLeaf` con dos
// selects por instancia. Corregir 3 pares es infinitamente más barato que
// corregir 111 asignaciones.
// ---------------------------------------------------------------------------

import type { PdfLeaf } from './pdfFields';
import { slug } from './acroName';

/** Un fragmento de texto del PDF, ya proyectado a coordenadas PDF. */
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

/** Grupo de opciones del bloque repetible: un label con varios valores. */
export interface GrupoOpciones {
  label: string;
  valores: string[];
}

export type OrigenRegion = 'opciones' | 'resto' | 'manual';

export interface Region {
  codigo: string;
  /** índice en `leaves` (orden de lectura), inclusive */
  desdeLeaf: number;
  /** índice en `leaves`, inclusive */
  hastaLeaf: number;
  origen: OrigenRegion;
  detalle: string;
}

export interface SiembraResult {
  regiones: Region[];
  /** bandas encontradas, para mostrarlas y depurar */
  bandas: BandaOpciones[];
  avisos: string[];
}

export interface BandaOpciones {
  label: string;
  page: number;
  y: number;
  valores: string[];
  /** índice del leaf más cercano */
  leafIdx: number;
}

// --- matching de texto ------------------------------------------------------

/**
 * Un valor de la ficha matchea un texto del PDF si CADA token del valor tiene un
 * token del texto con el mismo prefijo de 5 caracteres. La ficha dice "Jurídico
 * Nacional" y el PDF "Jurídica Nacional": por prefijo matchea, por igualdad no.
 */
export function valorMatcheaTexto(valor: string, texto: string): boolean {
  const tv = slug(valor).split('_').filter((t) => t.length >= 3);
  if (tv.length === 0) return false;
  const tt = slug(texto).split('_').filter(Boolean);
  if (tt.length === 0) return false;
  // La etiqueta de una opción es un texto CORTO y suelto al lado de la casilla.
  // Sin este tope, el valor "Física" matchea la prosa "- Cuando no aplique una
  // sección (persona física o persona jurídica), debe trazarse una línea…" y
  // aparece una banda fantasma que rompe el conteo de instancias.
  if (tt.length > tv.length + 2) return false;
  return tv.every((v) => tt.some((t) => (v.length <= 5 ? t === v : t.slice(0, 5) === v.slice(0, 5))));
}

/** Valores demasiado cortos ("NO", "SI") generan ruido: no sirven como ancla. */
function valorUtil(valor: string): boolean {
  return slug(valor).replace(/_/g, '').length >= 4;
}

/** Ordena (page, -y): el mismo criterio que el orden de lectura. */
function cmpBanda(a: { page: number; y: number }, b: { page: number; y: number }): number {
  if (a.page !== b.page) return a.page - b.page;
  return b.y - a.y;
}

/** Índice del leaf más cercano a un punto (misma página, menor |Δy|). */
export function leafMasCercano(leaves: PdfLeaf[], page: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  leaves.forEach((l, i) => {
    if (l.page !== page) return;
    const cy = l.rect.y + l.rect.h / 2;
    const d = Math.abs(cy - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Agrupa los matches de un grupo de opciones en bandas horizontales.
 * Dos matches están en la misma banda si comparten página y su Y difiere menos
 * que `tolerancia` (las casillas de una misma fila no están perfectamente
 * alineadas: en el CSC varían hasta 2pt).
 */
export function bandasDeGrupo(
  grupo: GrupoOpciones,
  texto: TextItem[],
  tolerancia = 6,
  /** filas del MISMO grupo más cerca que esto se fusionan en una sola banda */
  separacionMaxFilas = 40,
): { page: number; y: number; valores: string[] }[] {
  const hits: { page: number; y: number; valor: string }[] = [];
  for (const valor of grupo.valores) {
    if (!valorUtil(valor)) continue;
    for (const it of texto) {
      if (it.rotado) continue; // las etiquetas laterales no son opciones
      if (!valorMatcheaTexto(valor, it.str)) continue;
      hits.push({ page: it.page, y: it.y, valor });
    }
  }
  hits.sort(cmpBanda);

  const bandas: { page: number; y: number; valores: string[] }[] = [];
  for (const h of hits) {
    const ultima = bandas[bandas.length - 1];
    if (ultima && ultima.page === h.page && Math.abs(ultima.y - h.y) <= tolerancia) {
      if (!ultima.valores.includes(h.valor)) ultima.valores.push(h.valor);
      continue;
    }
    bandas.push({ page: h.page, y: h.y, valores: [h.valor] });
  }

  // Un grupo con muchas opciones se dibuja en VARIAS filas: en el CSC el
  // "Origen de los fondos" de la persona jurídica ocupa y=219 e y=201. Son una
  // sola aparición del grupo, no dos instancias, así que las filas contiguas se
  // fusionan. Sin esto el conteo de bandas miente y siembra regiones absurdas.
  const fusionadas: { page: number; y: number; valores: string[] }[] = [];
  for (const b of bandas) {
    const u = fusionadas[fusionadas.length - 1];
    if (u && u.page === b.page && Math.abs(u.y - b.y) <= separacionMaxFilas) {
      for (const v of b.valores) if (!u.valores.includes(v)) u.valores.push(v);
      continue;
    }
    fusionadas.push({ ...b, valores: [...b.valores] });
  }
  return fusionadas;
}

/**
 * Salto vertical entre dos campos consecutivos del orden de lectura.
 * Un cambio de página es un salto infinito: siempre corta.
 */
export function saltoEntre(a: PdfLeaf, b: PdfLeaf): number {
  if (a.page !== b.page) return Infinity;
  return a.rect.y - (b.rect.y + b.rect.h);
}

/**
 * Busca el corte en `[desde, hasta)`: el índice j tal que el salto entre
 * leaves[j-1] y leaves[j] es el mayor de la zona. Si la zona es vacía devuelve
 * `hasta`.
 */
export function cortePorMayorSalto(leaves: PdfLeaf[], desde: number, hasta: number): number {
  let mejor = hasta;
  let mejorSalto = -Infinity;
  for (let j = Math.max(desde, 1); j <= hasta; j++) {
    if (j - 1 < 0 || j >= leaves.length) continue;
    const s = saltoEntre(leaves[j - 1], leaves[j]);
    if (s > mejorSalto) {
      mejorSalto = s;
      mejor = j;
    }
  }
  return mejor;
}

/**
 * Siembra una región por instancia activa. `instancias` viene en el orden en
 * que las declara la ficha, que es el orden del documento.
 */
export function sembrarRegiones(
  leaves: PdfLeaf[],
  texto: TextItem[],
  instancias: { codigo: string }[],
  grupos: GrupoOpciones[],
): SiembraResult {
  const avisos: string[] = [];
  const bandasOut: BandaOpciones[] = [];
  const n = instancias.length;
  if (n === 0 || leaves.length === 0) return { regiones: [], bandas: [], avisos };
  if (n === 1) {
    return {
      regiones: [
        {
          codigo: instancias[0].codigo,
          desdeLeaf: 0,
          hastaLeaf: leaves.length - 1,
          origen: 'resto',
          detalle: 'una sola instancia: la región es todo el PDF',
        },
      ],
      bandas: [],
      avisos,
    };
  }

  // 1) grupos utilizables: los que aparecen exactamente `n` veces.
  const puntosPorInstancia: { page: number; y: number }[][] = Array.from({ length: n }, () => []);
  let usados = 0;
  for (const g of grupos) {
    const bandas = bandasDeGrupo(g, texto);
    if (bandas.length !== n) {
      if (bandas.length > 0) {
        avisos.push(
          `El grupo «${g.label}» aparece ${bandas.length} vez(ces) en el PDF y hay ${n} instancias: no se usa como ancla.`,
        );
      }
      continue;
    }
    usados++;
    avisos.push(
      `El grupo «${g.label}» ancla las ${n} instancias: ` +
        bandas.map((b) => `p${b.page + 1} y=${Math.round(b.y)} [${b.valores.join(', ')}]`).join(' · '),
    );
    bandas.forEach((b, k) => {
      puntosPorInstancia[k].push({ page: b.page, y: b.y });
      bandasOut.push({
        label: g.label,
        page: b.page,
        y: b.y,
        valores: b.valores,
        leafIdx: leafMasCercano(leaves, b.page, b.y),
      });
    });
  }

  if (usados === 0) {
    avisos.push(
      'Ningún grupo de opciones aparece tantas veces como instancias: no se pudo sembrar ninguna región. ' +
        'Definí el primer y último campo de cada instancia a mano.',
    );
    return { regiones: [], bandas: bandasOut, avisos };
  }

  // 2) span de cada instancia en índices de leaf.
  const spans = puntosPorInstancia.map((puntos, k) => {
    const idxs = puntos.map((p) => leafMasCercano(leaves, p.page, p.y)).filter((i) => i >= 0);
    return { k, min: Math.min(...idxs), max: Math.max(...idxs) };
  });
  if (spans.some((s) => !Number.isFinite(s.min))) {
    avisos.push('Alguna instancia no pudo anclarse a ningún campo del PDF.');
    return { regiones: [], bandas: bandasOut, avisos };
  }
  spans.sort((a, b) => a.min - b.min);

  // 3) cortes por mayor salto vertical en la zona ambigua.
  const regiones: Region[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const prev = spans[i - 1];
    const next = spans[i + 1];
    const desde = i === 0 ? cortePorMayorSalto(leaves, 1, s.min) : cortePorMayorSalto(leaves, prev.max + 1, s.min);
    const hasta = next ? cortePorMayorSalto(leaves, s.max + 1, next.min) - 1 : leaves.length - 1;
    regiones.push({
      codigo: instancias[s.k].codigo,
      desdeLeaf: desde,
      hastaLeaf: Math.max(desde, hasta),
      origen: 'opciones',
      detalle: `anclada por ${usados} grupo(s) de opciones; borde por mayor salto vertical`,
    });
  }

  // 4) la última región termina donde arranca el bloque final libre.
  const ultima = regiones[regiones.length - 1];
  const spanUltima = spans[spans.length - 1];
  if (ultima && spanUltima.max + 1 <= leaves.length - 1) {
    const corte = cortePorMayorSalto(leaves, spanUltima.max + 1, leaves.length - 1);
    ultima.hastaLeaf = Math.max(spanUltima.max, corte - 1);
  }

  return { regiones, bandas: bandasOut, avisos };
}

// --- extracción del texto (pdfjs) ------------------------------------------

/**
 * Mapea un item de `getTextContent()` de pdfjs a `TextItem`.
 * La matriz es `[a, b, c, d, e, f]`: `e`/`f` son x/y y `b`≠0 significa que el
 * texto está rotado (las etiquetas laterales del CSC salen con `[0,8,-8,0,…]`).
 */
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

/** Extrae todo el texto del PDF. `pdfjs-dist` se carga lazy. */
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

// --- presentación -----------------------------------------------------------

/** Un color estable por índice de región, para las bandas del preview. */
const TONOS_REGION = [
  [37, 99, 235], // azul
  [219, 39, 119], // rosa
  [13, 148, 136], // teal
  [217, 119, 6], // ámbar
  [124, 58, 237], // violeta
];

export function colorRegion(i: number, alpha: number): string {
  const [r, g, b] = TONOS_REGION[i % TONOS_REGION.length];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
