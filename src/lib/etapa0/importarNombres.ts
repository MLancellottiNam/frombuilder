// ---------------------------------------------------------------------------
// Etapa 0 — Importar los nombres resueltos afuera (v2.0.0).
//
// Cierra el circuito: la app exporta el paquete, el mapeo se resuelve afuera
// con juicio, y acá vuelve. Dos vehículos:
//
//  1. EL PAQUETE con la columna `nombre_nuevo` llena. Es el camino directo y sin
//     ambigüedad: una fila por widget, con el `nombre_actual` al lado, así que
//     el emparejamiento es exacto.
//
//  2. LA FICHA con la col N llena. La col N («Nombre interno del campo en PDF»)
//     dice, por fila, con qué campo del PDF se corresponde; el nombre que se
//     aplica es el CANÓNICO de esa fila (`slug(col C)` + `slug(col F)` cuando es
//     una opción de grupo), que es la misma regla determinista de siempre. Si
//     una fila lista varios campos separados por coma es el caso 1:N y los
//     sufijos salen del formato de la col F (`dd/mm/aaaa` -> `_dia/_mes/_ano`) o,
//     si no se puede derivar, posicionales.
//
// NADA SE APLICA A MEDIAS. Si el resultado tendría nombres repetidos, se reporta
// y no se toca nada: un PDF con dos campos del mismo nombre rompe el bind de
// Etapa 2 y es de los errores que no se ven hasta el final.
//
// Y NO SE PISA lo editado a mano sin confirmación explícita: el trabajo manual
// vale más que un archivo que quizá está viejo.
// ---------------------------------------------------------------------------

import type { PdfLeaf } from './pdfFields';
import { generarNombres, slug } from './acroName';
import { buildFichaRaw, norm, type RawSheet } from './fichaRaw';
import { sufijosDeFormato } from './regiones';
import { HEADERS_PAQUETE } from './paquete';

export interface Renombre {
  /** nombre ACTUAL del campo en el PDF */
  nombreActual: string;
  nombreNuevo: string;
  /** de dónde salió, para poder explicarlo en la UI */
  fuente: string;
}

export interface ResultadoImport {
  /** lo que se aplicaría */
  aplicar: Renombre[];
  /** valores del archivo que no corresponden a ningún campo del PDF */
  sinCampoEnPdf: { valor: string; fuente: string }[];
  /** campos del PDF que el archivo no menciona */
  camposSinNombre: string[];
  /** nombres finales que quedarían repetidos (bloquean la importación) */
  colisiones: string[];
  /** renombres que pisarían una edición manual */
  pisaManual: Renombre[];
  avisos: string[];
}

const vacio = (): ResultadoImport => ({
  aplicar: [],
  sinCampoEnPdf: [],
  camposSinNombre: [],
  colisiones: [],
  pisaManual: [],
  avisos: [],
});

/** «No aplica» en la col N es la forma del INS de decir «vacío». */
function esVacio(v: string): boolean {
  const n = norm(v);
  return n === '' || n === 'no aplica' || n === 'n/a' || n === 'na';
}

export function partirTokens(v: string): string[] {
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && !esVacio(s));
}

/**
 * Cierra el resultado: detecta colisiones contra los nombres que NO se tocan y
 * marca qué renombres pisarían una edición manual.
 */
function cerrar(
  r: ResultadoImport,
  leaves: PdfLeaf[],
  esManual?: (nombreActual: string) => string | undefined,
): ResultadoImport {
  const porActual = new Map(r.aplicar.map((x) => [x.nombreActual, x]));
  r.camposSinNombre = leaves.filter((l) => !porActual.has(l.name)).map((l) => l.name);

  // El nombre final de cada campo: el importado, o el que ya tenía.
  const cuenta = new Map<string, number>();
  for (const l of leaves) {
    const final = porActual.get(l.name)?.nombreNuevo ?? l.name;
    cuenta.set(final, (cuenta.get(final) ?? 0) + 1);
  }
  r.colisiones = [...cuenta.entries()].filter(([, c]) => c > 1).map(([n]) => n);

  if (esManual) {
    r.pisaManual = r.aplicar.filter((x) => {
      const actualManual = esManual(x.nombreActual);
      return actualManual != null && actualManual !== x.nombreNuevo;
    });
  }
  return r;
}

// --- 1. desde el paquete ---------------------------------------------------

/**
 * Lee el paquete (aoa del xlsx). Se busca la fila de header por sus nombres de
 * columna en vez de asumir la primera fila: quien lo edita afuera puede haberle
 * agregado una fila de título arriba.
 */
