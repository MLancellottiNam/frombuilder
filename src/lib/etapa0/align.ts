// ---------------------------------------------------------------------------
// Etapa 0 — Pre-alineación ficha ↔ campos del PDF.
//
// Premisa: **los AcroNames mienten**. En el CSC `Profesión` es en realidad el
// "Detalle" del domicilio extranjero, `Distrito_2` es la dirección de la persona
// jurídica y `Lugar de Constitución.1.1.0` es la nacionalidad del representante
// legal. Por eso la señal confiable es la POSICIÓN (orden de lectura), y el
// texto del AcroName solo puede SUMAR confianza, nunca restarla.
//
// Algoritmo: alineación secuencial estilo diff (Needleman-Wunsch) con huecos
// tolerados, anclada por tipo, y un post-paso que absorbe campos contiguos para
// modelar la relación 1:N (una fila de ficha → varios campos del PDF).
// ---------------------------------------------------------------------------

import type { PdfLeaf, FieldType } from './pdfFields';
import { slug } from './acroName';
import { norm } from './fichaRaw';

export type Confianza = 'alta' | 'media' | 'revisar';

/** Lo mínimo que la alineación necesita de una fila de ficha. */
export interface FilaAlineable {
  /** texto de la col C (Nombre en PDF) */
  nombrePdf: string;
  /** col F (Valor) */
  valor: string;
  /** col E (Tipo de dato) */
  tipo: string;
  /** nombre propuesto en v1.2.0 (solo informativo acá) */
  nombrePropuesto: string;
}

export interface Asignacion {
  filaIdx: number;
  /** sufijo por caja en una relación 1:N; si falta se numera `_1.._n` */
  sufijos?: string[];
  /** 1..N campos del PDF (N>1 = relación 1:N, p.ej. fecha partida en día/mes/año) */
  leafIdx: number[];
  confianza: Confianza;
  motivos: string[];
  score: number;
}

export interface AlignResult {
  asignaciones: Asignacion[];
  /** índices de filas de ficha sin campo PDF */
  huerfanosFicha: number[];
  /** índices de campos PDF sin fila de ficha */
  huerfanosPdf: number[];
  stats: {
    filas: number;
    campos: number;
    asignadas: number;
    alta: number;
    media: number;
    revisar: number;
    pctAlta: number;
    relaciones1aN: number;
  };
}

/** Tipo de campo PDF esperado según la col E de la ficha. */
export function tipoEsperado(tipoFicha: string): FieldType | null {
  const t = norm(tipoFicha);
  if (!t) return null;
  if (/(combo|radio|casilla|check|opcion|seleccion|lista)/.test(t)) return '/Btn';
  if (/(texto|text|numero|numerico|number|fecha|date|monto|string)/.test(t)) return '/Tx';
  return null; // desconocido: no penaliza
}

function esFecha(tipoFicha: string): boolean {
  return /fecha|date/.test(norm(tipoFicha));
}

/** ¿El texto de la ficha aparece dentro del AcroName actual? Solo SUMA. */
function textoCoincide(fila: FilaAlineable, leaf: PdfLeaf): boolean {
  const nombre = slug(leaf.name);
  if (!nombre) return false;
  for (const candidato of [fila.nombrePdf, fila.valor]) {
    const s = slug(candidato);
    if (s.length < 4) continue; // evita falsos positivos con tokens cortos
    if (nombre.includes(s) || s.includes(nombre)) return true;
  }
  return false;
}

const MATCH_TIPO_OK = 2;
const MATCH_TIPO_MAL = -1; // baja la confianza, pero no lo prohíbe
const BOOST_TEXTO = 3;
const GAP = -1;

/**
 * Penalidad del pase por segmentos (v1.4.3 A.2). El sesgo se invierte a
 * propósito: asignar una fila a un campo cuya etiqueta IMPRESA le corresponde a
 * OTRA fila cuesta más que dejar el campo sin asignar. Un campo sin asignar es
 * visible y corregible; uno mal asignado con confianza alta es invisible y
 * termina en el PDF.
 *
 * Tiene que superar a `MATCH_TIPO_OK + BOOST_TEXTO` (=5) más el costo de los dos
 * huecos que evitaría, para que el hueco gane incluso contra un match que por
 * tipo y posición pintaba bien. Medido sobre el CSC: con penalidad 0 quedan 98
 * asignados de los cuales 9 en `revisar`; con 8, quedan 96 con solo 2 en
 * `revisar`. O sea convierte 7 asignaciones malas en 2 huecos visibles. Subirla
 * a 20 no cambia nada: ya está saturada.
 *
 * ABARATAR EL HUECO no hizo falta y se midió: con `GAP` en -0,25 en vez de -1 el
 * resultado empeora (16 huérfanos del PDF en vez de 15) sin ganar corrección,
 * porque con esta penalidad el hueco ya le gana solo a los pares penalizados.
 */
