// ---------------------------------------------------------------------------
// Etapa 0 — Instancias y generación del AcroName propuesto.
//
// B.1 Un bloque de la ficha puede instanciarse N veces en el PDF (p.ej. el
//     mismo bloque `personas` sirve para el asegurado, la persona jurídica y el
//     representante legal). Los códigos salen de la col F de la fila codigoTipo.
// B.2 La clave única es: prefijo_instancia + slug(C) + [slug(F)]
//     El sufijo de F solo se agrega cuando la fila pertenece a un grupo de
//     opciones (>=2 filas CONSECUTIVAS con el mismo valor en col D).
// ---------------------------------------------------------------------------

import type { FichaRow } from './fichaRaw';
import { norm } from './fichaRaw';

/** minúsculas, sin acentos, sin puntuación, espacios -> `_` */
export function slug(s: string): string {
  return norm(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// --- B.1 instancias ---------------------------------------------------------

export interface Instancia {
  /** código tal como vino en la ficha (ASG, PJR, RPL...) */
  codigo: string;
  /** prefijo del AcroName; editable por el usuario (default: slug del código) */
  prefijo: string;
  /** índice de personas[]; editable (default incremental) — NO se inventa */
  indice: number;
  activa: boolean;
}

/**
 * Extrae los códigos de instancia de una celda como:
 *   `"ASG","PJR","RPL" (ver catálogo)`
 * Tolera comillas, comas y texto suelto entre paréntesis.
 */
export function parseCodigosInstancia(valor: string): string[] {
  if (!valor) return [];
  // 1) preferimos lo que venga entrecomillado
  const entrecomillado = [...valor.matchAll(/"([^"]+)"|“([^”]+)”|'([^']+)'/g)].map(
    (m) => (m[1] ?? m[2] ?? m[3] ?? '').trim(),
  );
  const crudos = entrecomillado.length
    ? entrecomillado
    : valor
        .replace(/\([^)]*\)/g, '') // saca "(ver catálogo)"
        .split(/[,;/]/)
        .map((s) => s.trim());
  const out: string[] = [];
  for (const c of crudos) {
    const limpio = c.replace(/\([^)]*\)/g, '').trim();
    if (!limpio) continue;
    if (/ver\s+cat[aá]logo/i.test(limpio)) continue;
    if (!out.includes(limpio)) out.push(limpio);
  }
  return out;
}

/** Instancias por defecto a partir de los códigos (índice incremental). */
export function instanciasPorDefecto(codigos: string[]): Instancia[] {
  return codigos.map((codigo, i) => ({ codigo, prefijo: slug(codigo), indice: i, activa: true }));
}

/**
 * Encuentra los bloques instanciables: filas `codigoTipo` cuya col F trae más
 * de un código. Devuelve una entrada por hoja.
 */
export interface BloqueInstanciable {
  hoja: string;
  filaCodigoTipo: number;
  codigos: string[];
}

export function detectarBloquesInstanciables(rows: FichaRow[]): BloqueInstanciable[] {
  const out: BloqueInstanciable[] = [];
  for (const r of rows) {
    const esCodigoTipo = norm(r.campoJson).endsWith('codigotipo');
    if (!esCodigoTipo) continue;
    const codigos = parseCodigosInstancia(r.valor);
    if (codigos.length > 1) out.push({ hoja: r.hoja, filaCodigoTipo: r.fila, codigos });
  }
  return out;
}

/** Clona las filas de la hoja instanciable, una vez por instancia activa. */
export function expandirInstancias(
  rows: FichaRow[],
  hoja: string,
  instancias: Instancia[],
): FilaExpandida[] {
  const activas = instancias.filter((i) => i.activa);
  const delBloque = rows.filter((r) => r.hoja === hoja);
  if (activas.length === 0 || delBloque.length === 0) {
    return rows.map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
  }
  // Expansión INSTANCIA-MAYOR: primero todas las filas de ASG, después las de
  // PJR, etc. Es como el PDF dispone los bloques, y además mantiene juntas las
  // filas de un grupo de opciones (la detección de grupos exige consecutividad).
  const out: FilaExpandida[] = [];
  let yaExpandido = false;
  for (const r of rows) {
    if (r.hoja !== hoja) {
      out.push({ ...r, instancia: null, indiceInstancia: null });
      continue;
    }
    if (yaExpandido) continue; // el bloque entero ya se emitió
    yaExpandido = true;
    for (const inst of activas) {
      for (const fila of delBloque) {
        out.push({ ...fila, instancia: inst, indiceInstancia: inst.indice });
      }
    }
  }
  return out;
}

export interface FilaExpandida extends FichaRow {
  instancia: Instancia | null;
  indiceInstancia: number | null;
}

// --- B.2 nombre propuesto ---------------------------------------------------

/**
 * Marca qué filas pertenecen a un grupo de opciones: >=2 filas CONSECUTIVAS
 * (misma hoja) con el mismo valor en col D.
 */
export function marcarGruposDeOpciones(rows: FilaExpandida[]): boolean[] {
  const esGrupo = new Array(rows.length).fill(false);
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (
      j + 1 < rows.length &&
      rows[j + 1].hoja === rows[i].hoja &&
      rows[j + 1].instancia?.codigo === rows[i].instancia?.codigo &&
      !!rows[i].label &&
      norm(rows[j + 1].label) === norm(rows[i].label)
    ) {
      j++;
    }
    if (j > i) for (let k = i; k <= j; k++) esGrupo[k] = true;
    i = j + 1;
  }
  return esGrupo;
}

export interface NombrePropuesto {
  fila: FilaExpandida;
  /** '' cuando la fila no va al PDF */
  nombre: string;
  /** true si `nombre` choca con el de otra fila */
  colision: boolean;
  /** partes que lo compusieron, para mostrar en la UI */
  partes: { prefijo: string; base: string; sufijo: string };
}

/**
 * Genera el AcroName propuesto de cada fila que va al PDF.
 * Las filas solo-JSON / excluidas quedan con nombre vacío: no compiten por
 * ningún campo del PDF.
 */
export function generarNombres(rows: FilaExpandida[]): NombrePropuesto[] {
  const esGrupo = marcarGruposDeOpciones(rows);
  const out: NombrePropuesto[] = rows.map((fila, i) => {
    if (fila.destino !== 'pdf') {
      return { fila, nombre: '', colision: false, partes: { prefijo: '', base: '', sufijo: '' } };
    }
    const prefijo = fila.instancia?.prefijo ? slug(fila.instancia.prefijo) : '';
    const base = slug(fila.nombrePdf || fila.label);
    const sufijo = esGrupo[i] && fila.valor ? slug(fila.valor) : '';
    const nombre = [prefijo, base, sufijo].filter(Boolean).join('_');
    return { fila, nombre, colision: false, partes: { prefijo, base, sufijo } };
  });

  // Colisiones: se marcan, NO se desambiguan con contador ciego.
  const cuenta = new Map<string, number>();
  for (const n of out) if (n.nombre) cuenta.set(n.nombre, (cuenta.get(n.nombre) ?? 0) + 1);
  for (const n of out) if (n.nombre && (cuenta.get(n.nombre) ?? 0) > 1) n.colision = true;

  return out;
}

export function contarColisiones(nombres: NombrePropuesto[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const n of nombres) if (n.colision) c[n.nombre] = (c[n.nombre] ?? 0) + 1;
  return c;
}
