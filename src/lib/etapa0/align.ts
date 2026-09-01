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
export function alinear(filas: FilaAlineable[], leaves: PdfLeaf[]): AlignResult {
  const n = filas.length;
  const m = leaves.length;

  // --- DP: dp[i][j] = mejor score alineando filas[0..i) con leaves[0..j) ---
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)); // 1=match 2=gapFila 3=gapLeaf
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + GAP;
    from[i][0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] + GAP;
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

      let best = dp[i - 1][j - 1] + p.score;
      let dir = 1;
      let bestRun = 1;

      // corridas 1:N (solo fechas): la fila consume k campos contiguos
      for (let k = 2; k <= maxRun && j - k >= 0; k++) {
        const ini = j - k;
        if (!corridaValida(ini, j - 1)) break;
        const pIni = puntuar(filas[i - 1], leaves[ini]);
        // el 1er campo puntúa normal; cada caja extra suma poco, pero más que
        // el hueco que evitaría (GAP), para no sobre-absorber.
        const cand = dp[i - 1][ini] + pIni.score + (k - 1);
        if (cand > best) {
          best = cand;
          dir = 1;
          bestRun = k;
        }
      }

      const gapFila = dp[i - 1][j] + GAP;
      const gapLeaf = dp[i][j - 1] + GAP;
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
  const matchedFila = new Set(asignaciones.map((a) => a.filaIdx));
  asignaciones.forEach((a, idx) => {
    const p = cache[a.filaIdx][a.leafIdx[0]];
    const vecinoPrev = idx > 0 && matchedFila.has(asignaciones[idx - 1].filaIdx);
    const vecinoNext = idx < asignaciones.length - 1 && matchedFila.has(asignaciones[idx + 1].filaIdx);
    const anclado = vecinoPrev && vecinoNext;

    if (p.textoOk) a.motivos.unshift('el texto de la ficha aparece en el AcroName');
    if (!p.tipoOk) a.motivos.unshift(`desajuste de tipo: la ficha pide ${tipoEsperado(filas[a.filaIdx].tipo)}, el PDF trae ${leaves[a.leafIdx[0]].ft}`);
    if (anclado && p.tipoOk) a.motivos.push('posición consistente entre vecinos alineados');

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