export function importarDesdePaquete(
  aoa: (string | number)[][],
  leaves: PdfLeaf[],
  esManual?: (nombreActual: string) => string | undefined,
): ResultadoImport {
  const r = vacio();
  const idxHeader = aoa.findIndex((fila) => {
    const cels = (fila ?? []).map((c) => String(c ?? '').trim().toLowerCase());
    return cels.includes('nombre_actual') && cels.includes('nombre_nuevo');
  });
  if (idxHeader < 0) {
    r.avisos.push(
      `El archivo no parece un paquete de campos: no se encontró la fila de encabezados (${HEADERS_PAQUETE.slice(0, 3).join(', ')}…).`,
    );
    return cerrar(r, leaves, esManual);
  }
  const header = (aoa[idxHeader] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
  const col = (nombre: string) => header.indexOf(nombre);
  const cActual = col('nombre_actual');
  const cNuevo = col('nombre_nuevo');
  const cOrigen = col('origen');

  const porNombre = new Map(leaves.map((l) => [l.name, l]));
  const yaVisto = new Map<string, string>();

  for (let i = idxHeader + 1; i < aoa.length; i++) {
    const fila = aoa[i] ?? [];
    const actual = String(fila[cActual] ?? '').trim();
    const nuevo = String(fila[cNuevo] ?? '').trim();
    const origen = cOrigen >= 0 ? String(fila[cOrigen] ?? '').trim() : '';
    if (!nuevo) continue;
    if (origen === 'borrado') continue;
    if (!porNombre.has(actual)) {
      r.sinCampoEnPdf.push({ valor: `${actual} -> ${nuevo}`, fuente: `paquete fila ${i + 1}` });
      continue;
    }
    // Un campo con varios widgets aparece en varias filas: es UN nombre.
    const previo = yaVisto.get(actual);
    if (previo != null) {
      if (previo !== nuevo) {
        r.avisos.push(
          `«${actual}» tiene dos nombres nuevos distintos en el paquete («${previo}» y «${nuevo}»): un campo con varios widgets es UN campo y lleva un solo nombre. Se aplica el primero.`,
        );
      }
      continue;
    }
    yaVisto.set(actual, nuevo);
    r.aplicar.push({ nombreActual: actual, nombreNuevo: nuevo, fuente: `paquete fila ${i + 1}` });
  }

  return cerrar(r, leaves, esManual);
}

// --- 2. desde la ficha (col N) ---------------------------------------------

export function importarColNDeFicha(
  sheets: RawSheet[],
  leaves: PdfLeaf[],
  esManual?: (nombreActual: string) => string | undefined,
): ResultadoImport {
  const r = vacio();
  const ficha = buildFichaRaw(sheets);

  // Nombre canónico de cada fila. Sin instancias: una fila que se repite por
  // instancia daría el MISMO nombre para varios campos, y eso sale como
  // colisión en vez de resolverse con un contador ciego.
  const nombres = generarNombres(
    ficha.rows.map((x) => ({ ...x, instancia: null, indiceInstancia: null })),
  );

  const porNombre = new Map(leaves.map((l) => [l.name, l]));
  // Fallback tolerante: el mismo nombre con otra caja o espacios de más.
  const porNorm = new Map<string, PdfLeaf[]>();
  for (const l of leaves) {
    const k = norm(l.name);
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k)!.push(l);
  }
  const buscar = (token: string): PdfLeaf | null => {
    const exacto = porNombre.get(token);
    if (exacto) return exacto;
    const cands = porNorm.get(norm(token)) ?? [];
    return cands.length === 1 ? cands[0] : null;
  };

  let filasConColN = 0;
  ficha.rows.forEach((fila, i) => {
    const tokens = partirTokens(fila.campoPdfInterno ?? '');
    if (tokens.length === 0) return;
    filasConColN++;
    const canonico = nombres[i]?.nombre || slug(fila.nombrePdf || fila.label);
    if (!canonico) {
      r.avisos.push(`${fila.hoja}·${fila.fila}: la col N apunta a un campo pero la fila no tiene nombre (col C vacía).`);
      return;
    }
    // 1:N: una fila pintada en varias cajas. El sufijo sale del formato de la
    // col F y si no se puede derivar es posicional. Es estructural, editable, y
    // no es desambiguación de colisión.
    const sufijos = tokens.length > 1 ? sufijosDeFormato(fila.valor, tokens.length) : undefined;
    tokens.forEach((token, k) => {
      const leaf = buscar(token);
      if (!leaf) {
        r.sinCampoEnPdf.push({ valor: token, fuente: `${fila.hoja}·${fila.fila} (col N)` });
        return;
      }
      const nuevo = tokens.length > 1 ? `${canonico}_${sufijos?.[k] ?? k + 1}` : canonico;
      r.aplicar.push({ nombreActual: leaf.name, nombreNuevo: nuevo, fuente: `${fila.hoja}·${fila.fila} (col N)` });
    });
  });

  if (filasConColN === 0) {
    r.avisos.push(
      'Ninguna fila de la ficha tiene la col N llena («Nombre interno del campo en PDF»): no hay nada que importar.',
    );
  }

  // Dos filas apuntando al mismo campo: la última ganaría en silencio.
  const cuenta = new Map<string, string[]>();
  for (const x of r.aplicar) {
    if (!cuenta.has(x.nombreActual)) cuenta.set(x.nombreActual, []);
    cuenta.get(x.nombreActual)!.push(`${x.nombreNuevo} (${x.fuente})`);
  }
  for (const [actual, lista] of cuenta) {
    if (lista.length > 1) {
      r.avisos.push(`«${actual}» aparece en la col N de ${lista.length} filas distintas: ${lista.join(' · ')}.`);
    }
  }

  return cerrar(r, leaves, esManual);
}
