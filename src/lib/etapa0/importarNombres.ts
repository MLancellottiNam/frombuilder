// ---------------------------------------------------------------------------
// Etapa 0 — Importar los nombres resueltos afuera (v3.0.0).
//
// Cierra el circuito: la app exporta el paquete, la skill resuelve el mapeo con
// juicio, y el paquete vuelve con `nombre_nuevo` lleno (y con sus columnas de
// afuera completas). Acá se aplican los nombres.
//
// En v2.0.0 había una segunda vía: leer la col N de la ficha y derivar el nombre
// canónico de cada fila. Se fue con el recorte, por dos razones. Una: necesitaba
// el generador de nombres del motor de alineación, que se borró. Otra, más de
// fondo: la col N de la ficha **no puede expresar el renombrado** de un
// formulario con bloque repetible —una fila se corresponde con 3 campos que
// necesitan 3 nombres distintos y la ficha tiene una sola celda—. El paquete sí,
// porque tiene una fila por widget.
//
// NADA SE APLICA A MEDIAS. Si el resultado tendría nombres repetidos, se reporta
// y no se toca nada: un PDF con dos campos del mismo nombre rompe el bind de
// Signframe y es de los errores que no se ven hasta el final.
//
// Y NO SE PISA lo editado a mano sin confirmación explícita.
// ---------------------------------------------------------------------------

import type { PdfLeaf } from './pdfFields';
import { HEADERS_APP } from './paquete';

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
      `El archivo no parece un paquete de campos: no se encontró la fila de encabezados (${(HEADERS_APP as string[]).slice(0, 3).join(', ')}…).`,
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
