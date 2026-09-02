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
import type { Segmento } from './align';
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
export interface OpcionesMatch {
  /** fracción mínima de tokens del valor que tienen que aparecer (1 = todos) */
  cobertura?: number;
  /** tokens extra tolerados en el texto respecto del valor; `null` = sin tope */
  maxExtra?: number | null;
}

export function valorMatcheaTexto(valor: string, texto: string, opts: OpcionesMatch = {}): boolean {
  const cobertura = opts.cobertura ?? 1;
  const maxExtra = opts.maxExtra === undefined ? 2 : opts.maxExtra;
  const tv = slug(valor).split('_').filter((t) => t.length >= 3);
  if (tv.length === 0) return false;
  const tt = slug(texto).split('_').filter(Boolean);
  if (tt.length === 0) return false;
  // La etiqueta de una opción es un texto CORTO y suelto al lado de la casilla.
  // Sin este tope, el valor "Física" matchea la prosa "- Cuando no aplique una
  // sección (persona física o persona jurídica), debe trazarse una línea…" y
  // aparece una banda fantasma que rompe el conteo de instancias.
  if (maxExtra != null && tt.length > tv.length + maxExtra) return false;
  const hits = tv.filter((v) => tt.some((t) => (v.length <= 5 ? t === v : t.slice(0, 5) === v.slice(0, 5)))).length;
  return hits / tv.length >= cobertura - 1e-9;
}

/**
 * ¿La clave de una fila aparece impresa en alguno de estos fragmentos?
 *
 * Para claves LARGAS el match es por cobertura parcial y sin tope de longitud,
 * porque pdfjs parte los textos largos: en el CSC la pregunta «¿Algún socio o
 * beneficiario de la empresa desempeña…?» sale en dos fragmentos
 * («…cargo político destacado (» + «), en territorio nacional…»), y el modo
 * estricto la rechazaba entera. Para claves cortas se mantiene el modo estricto:
 * ahí la cobertura parcial sería puro ruido.
 */
export const MIN_TOKENS_LAXO = 5;

export function claveApareceEnTexto(clave: string, textos: TextItem[]): boolean {
  const tv = slug(clave).split('_').filter((t) => t.length >= 3);
  if (tv.length === 0) return false;
  // La cobertura parcial es SOLO para etiquetas largas, las que pdfjs parte. En
  // una clave corta cada token carga significado y aflojar miente: «País y lugar
  // de constitución» tiene 3 tokens y con cobertura 0,6 matcheaba el impreso
  // «País y lugar de nacimiento» (2 de 3), lo que la dejaba elegible en las tres
  // regiones y devolvía el bug original en RPL.
  const opts: OpcionesMatch = tv.length < MIN_TOKENS_LAXO ? {} : { cobertura: 0.6, maxExtra: null };
  return textos.some((t) => !t.rotado && valorMatcheaTexto(clave, t.str, opts));
}

