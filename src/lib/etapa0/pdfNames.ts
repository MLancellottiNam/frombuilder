// ---------------------------------------------------------------------------
// Etapa 0 — Los name objects del PDF tienen que sobrevivir el round-trip.
//
// El problema, en pdf-lib (v1.17):
//
//   decodeName = (name) => name.replace(/#([\dABCDEF]{2})/g, ...)
//
// El hex de un escape `#xx` es case-insensitive según la spec (7.3.5), pero esa
// regex sólo toma MAYÚSCULA. Un archivo que trae `/S#ed` —«Sí», que es como
// escribe los estados de exportación el generador de los formularios del INS—
// no se des-escapa: el name queda como el string LITERAL `S#ed`. Y al guardar,
// el constructor de PDFName escapa el `#` (carácter irregular) como `#23`, así
// que sale `/S#23ed`.
//
// Consecuencia concreta: en el D0714 las 25 casillas quedaban con un estado de
// exportación que no existe, Signframe escribía en /V el valor viejo y ninguna
// casilla se marcaba. No lo rompía nuestro código —el renombrado no toca /AP—:
// lo rompía leer y volver a escribir.
//
// El fix es en la LECTURA, que es donde está el defecto, y una sola vez para
// todos los names del documento: /AP/N, /AP/D, /AS, /FT, /Opt, el que sea.
// `PDFName.of()` es el único camino por el que el parser crea names, así que se
// envuelve ahí:
//
//   - se des-escapa el `#xx` con hex de cualquier caso, que es lo que pdf-lib
//     debería haber hecho;
//   - y la instancia se deja emitiendo EXACTAMENTE los bytes que traía el
//     archivo, para que el /AP salga byte por byte como entró (pdf-lib
//     re-escaparía en mayúscula: correcto, pero no idéntico).
//
// Sin tabla de reemplazos y sin ningún caso especial: no sabe nada de «Sí» ni
// del INS.
// ---------------------------------------------------------------------------

import type { PDFName as TPDFName } from 'pdf-lib';

/** Cualquier escape `#xx`, con el hex en el caso que sea. */
const ESCAPE = /#([0-9a-fA-F]{2})/g;

type ConstructorDeNames = { of: (name: string) => TPDFName };

const parchados = new WeakSet<object>();

/** Instancias propias, una por literal del archivo (`S#ed` y `S#ED` son dos). */
const porLiteral = new Map<string, TPDFName>();

/**
 * Arregla el des-escapado de names de pdf-lib. Idempotente: se puede llamar en
 * cada lectura/escritura sin acumular envoltorios.
 *
 * Se le pasa el `PDFName` que devuelve el `import('pdf-lib')` del llamador, que
 * es el mismo objeto que usa el parser.
 */
export function parcharNamesPdfLib(PDFName: ConstructorDeNames): void {
  if (parchados.has(PDFName)) return;
  parchados.add(PDFName);

  const original = PDFName.of.bind(PDFName);

  PDFName.of = (crudo: string): TPDFName => {
    if (!crudo.includes('#')) return original(crudo);

    const descifrado = crudo.replace(ESCAPE, (_, hx: string) => String.fromCharCode(parseInt(hx, 16)));

    // Si al des-escapar queda un `#`, el name contiene un numeral de verdad y
    // el texto crudo es ambiguo (`/a#23ed` es «a#ed», no «aíd»). En ese caso no
    // se toca nada: pdf-lib ya lo resuelve bien porque `23` es hex mayúscula
    // válida para su regex.
    if (descifrado.includes('#')) return original(crudo);

    const base = original(descifrado);
    const literal = '/' + crudo;

    // El literal se respeta SÓLO si lo único que lo separa de la codificación
    // de pdf-lib es el caso del hex. Un archivo puede escapar de más (`/A#42C`
    // es «ABC», que no necesita escapes): ahí alcanza con la instancia normal,
    // ya bien des-escapada.
    if (base.asString().toUpperCase() !== literal.toUpperCase()) return base;
    if (base.asString() === literal) return base;

    // Instancia PROPIA, no la pooleada de pdf-lib: la suya se comparte con
    // todos los documentos abiertos en la sesión, y pisarle los bytes le
    // cambiaría el escapado a un PDF que no tiene nada que ver.
    //
    // `encodedName` es lo único que se copia al archivo (`copyBytesInto`) y lo
    // que mide `sizeInBytes`; el resto de los métodos sale del prototipo. Con
    // el literal adentro, el name se escribe igual a como entró.
    const guardada = porLiteral.get(literal);
    if (guardada) return guardada;

    const copia = Object.create(Object.getPrototypeOf(base)) as TPDFName;
    (copia as unknown as { encodedName: string }).encodedName = literal;
    porLiteral.set(literal, copia);
    return copia;
  };
}
