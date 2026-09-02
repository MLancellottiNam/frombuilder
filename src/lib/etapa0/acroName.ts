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

import type { FichaRow, RoutingEntry } from './fichaRaw';
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
  /** hoja donde vive la fila `codigoTipo` */
  hoja: string;
  /**
   * TODAS las hojas del bloque repetible: la hoja raíz más sus hijas según el
   * índice "Estructura base JSON". En el CSC `direccion` es
   * `datosFormulario.personas.direccion`, o sea hija de `personas`: el PDF la
   * repite una vez por instancia igual que el resto del bloque. Si se expandiera
   * solo la hoja raíz, provincia/cantón/distrito existirían una sola vez contra
   * tres bloques del PDF.
   */
  hojas: string[];
  filaCodigoTipo: number;
  codigos: string[];
}

/**
 * Hojas hijas de `hoja` según el ruteo. El último segmento del path del índice
 * es el nombre de la hoja (`datosFormulario.personas.direccion` -> `direccion`).
 */
export function hojasDelBloque(hoja: string, routing: RoutingEntry[], rows: FichaRow[]): string[] {
  const existentes = new Set(rows.map((r) => r.hoja));
  const ultimo = (path: string) => path.split('.').filter(Boolean).pop() ?? '';
  const base = routing.find((r) => ultimo(r.nodo) === hoja)?.nodo;
  if (!base) return [hoja];
  const hijas = routing
    .filter((r) => r.nodo !== base && r.nodo.startsWith(base + '.'))
    .map((r) => ultimo(r.nodo))
    .filter((h) => h && existentes.has(h));
  // Se respeta el orden en que las hojas aparecen en la ficha.
  const orden = [...new Set(rows.map((r) => r.hoja))];
  return orden.filter((h) => h === hoja || hijas.includes(h));
}

export function detectarBloquesInstanciables(rows: FichaRow[], routing: RoutingEntry[] = []): BloqueInstanciable[] {
  const out: BloqueInstanciable[] = [];
  for (const r of rows) {
    const esCodigoTipo = norm(r.campoJson).endsWith('codigotipo');
    if (!esCodigoTipo) continue;
    const codigos = parseCodigosInstancia(r.valor);
    if (codigos.length > 1) {
      out.push({ hoja: r.hoja, hojas: hojasDelBloque(r.hoja, routing, rows), filaCodigoTipo: r.fila, codigos });
    }
  }
  return out;
}

/**
 * Clona las filas del bloque repetible, una vez por instancia activa.
 * `hojas` son TODAS las hojas del bloque (raíz + hijas), no solo la raíz.
 */
export function expandirInstancias(
  rows: FichaRow[],
  hojas: string | string[],
  instancias: Instancia[],
): FilaExpandida[] {
  const set = new Set(Array.isArray(hojas) ? hojas : [hojas]);
  const activas = instancias.filter((i) => i.activa);
  const delBloque = rows.filter((r) => set.has(r.hoja));
  if (activas.length === 0 || delBloque.length === 0) {
    return rows.map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
  }
  // Expansión INSTANCIA-MAYOR: primero todas las filas de ASG, después las de
  // PJR, etc. Es como el PDF dispone los bloques, y además mantiene juntas las
  // filas de un grupo de opciones (la detección de grupos exige consecutividad).
  const out: FilaExpandida[] = [];
  let yaExpandido = false;
  for (const r of rows) {
    if (!set.has(r.hoja)) {
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
 * Nombre base de una fila: es exactamente lo que usa `generarNombres`.
 * Se centraliza acá porque la detección de grupos y la generación del nombre
 * TIENEN que usar la misma clave, si no aparecen colisiones sin sufijo.
 */
export function baseDeFila(r: { nombrePdf: string; label: string }): string {
  return norm(r.nombrePdf || r.label);
}

/**
 * Marca qué filas pertenecen a un grupo de opciones: >=2 filas CONSECUTIVAS
 * (misma hoja, misma instancia) que comparten el NOMBRE BASE.
 *
 * Antes se agrupaba por col D, y eso dejaba grupos sin detectar: en el CSC las
 * filas `direccion-5` y `direccion-6` comparten col C ("Domicilio") pero tienen
 * col D distinta ("Nacional" / "Extranjero"), así que no se agrupaban, ninguna
 * recibía el sufijo de col F y las dos terminaban llamándose `domicilio`.
 * Agrupar por el nombre base es la regla correcta: el sufijo existe justamente
 * para desambiguar las filas que si no chocarían.
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
      !!baseDeFila(rows[i]) &&
      baseDeFila(rows[j + 1]) === baseDeFila(rows[i])
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
    const base = slug(baseDeFila(fila));
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