/** Valores demasiado cortos ("NO", "SI") generan ruido: no sirven como ancla. */
export function valorUtil(valor: string): boolean {
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

// ---------------------------------------------------------------------------
// Anclas por texto dentro de la región (Fix C de v1.4.1).
//
// EL PROBLEMA. Dentro de una región el orden de la ficha y el del PDF TAMBIÉN
// difieren. En el CSC la ficha lista `Tipo de Identificación (×8) → N° de
// Identificación → Correo → 1er Apellido → 2do Apellido → Nombre`, mientras el
// PDF pinta `1er Apellido → 2do Apellido → Nombre → N° Identificación → las 8
// casillas de tipo-id → … → Correo (#44)`. Un DP secuencial no puede reordenar:
// terminaba dejando los apellidos huérfanos y poniendo
// `asg_tipo_de_identificacion_institucion_autonoma` sobre la casilla "Pasaporte".
//
// LA SOLUCIÓN. El PDF trae la ETIQUETA IMPRESA al lado de cada campo, y la col C
// de la ficha es justamente esa etiqueta (col F para las opciones de un grupo).
// Se buscan los pares (fila, campo) cuya etiqueta coincide, se conservan solo los
// INEQUÍVOCOS (una fila ↔ un campo dentro de la región) y MONÓTONOS, y esos
// quedan como anclas fijas. El DP alinea únicamente los huecos entre anclas.
//
// Por qué solo los inequívocos: en el CSC "Detalle:" aparece 6 veces y
// "Nacional" 7. Un match ambiguo no es evidencia, así que se descarta y esa zona
// la resuelve la posición, como antes.
// ---------------------------------------------------------------------------

/** Distancia horizontal máxima entre una etiqueta y su campo. */
const MAX_DIST_ETIQUETA = 90;

export interface EtiquetaLeaf {
  /** texto pegado a la izquierda, en la misma línea */
  izq: string;
  /** texto pegado a la derecha, en la misma línea */
  der: string;
}

/**
 * Etiquetas candidatas de un campo. Los campos de texto llevan el rótulo a la
 * IZQUIERDA ("1er Apellido:" y después la caja); las casillas lo llevan a la
 * DERECHA ("☐ Cédula ☐ DIMEX"). Se devuelven las dos y decide quien las use.
 */
export function etiquetasDeLeaf(leaf: PdfLeaf, texto: TextItem[]): EtiquetaLeaf {
  const cy = leaf.rect.y + leaf.rect.h / 2;
  const buscar = (tol: number): EtiquetaLeaf => {
    const enLinea = texto.filter((t) => !t.rotado && t.page === leaf.page && Math.abs(t.y + 3 - cy) <= tol);
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
  // A.3: si en su propia línea no hay candidato, mirar la de arriba y la de
  // abajo. En el CSC `Lugar de Constitución.0.1` (p1 y=127) cae ENTRE dos filas
  // del formulario y su rótulo no está en su línea; se repite en formularios
  // densos, así que vale ampliar la ventana antes de darlo por huérfano.
  return buscar(22);
}

/**
 * La etiqueta que corresponde al tipo de campo, y SOLO esa.
 * Una casilla lleva el rótulo a la derecha ("☐ Cédula ☐ DIMEX"); una caja de
 * texto, a la izquierda ("1er Apellido: [___]"). Mirar los dos lados parece más
 * generoso pero genera cruces: el valor "DIDI" matchea la casilla de DIDI por
 * derecha y la de Pasaporte por izquierda, las dos quedan ambiguas y se
 * descartan. El otro lado solo se usa si el preferido está vacío.
 */
export function etiquetaPreferida(leaf: PdfLeaf, e: EtiquetaLeaf): string[] {
  const [primero, segundo] = leaf.ft === '/Btn' ? [e.der, e.izq] : [e.izq, e.der];
  return primero ? [primero] : segundo ? [segundo] : [];
}

export interface Ancla {
  /** índice GLOBAL de fila */
  filaIdx: number;
  /** índice GLOBAL de campo */
  leafIdx: number;
  motivo: string;
}

export interface AnclasResult {
  anclas: Ancla[];
  /**
   * Opciones de un grupo que NO pertenecen a esta región: el grupo tiene anclas
   * acá pero el valor de esta fila no aparece en ninguna etiqueta de la región.
   *
   * OJO: desde v1.4.3 el filtro de `elegibilidadPorRegion` hace este trabajo
   * mejor —mira TODO el texto de la región, no solo las etiquetas pegadas a los
   * widgets— y sabe distinguir "vive en otra región" de "se llama distinto en el
   * PDF". Esta lista NO se usa cuando hay elegibilidad calculada: marcaba como
   * ajena a la opción «Física», que sí es de ASG pero está impresa como
   * «Cédula», y la dejaba huérfana junto con su casilla.
   */
  opcionesForaneas: number[];
}

/** Lo que la búsqueda de anclas necesita saber de una fila. */
export interface FilaAncla {
  /** índice global */
  idx: number;
  /** col C (nombre en PDF) */
  nombrePdf: string;
  /** col F (valor) — es la etiqueta cuando la fila es una opción de un grupo */
  valor: string;
  /** true si la fila pertenece a un grupo de opciones */
  esOpcion: boolean;
  /** identificador del grupo de opciones (el label); '' si no es opción */
  grupo: string;
}

/**
 * Cuán específico es el match entre una clave y una etiqueta: fracción de
 * tokens compartidos sobre el mayor de los dos conjuntos. «Ingresos Propios»
 * contra "Ingresos propios" da 1; «Sin Ingresos propios» contra lo mismo da
 * 0,67. Así el par exacto le gana al que solo lo contiene.
 */
export function especificidad(clave: string, etiqueta: string): number {
  const a = slug(clave).split('_').filter((t) => t.length >= 3);
  const b = slug(etiqueta).split('_').filter((t) => t.length >= 3);
  if (a.length === 0 || b.length === 0) return 0;
  const comunes = a.filter((t) => b.some((u) => u.slice(0, 5) === t.slice(0, 5))).length;
  return comunes / Math.max(a.length, b.length);
}

/** Subsecuencia creciente más larga por `leafIdx` (las anclas deben ser monótonas). */
export function mayorSubsecuenciaMonotona(pares: Ancla[]): Ancla[] {
  if (pares.length === 0) return [];
  const orden = [...pares].sort((a, b) => a.filaIdx - b.filaIdx || a.leafIdx - b.leafIdx);
  const largo = new Array(orden.length).fill(1);
  const prev = new Array(orden.length).fill(-1);
  let mejor = 0;
  for (let i = 0; i < orden.length; i++) {
    for (let j = 0; j < i; j++) {
      if (orden[j].leafIdx < orden[i].leafIdx && largo[j] + 1 > largo[i]) {
        largo[i] = largo[j] + 1;
        prev[i] = j;
      }
    }
    if (largo[i] > largo[mejor]) mejor = i;
  }
  const out: Ancla[] = [];
  for (let i = mejor; i >= 0; i = prev[i]) out.push(orden[i]);
  return out.reverse();
}

/**
 * Anclas de un tramo: pares (fila, campo) cuya etiqueta impresa coincide de
 * forma inequívoca. `filas` y `leafIdxs` son los de ESE tramo únicamente.
 */
export function anclasDeTexto(
  filas: FilaAncla[],
  leaves: PdfLeaf[],
  leafIdxs: number[],
  texto: TextItem[],
  /**
   * Exigir que las anclas no se cruzen. Por defecto NO, y es a propósito: el
   * desorden entre ficha y PDF dentro del bloque no es monótono, así que pedir
   * monotonía descarta justamente las anclas que arreglan el reordenamiento. En
   * el CSC, exigirla tiraba las 5 casillas de tipo-id y las dejaba huérfanas.
   */
  monotonas = false,
): AnclasResult {
  // 1) etiquetas de cada campo del tramo
  const etiquetas = new Map<number, string[]>();
  for (const j of leafIdxs) {
    const l = leaves[j];
    if (!l) continue;
    etiquetas.set(j, etiquetaPreferida(l, etiquetasDeLeaf(l, texto)).filter(Boolean));
  }

  // 2) todos los matches posibles
  const porFila = new Map<number, number[]>();
  const porLeaf = new Map<number, number[]>();
  const opcionesEvaluadas: number[] = [];
  for (const f of filas) {
    // Una opción se identifica por su VALOR (col F); el resto por su col C.
    const clave = f.esOpcion ? f.valor : f.nombrePdf;
    if (slug(clave).replace(/_/g, '').length < 4) continue;
    if (f.esOpcion) opcionesEvaluadas.push(f.idx);
    for (const j of leafIdxs) {
      const etqs = etiquetas.get(j) ?? [];
      if (!etqs.some((e) => valorMatcheaTexto(clave, e))) continue;
      if (!porFila.has(f.idx)) porFila.set(f.idx, []);
      porFila.get(f.idx)!.push(j);
      if (!porLeaf.has(j)) porLeaf.set(j, []);
      porLeaf.get(j)!.push(f.idx);
    }
  }

  // 3) Resolución por ESPECIFICIDAD. Antes se exigía unicidad mutua estricta y
  //    eso tiraba pares buenos: la etiqueta "Ingresos propios" matchea tanto la
  //    fila «Ingresos Propios» como «Sin Ingresos propios», así que las dos
  //    quedaban ambiguas y ninguna anclaba. Ahora gana la más específica y solo
  //    se descarta el empate real.
  const pares: { filaIdx: number; leafIdx: number; esp: number }[] = [];
  for (const [filaIdx, js] of porFila) {
    for (const j of js) {
      const f = filas.find((x) => x.idx === filaIdx)!;
      const clave = f.esOpcion ? f.valor : f.nombrePdf;
      let mejor = 0;
      for (const e of etiquetas.get(j) ?? []) mejor = Math.max(mejor, especificidad(clave, e));
      pares.push({ filaIdx, leafIdx: j, esp: mejor });
    }
  }
  pares.sort((a, b) => b.esp - a.esp);

  const filasTomadas = new Set<number>();
  const leavesTomados = new Set<number>();
  const candidatas: Ancla[] = [];
  for (let k = 0; k < pares.length; k++) {
    const p = pares[k];
    if (filasTomadas.has(p.filaIdx) || leavesTomados.has(p.leafIdx)) continue;
    // Empate real para el mismo campo: no hay evidencia, se descarta.
    const empate = pares.some(
      (q, qi) =>
        qi !== k &&
        q.leafIdx === p.leafIdx &&
        q.esp === p.esp &&
        !filasTomadas.has(q.filaIdx) &&
        q.filaIdx !== p.filaIdx,
    );
    if (empate) continue;
    filasTomadas.add(p.filaIdx);
    leavesTomados.add(p.leafIdx);
    const f = filas.find((x) => x.idx === p.filaIdx)!;
    candidatas.push({
      filaIdx: p.filaIdx,
      leafIdx: p.leafIdx,
      motivo: `la etiqueta impresa del PDF coincide con ${f.esOpcion ? 'el valor (col F)' : 'el nombre (col C)'}`,
    });
  }

  // 4) el cruce entre anclas es legítimo (los órdenes difieren de verdad), así
  //    que solo se filtra si el llamador lo pide.
  const anclas = monotonas ? mayorSubsecuenciaMonotona(candidatas) : candidatas;

  // 5) grupos partidos entre regiones: si alguna opción del grupo se ancló acá,
  //    las etiquetas del grupo son legibles en esta región; entonces una opción
  //    sin NINGÚN match de etiqueta simplemente no vive acá.
  const gruposConAncla = new Set(
    anclas
      .map((a) => filas.find((f) => f.idx === a.filaIdx))
      .filter((f): f is FilaAncla => !!f && f.esOpcion)
      .map((f) => f.grupo),
  );
  const opcionesForaneas = opcionesEvaluadas.filter((idx) => {
    const f = filas.find((x) => x.idx === idx)!;
    if (!gruposConAncla.has(f.grupo)) return false;
    return (porFila.get(idx) ?? []).length === 0;
  });

  return { anclas, opcionesForaneas };
}

// ---------------------------------------------------------------------------
// Construcción de segmentos.
//
// Se centraliza acá para que la UI y los tests usen exactamente la misma lógica.
//
// Los tramos LIBRES (los que no caen en ninguna región) no son un solo segmento:
// son zonas contiguas separadas. En el CSC el tramo libre son el campo del tope
// de la página 1 y los dos del pie de la página 2 (el bloque de firmas). Metidos
// en un solo segmento, las filas "Lugar" y "Fecha: día/mes/año" de la ficha se
// iban a los campos de la firma. Cada corrida contigua es su propio segmento, y
// las filas libres se reparten por su posición respecto del bloque repetible.
// ---------------------------------------------------------------------------

export interface FilaSegmentable {
  /** código de instancia; null si la fila no pertenece al bloque repetible */
  codigo: string | null;
  /**
   * Regiones donde la fila es elegible. `null`/ausente = elegible en todas (es
   * el caso de las filas sin match, el hueco de vocabulario). Si está y no
   * incluye el código de la región, la fila NO se le ofrece a esa instancia.
   */
  elegibleEn?: string[] | null;
}

/** Corridas de índices consecutivos dentro de un conjunto. */
export function corridasContiguas(idxs: number[]): number[][] {
  const orden = [...idxs].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const i of orden) {
    const ultima = out[out.length - 1];
    if (ultima && i === ultima[ultima.length - 1] + 1) ultima.push(i);
    else out.push([i]);
  }
  return out;
}

export function construirSegmentos(
  totalLeaves: number,
  regiones: Region[],
  filas: FilaSegmentable[],
): Segmento[] {
  const porCodigo = new Map<string, number[]>();
  filas.forEach((f, k) => {
    const c = f.codigo ?? '';
    if (!c) return;
    if (!porCodigo.has(c)) porCodigo.set(c, []);
    porCodigo.get(c)!.push(k);
  });

  const usados = new Set<number>();
  const out: Segmento[] = [];
  for (const r of regiones) {
    const leafIdxs: number[] = [];
    for (let j = Math.max(0, r.desdeLeaf); j <= Math.min(totalLeaves - 1, r.hastaLeaf); j++) {
      if (usados.has(j)) continue; // dos regiones no comparten un campo
      leafIdxs.push(j);
      usados.add(j);
    }
    // Solo las filas elegibles en ESTA región compiten por sus campos.
    const filaIdxs = (porCodigo.get(r.codigo) ?? []).filter((k) => {
      const e = filas[k].elegibleEn;
      return e == null || e.includes(r.codigo);
    });
    out.push({ etiqueta: r.codigo, filaIdxs, leafIdxs });
  }

  // Filas libres, partidas por su posición respecto del bloque repetible.
  const idxBloque = filas.map((f, k) => (f.codigo ? k : -1)).filter((k) => k >= 0);
  const primeroBloque = idxBloque.length ? Math.min(...idxBloque) : Infinity;
  const ultimoBloque = idxBloque.length ? Math.max(...idxBloque) : -1;
  const libresAntes: number[] = [];
  const libresDespues: number[] = [];
  filas.forEach((f, k) => {
    if (f.codigo) return;
    if (k < primeroBloque) libresAntes.push(k);
    else if (k > ultimoBloque) libresDespues.push(k);
    else libresAntes.push(k); // sin bloque: todo va al primer tramo
  });

  const libres = Array.from({ length: totalLeaves }, (_, j) => j).filter((j) => !usados.has(j));
  const corridas = corridasContiguas(libres);
  const primeraRegion = out.find((s) => s.leafIdxs.length > 0);
  const inicioRegiones = primeraRegion ? primeraRegion.leafIdxs[0] : totalLeaves;
  corridas.forEach((corrida, i) => {
    const antes = corrida[corrida.length - 1] < inicioRegiones;
    out.push({
      etiqueta: `libre-${antes ? 'antes' : 'despues'}${corridas.length > 1 ? `-${i + 1}` : ''}`,
      filaIdxs: antes ? libresAntes : libresDespues,
      leafIdxs: corrida,
    });
  });

  // Una fila libre no puede competir en dos tramos a la vez: se deja solo en el
  // primero que la reclame.
  const yaVista = new Set<number>();
  for (const seg of out) {
    if (!seg.etiqueta.startsWith('libre')) continue;
    seg.filaIdxs = seg.filaIdxs.filter((i) => !yaVista.has(i));
    for (const i of seg.filaIdxs) yaVista.add(i);
  }
  return out;
}

// --- evidencia en contra ----------------------------------------------------

/**
 * ¿Dos labels de grupo son el mismo? Se acepta la contención porque pueden
 * venir de columnas distintas de la ficha ("Tipo de Identificación" vs "Tipo de
 * Identificación Persona").
 */
export function mismoGrupo(a: string, b: string): boolean {
  const sa = slug(a);
  const sb = slug(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.startsWith(sb) || sb.startsWith(sa);
}

/** ¿El campo `j` cae dentro de la banda de algún grupo de opciones? */
export function bandaDeLeaf(leaf: PdfLeaf, bandas: BandaOpciones[], tolerancia = 10): BandaOpciones | null {
  const cy = leaf.rect.y + leaf.rect.h / 2;
  for (const b of bandas) {
    if (b.page !== leaf.page) continue;
    if (Math.abs(b.y + 3 - cy) <= tolerancia) return b;
  }
  return null;
}

export interface EntradaEvidencia {
  leaves: PdfLeaf[];
  texto: TextItem[];
  bandas: BandaOpciones[];
  /** clave identificatoria de la fila: col F si es opción, col C si no */
  claveDeFila: (filaIdx: number) => string;
  /** label del grupo de la fila; '' si no es opción */
  grupoDeFila: (filaIdx: number) => string;
  /** filas que compiten en el mismo segmento que `filaIdx` */
  filasDelSegmento: (filaIdx: number) => number[];
}

/**
 * Evidencia PRECISA de que el par está mal: la etiqueta impresa del campo
 * identifica a otra fila del mismo segmento. Sabemos de quién es ese campo, y no
 * es de esta fila.
 *
 * Es la única que se usa como PENALIDAD dentro del DP (v1.4.3 A.2). La señal de
 * banda es más gruesa: sirve para bajar la confianza a posteriori, pero como
 * penalidad dura dejaba sin asignar campos que estaban bien —medido: 24
 * huérfanos del PDF contra 3— y un campo sin asignar de más no compensa.
 */
export function evidenciaFuerte(e: EntradaEvidencia, filaIdx: number, leafIdx: number): string | null {
  const leaf = e.leaves[leafIdx];
  if (!leaf) return null;
  const etq = etiquetaPreferida(leaf, etiquetasDeLeaf(leaf, e.texto))[0] ?? '';
  if (!etq) return null;
  const propia = e.claveDeFila(filaIdx);
  if (valorMatcheaTexto(propia, etq)) return null;
  const otra = e.filasDelSegmento(filaIdx).find((i) => i !== filaIdx && valorMatcheaTexto(e.claveDeFila(i), etq));
  return otra === undefined ? null : `la etiqueta impresa «${etq}» corresponde a otra fila de la ficha`;
}

/**
 * Evidencia POSITIVA de que un par (fila, campo) está mal. Dos señales:
 *
 *  a) la etiqueta impresa del campo identifica a OTRA fila del mismo segmento:
 *     sabemos de quién es ese campo, y no es de esta fila.
 *  b) el campo cae dentro de la banda de un grupo de opciones y la fila no
 *     pertenece a ese grupo: en el CSC eso agarra la fila de la pregunta PEP
 *     puesta encima de la casilla "Cédula" del tipo de identificación.
 *
 * Un simple "la etiqueta no coincide" NO alcanza: la ficha dice "Física" donde
 * el PDF imprime "Cédula", y eso es un hueco de vocabulario, no un error.
 */
export function evidenciaEnContra(e: EntradaEvidencia, filaIdx: number, leafIdx: number): string | null {
  const fuerte = evidenciaFuerte(e, filaIdx, leafIdx);
  if (fuerte) return fuerte;
  const leaf = e.leaves[leafIdx];
  if (!leaf) return null;

  // (b) el campo pertenece a la banda de otro grupo de opciones.
  //     Solo para CASILLAS: una caja de texto puede compartir la fila con las
  //     casillas sin ser del grupo (en el CSC el "Nº de Identificación" del
  //     representante está a 10pt de la banda de tipo-id y es legítimo).
  const banda = leaf.ft === '/Btn' ? bandaDeLeaf(leaf, e.bandas) : null;
  if (banda) {
    const grupo = e.grupoDeFila(filaIdx);
    // La comparación es por CONTENCIÓN, no por igualdad: el label de la banda y
    // el de la fila pueden venir de columnas distintas de la ficha y no ser
    // idénticos. En el CSC la banda dice "Tipo de Identificación Persona"
    // (col D) y la fila "Tipo de Identificación" (col C). Exigir igualdad
    // marcaba como ajena a TODA fila del grupo, y con la penalidad de A.2 eso
    // pasó de bajar la confianza a impedir la asignación.
    if (!mismoGrupo(banda.label, grupo)) {
      return `el campo está en la banda del grupo «${banda.label}» y esta fila no pertenece a ese grupo`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Elegibilidad de filas por región (Parte A de v1.4.3).
//
// EL PROBLEMA. El bloque `personas` es genérico y se expande una vez por
// instancia, así que ASG recibe las 59 filas, incluidas las que solo aplican a
// Persona Jurídica. Y el DP prefiere asignar antes que dejar huérfanos: rellena
// los huecos con lo que tenga a mano. Resultado en el CSC:
// `asg_pais_y_lugar_de_constitucion` sobre "Estado Civil",
// `asg_fecha_de_constitucion` sobre "Origen de los fondos".
//
// Acotar la GEOMETRÍA (las regiones) no alcanza: limita dónde puede caer una
// fila, no impide que el DP la meta igual dentro de esa región.
//
// LA SOLUCIÓN. Una fila solo se le ofrece a una instancia si su clave aparece
// IMPRESA dentro de la región de esa instancia. Medido sobre el CSC: de las 59
// filas del bloque, 27 quedan exclusivas de una región, 22 siguen elegibles en
// varias y 10 no matchean en ninguna.
//
// Las que no matchean en ninguna NO se eliminan: quedan elegibles en todas. Es
// el hueco de vocabulario —la ficha dice «Física» donde el PDF imprime
// «Cédula»— y perder campos por eso sería peor que el problema original.
// ---------------------------------------------------------------------------

/** Fragmentos de texto que caen dentro del rango vertical de una región. */
export function textoDeRegion(
  leaves: PdfLeaf[],
  region: Region,
  texto: TextItem[],
  margen = 14,
): TextItem[] {
  const ls = leaves.slice(region.desdeLeaf, region.hastaLeaf + 1);
  if (ls.length === 0) return [];
  const paginas = new Set(ls.map((l) => l.page));
  const min = Math.min(...ls.map((l) => l.rect.y));
  const max = Math.max(...ls.map((l) => l.rect.y + l.rect.h));
  return texto.filter((t) => !t.rotado && paginas.has(t.page) && t.y >= min - margen && t.y <= max + margen);
}

/** Lo que la elegibilidad necesita saber de una fila del bloque repetible. */
export interface FilaElegibilidad {
  /** identidad de la fila de ficha, SIN la instancia (`hoja|fila`) */
  clave: string;
  /** col C */
  nombrePdf: string;
  /** col F */
  valor: string;
  esOpcion: boolean;
}

export interface ElegibilidadResult {
  /** `hoja|fila` -> códigos de región donde la fila aparece impresa */
  porFila: Map<string, string[]>;
  /** claves que no aparecen en ninguna región: elegibles en todas */
  sinMatch: string[];
  /** claves exclusivas de una sola región */
  exclusivas: string[];
}

/**
 * Para cada fila del bloque, en qué regiones aparece impresa su clave.
 *
 * La clave es el VALOR (col F) cuando la fila es una opción y ese valor sirve
 * como señal; si no, la col C. Sin ese fallback, la pregunta «¿Algún socio o
 * beneficiario…?» —cuyas opciones valen «NO» y «SI»— no matchea en ninguna
 * región y sigue cayendo en ASG, que es uno de los cuatro errores del reporte.
 */
export function elegibilidadPorRegion(
  leaves: PdfLeaf[],
  regiones: Region[],
  texto: TextItem[],
  filas: FilaElegibilidad[],
): ElegibilidadResult {
  const textosPorRegion = new Map<string, TextItem[]>();
  for (const r of regiones) textosPorRegion.set(r.codigo, textoDeRegion(leaves, r, texto));

  const porFila = new Map<string, string[]>();
  const sinMatch: string[] = [];
  const exclusivas: string[] = [];
  const vistas = new Set<string>();

  for (const f of filas) {
    if (vistas.has(f.clave)) continue;
    vistas.add(f.clave);
    const claveTexto = f.esOpcion && valorUtil(f.valor) ? f.valor : f.nombrePdf;
    const donde = regiones
      .filter((r) => claveApareceEnTexto(claveTexto, textosPorRegion.get(r.codigo) ?? []))
      .map((r) => r.codigo);
    porFila.set(f.clave, donde);
    if (donde.length === 0) sinMatch.push(f.clave);
    else if (donde.length === 1) exclusivas.push(f.clave);
  }

  return { porFila, sinMatch, exclusivas };
}
