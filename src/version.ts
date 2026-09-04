// ---------------------------------------------------------------------------
// Versión de la app, en un solo lugar.
// El badge de cada pantalla la toma de acá; actualizarla en cada entrega junto
// con la etiqueta corta de la fase. `package.json` se mantiene en sincronía a
// mano (importar el JSON desde el bundle traería todo el manifiesto al cliente).
// ---------------------------------------------------------------------------

export const VERSION = '3.0.0';

/** Etiqueta corta de lo último entregado, para el badge. */
export const FASE = 'generador';

export const BADGE = `v${VERSION} · ${FASE}`;