export const PENALIDAD_ETIQUETA = 8;

interface Puntaje {
  score: number;
  tipoOk: boolean;
  textoOk: boolean;
}

function puntuar(fila: FilaAlineable, leaf: PdfLeaf): Puntaje {
  const esperado = tipoEsperado(fila.tipo);
  const tipoOk = esperado == null ? true : esperado === leaf.ft;
  const textoOk = textoCoincide(fila, leaf);
  let score = tipoOk ? MATCH_TIPO_OK : MATCH_TIPO_MAL;
  if (textoOk) score += BOOST_TEXTO;
  return { score, tipoOk, textoOk };
}

/** ¿`b` viene pegado a la derecha de `a`? (cajas de una fecha partida) */
function pegadoALaDerecha(a: PdfLeaf, b: PdfLeaf): boolean {
  if (!mismaLinea(a, b)) return false;
  const gap = b.rect.x - (a.rect.x + a.rect.w);
  return gap >= -2 && gap <= 40;
}

/** ¿Dos campos están en la misma línea visual? (misma página, Y parecido) */
function mismaLinea(a: PdfLeaf, b: PdfLeaf): boolean {
  if (a.page !== b.page) return false;
  const ay = a.rect.y + a.rect.h / 2;
  const by = b.rect.y + b.rect.h / 2;
  return Math.abs(ay - by) <= Math.max(a.rect.h, b.rect.h);
}

/**
 * Alinea filas (orden hoja+fila, ya expandidas por instancia) contra campos del
 * PDF (orden de lectura), permitiendo huecos de los dos lados.
 */
export interface OpcionesAlinear {
  /** costo de dejar una fila o un campo sin asignar (negativo) */
  gap?: number;
  /** penalidad (positiva) cuando la etiqueta impresa contradice el par */
  penalidad?: number;
  /** índices LOCALES: ¿la etiqueta impresa del campo j contradice a la fila i? */
  contradice?: (i: number, j: number) => boolean;
}

export function alinear(filas: FilaAlineable[], leaves: PdfLeaf[], opts: OpcionesAlinear = {}): AlignResult {
  const n = filas.length;
  const m = leaves.length;
  const gap = opts.gap ?? GAP;
  const penalidad = opts.penalidad ?? 0;

  // --- DP: dp[i][j] = mejor score alineando filas[0..i) con leaves[0..j) ---
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)); // 1=match 2=gapFila 3=gapLeaf
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + gap;
    from[i][0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] + gap;
    from[0][j] = 3;
  }
  const cache: Puntaje[][] = Array.from({ length: n }, () => new Array(m) as Puntaje[]);
  // `run[i][j]` = cuántos campos consume la fila i-1 cuando termina en j-1.
  // >1 solo para filas de FECHA cuyas cajas están pegadas en la misma línea
  // (día/mes/año). Modelar el 1:N DENTRO del DP evita que el desbalance de
  // conteo desplace toda la alineación.
  const run: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(1));

  /** ¿leaves[a..b] forman una corrida contigua de la misma línea y tipo? */
  const corridaValida = (a: number, b: number): boolean => {
    for (let k = a; k < b; k++) {
      if (leaves[k].ft !== leaves[k + 1].ft) return false;
      if (!pegadoALaDerecha(leaves[k], leaves[k + 1])) return false;
    }
    return true;
  };

  for (let i = 1; i <= n; i++) {
    const maxRun = esFecha(filas[i - 1].tipo) ? 3 : 1;
    for (let j = 1; j <= m; j++) {
      const p = puntuar(filas[i - 1], leaves[j - 1]);
      cache[i - 1][j - 1] = p;
      const castigo = opts.contradice?.(i - 1, j - 1) ? penalidad : 0;

      let best = dp[i - 1][j - 1] + p.score - castigo;
      let dir = 1;
      let bestRun = 1;

      // corridas 1:N (solo fechas): la fila consume k campos contiguos
      for (let k = 2; k <= maxRun && j - k >= 0; k++) {
        const ini = j - k;
        if (!corridaValida(ini, j - 1)) break;
        const pIni = puntuar(filas[i - 1], leaves[ini]);
        // el 1er campo puntúa normal; cada caja extra suma poco, pero más que
        // el hueco que evitaría (GAP), para no sobre-absorber.
        const cand = dp[i - 1][ini] + pIni.score + (k - 1) - (opts.contradice?.(i - 1, ini) ? penalidad : 0);
        if (cand > best) {
          best = cand;
          dir = 1;
          bestRun = k;
        }
      }

      const gapFila = dp[i - 1][j] + gap;
      const gapLeaf = dp[i][j - 1] + gap;
      if (gapFila > best) {
        best = gapFila;
        dir = 2;
        bestRun = 1;
      }
      if (gapLeaf > best) {
        best = gapLeaf;
        dir = 3;
        bestRun = 1;
      }
      dp[i][j] = best;
      from[i][j] = dir;
      run[i][j] = bestRun;
    }
  }

  // --- traceback ---
  const pares: { i: number; j: number; k: number }[] = [];
  const huerfanosFicha: number[] = [];
  const huerfanosPdf: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = i === 0 ? 3 : j === 0 ? 2 : from[i][j];
    if (dir === 1) {
      const k = run[i][j] || 1;
      pares.push({ i: i - 1, j: j - k, k });
      i--;
      j -= k;
    } else if (dir === 2) {
      huerfanosFicha.push(i - 1);
      i--;
    } else {
      huerfanosPdf.push(j - 1);
      j--;
    }
  }
  pares.reverse();
  huerfanosFicha.reverse();
  huerfanosPdf.reverse();

  // --- 1:N: una fila de FECHA absorbe los campos contiguos de la misma línea
  //     que quedaron huérfanos (día / mes / año partidos en 3 cajas).
  const huerfanosPdfSet = new Set(huerfanosPdf);
  const asignaciones: Asignacion[] = pares.map((p) => ({
    filaIdx: p.i,
    leafIdx: Array.from({ length: p.k }, (_, t) => p.j + t),
    confianza: 'revisar' as Confianza,
    motivos: p.k > 1 ? ['1:N — campo de fecha partido en varias cajas contiguas'] : [],
    score: cache[p.i][p.j].score,
  }));
  for (const a of asignaciones) {
    const fila = filas[a.filaIdx];
    if (!esFecha(fila.tipo)) continue;
    let last = a.leafIdx[a.leafIdx.length - 1];
    while (
      huerfanosPdfSet.has(last + 1) &&
      leaves[last + 1] &&
      leaves[last].ft === leaves[last + 1].ft &&
      mismaLinea(leaves[last], leaves[last + 1]) &&
      a.leafIdx.length < 4
    ) {
      a.leafIdx.push(last + 1);
      huerfanosPdfSet.delete(last + 1);
      a.motivos.push('1:N — campo de fecha partido en varias cajas contiguas');
      last++;
    }
  }
  const huerfanosPdfFinal = huerfanosPdf.filter((x) => huerfanosPdfSet.has(x));

  // --- confianza ---
  //
  // "Anclado" = la asignación tiene un límite resuelto a los dos lados.
  //
  // Los EXTREMOS del tramo cuentan como anclados solo si el DP no salteó nada
  // ahí: si la primera asignación arranca en la fila 0 y el campo 0, está
  // pegada al borde del tramo, y ese borde es un límite CONOCIDO (una región, un
  // ancla de texto, el fin del documento), no un hueco sin resolver. Si en
  // cambio hubo un hueco, no está anclada.
  //
  // Antes el extremo contaba siempre como NO anclado, y eso penalizaba los
  // cortes que la segmentación introduce a propósito: subir la corrección hacía
  // BAJAR la confianza medida, que es exactamente lo que no tiene que pasar.
  const matchedFila = new Set(asignaciones.map((a) => a.filaIdx));
  asignaciones.forEach((a, idx) => {
    const p = cache[a.filaIdx][a.leafIdx[0]];
    const ultimoLeaf = a.leafIdx[a.leafIdx.length - 1];
    const vecinoPrev =
      idx > 0 ? matchedFila.has(asignaciones[idx - 1].filaIdx) : a.filaIdx === 0 && a.leafIdx[0] === 0;
    const vecinoNext =
      idx < asignaciones.length - 1
        ? matchedFila.has(asignaciones[idx + 1].filaIdx)
        : a.filaIdx === n - 1 && ultimoLeaf === m - 1;
    const anclado = vecinoPrev && vecinoNext;

    if (p.textoOk) a.motivos.unshift('el texto de la ficha aparece en el AcroName');
    if (!p.tipoOk) a.motivos.unshift(`desajuste de tipo: la ficha pide ${tipoEsperado(filas[a.filaIdx].tipo)}, el PDF trae ${leaves[a.leafIdx[0]].ft}`);
    if (anclado && p.tipoOk) {
      a.motivos.push(
        idx === 0 || idx === asignaciones.length - 1
          ? 'pegada al borde del tramo, sin huecos'
          : 'posición consistente entre vecinos alineados',
      );
    }

    if (!p.tipoOk) a.confianza = 'revisar';
    else if (p.textoOk || anclado) a.confianza = 'alta';
    else a.confianza = 'media';

    if (a.leafIdx.length > 1 && a.confianza === 'alta') a.confianza = 'media'; // 1:N se revisa
  });

  const alta = asignaciones.filter((a) => a.confianza === 'alta').length;
  const media = asignaciones.filter((a) => a.confianza === 'media').length;
  const revisar = asignaciones.filter((a) => a.confianza === 'revisar').length;

  return {
    asignaciones,
    huerfanosFicha,
    huerfanosPdf: huerfanosPdfFinal,
    stats: {
      filas: n,
      campos: m,
      asignadas: asignaciones.length,
      alta,
      media,
      revisar,
      pctAlta: asignaciones.length ? Math.round((alta / asignaciones.length) * 100) : 0,
      relaciones1aN: asignaciones.filter((a) => a.leafIdx.length > 1).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Alineación POR SEGMENTOS (Fix B de v1.4.1).
//
// Un pase global sobre 165 filas contra 111 campos deriva sin remedio. Con las
// regiones, cada instancia alinea sus propias filas contra sus propios campos y
// el límite no se cruza nunca: una fila sin campo en SU región queda huérfana en
// vez de robarle el campo a la instancia siguiente.
// ---------------------------------------------------------------------------

export interface Segmento {
  /** código de instancia, o 'libre' para los tramos fuera de toda región */
  etiqueta: string;
  /** índices GLOBALES de filas que pertenecen a este segmento */
  filaIdxs: number[];
  /** índices GLOBALES de campos del PDF que pertenecen a este segmento */
  leafIdxs: number[];
  /**
   * Pares (fila, campo) fijos, sacados de la etiqueta impresa del PDF. Parten el
   * segmento en tramos y el DP alinea solo los huecos. Sin esto el orden interno
   * del bloque —que en el CSC difiere entre ficha y PDF— desplaza todo.
   */
  anclas?: { filaIdx: number; leafIdxs: number[]; sufijos?: string[]; motivo: string }[];
  /**
   * Filas que NO deben competir por los campos de este segmento (opciones de un
   * grupo que vive en otra región). Van derecho a huérfanas de ficha.
   */
  excluirFilas?: number[];
}

export interface OpcionesPorSegmentos {
  /**
   * Devuelve el motivo por el que este par está mal, o null si no hay evidencia
   * en contra. Se usa en dos lugares: como PENALIDAD dentro del DP (v1.4.3 A.2,
   * así el par malo no se elige y el campo queda sin asignar, que es visible y
   * corregible) y como degradación a `revisar` de lo que igual se asignó.
   *
   * Solo debe devolver algo cuando la evidencia es POSITIVA (sabemos de quién es
   * ese campo, o sabemos que el campo pertenece a otro grupo). Un "la etiqueta
   * no coincide" genérico es ruido: castiga los huecos de vocabulario entre la
   * ficha y el PDF —la ficha dice "Física" donde el PDF imprime "Cédula"— sin
   * aportar información.
   */
  evidenciaEnContra?: (filaIdx: number, leafIdx: number) => string | null;
  /**
   * Evidencia PRECISA, la única que se usa como penalidad DENTRO del DP. Si no
   * se pasa, no se penaliza nada y el DP se comporta como antes.
   */
  evidenciaFuerte?: (filaIdx: number, leafIdx: number) => string | null;
}

export function alinearPorSegmentos(
  filas: FilaAlineable[],
  leaves: PdfLeaf[],
  segmentos: Segmento[],
  opts: OpcionesPorSegmentos = {},
): AlignResult {
  const asignaciones: Asignacion[] = [];
  const huerfanosFicha: number[] = [];
  const huerfanosPdf: number[] = [];
  const filasVistas = new Set<number>();
  const leavesVistos = new Set<number>();

  for (const seg of segmentos) {
    for (const i of seg.filaIdxs) filasVistas.add(i);
    for (const j of seg.leafIdxs) leavesVistos.add(j);
    if (seg.filaIdxs.length === 0) {
      huerfanosPdf.push(...seg.leafIdxs);
      continue;
    }
    if (seg.leafIdxs.length === 0) {
      huerfanosFicha.push(...seg.filaIdxs);
      continue;
    }
    // 1) Las anclas son asignaciones FIJAS. No se les exige monotonía: el orden
    //    de la ficha y el del PDF difieren de verdad dentro del bloque, y las
    //    anclas que se cruzan son justamente las que arreglan ese desorden.
    const filasAncladas = new Set<number>();
    const leavesAnclados = new Set<number>();
    for (const a of seg.anclas ?? []) {
      if (!seg.filaIdxs.includes(a.filaIdx)) continue;
      const js = a.leafIdxs.filter((j) => seg.leafIdxs.includes(j) && !leavesAnclados.has(j));
      if (js.length === 0 || filasAncladas.has(a.filaIdx)) continue;
      filasAncladas.add(a.filaIdx);
      for (const j of js) leavesAnclados.add(j);
      // La etiqueta impresa es la evidencia más fuerte que hay: confianza alta,
      // sin recalcular por posición. Una corrida (1:N) sí se manda a revisar:
      // el reparto por caja lo tiene que confirmar una persona.
      asignaciones.push({
        filaIdx: a.filaIdx,
        leafIdx: js,
        sufijos: a.sufijos,
        confianza: js.length > 1 ? 'media' : 'alta',
        motivos: [a.motivo, `región «${seg.etiqueta}»`],
        score: MATCH_TIPO_OK + BOOST_TEXTO,
      });
    }

    // 2) El resto se alinea por posición, ya sin las filas y campos anclados y
    //    sin las opciones que pertenecen a otra región.
    const excluidas = new Set(seg.excluirFilas ?? []);
    for (const i of seg.filaIdxs) if (excluidas.has(i) && !filasAncladas.has(i)) huerfanosFicha.push(i);
    const restoFilas = seg.filaIdxs.filter((i) => !filasAncladas.has(i) && !excluidas.has(i));
    const restoLeaves = seg.leafIdxs.filter((j) => !leavesAnclados.has(j));
    if (restoFilas.length === 0) {
      huerfanosPdf.push(...restoLeaves);
      continue;
    }
    if (restoLeaves.length === 0) {
      huerfanosFicha.push(...restoFilas);
      continue;
    }
    const r = alinear(
      restoFilas.map((i) => filas[i]),
      restoLeaves.map((j) => leaves[j]),
      {
        penalidad: PENALIDAD_ETIQUETA,
        contradice: opts.evidenciaFuerte
          ? (li, lj) => !!opts.evidenciaFuerte!(restoFilas[li], restoLeaves[lj])
          : undefined,
      },
    );
    for (const a of r.asignaciones) {
      asignaciones.push({
        ...a,
        filaIdx: restoFilas[a.filaIdx],
        leafIdx: a.leafIdx.map((li) => restoLeaves[li]),
        motivos: [...a.motivos, `región «${seg.etiqueta}»`],
      });
    }
    huerfanosFicha.push(...r.huerfanosFicha.map((i) => restoFilas[i]));
    huerfanosPdf.push(...r.huerfanosPdf.map((j) => restoLeaves[j]));
  }

  // Lo que no cayó en ningún segmento también es huérfano: no se fuerza nada.
  filas.forEach((_, i) => {
    if (!filasVistas.has(i)) huerfanosFicha.push(i);
  });
  leaves.forEach((_, j) => {
    if (!leavesVistos.has(j)) huerfanosPdf.push(j);
  });

  // Degradación por evidencia en contra. No se toca lo que vino de un ancla:
  // ahí la etiqueta impresa ES la evidencia a favor.
  if (opts.evidenciaEnContra) {
    for (const a of asignaciones) {
      if (a.motivos.some((m) => m.startsWith('la etiqueta impresa del PDF coincide'))) continue;
      const motivo = opts.evidenciaEnContra(a.filaIdx, a.leafIdx[0]);
      if (!motivo) continue;
      a.confianza = 'revisar';
      a.motivos.unshift(motivo);
    }
  }

  asignaciones.sort((a, b) => a.leafIdx[0] - b.leafIdx[0]);
  huerfanosFicha.sort((a, b) => a - b);
  huerfanosPdf.sort((a, b) => a - b);

  const alta = asignaciones.filter((a) => a.confianza === 'alta').length;
  const media = asignaciones.filter((a) => a.confianza === 'media').length;
  const revisar = asignaciones.filter((a) => a.confianza === 'revisar').length;

  return {
    asignaciones,
    huerfanosFicha,
    huerfanosPdf,
    stats: {
      filas: filas.length,
      campos: leaves.length,
      asignadas: asignaciones.length,
      alta,
      media,
      revisar,
      pctAlta: asignaciones.length ? Math.round((alta / asignaciones.length) * 100) : 0,
      relaciones1aN: asignaciones.filter((a) => a.leafIdx.length > 1).length,
    },
  };
}
