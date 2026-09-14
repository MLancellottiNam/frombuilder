// ---------------------------------------------------------------------------
// Estados de exportación de las casillas: el renombrado NO los puede tocar.
//
// El bug (D0714, 25 casillas): el PDF trae el estado `/S#ed` —«Sí», con la í
// escapada en hex MINÚSCULA— y el PDF renombrado salía con `/S#23ed`. Como ese
// valor es el que Signframe escribe en /V, ninguna casilla se marcaba.
//
// La causa está en pdf-lib: `decodeName` usa /#([\dABCDEF]{2})/g —hex sólo en
// MAYÚSCULA—, así que `#ed` no se des-escapa y el name queda como el string
// literal `S#ed`; al guardar, el `#` es un carácter irregular y se re-escapa
// como `#23`. Nosotros nunca escribimos /AP: se rompe en el round-trip.
//
// El fixture es sintético (no hay PDF del cliente en el repo): se arma una
// casilla con estado «Sí» y se baja el hex a minúscula a nivel de bytes, que es
// exactamente lo que hace el generador de los formularios del INS.
// ---------------------------------------------------------------------------

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { readPdfFields } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado } from '../src/lib/etapa0/writePdf';
import { pdfConCasilla, latin1 } from './helpers/pdfCasilla';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const hex = (b: Uint8Array) => Array.from(b, (c) => c.toString(16).padStart(2, '0')).join(' ');

/** Las claves del /AP/N de la única casilla del PDF, tal como están escritas. */
async function estadosDe(data: Uint8Array): Promise<PDFName[]> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, throwOnInvalidObject: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!;
  const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray)!;
  const uno = fields.get(0);
  const dict = (uno instanceof PDFRef ? doc.context.lookup(uno) : uno) as PDFDict;
  const ap = dict.lookupMaybe(PDFName.of('AP'), PDFDict)!;
  const n = ap.lookupMaybe(PDFName.of('N'), PDFDict)!;
  return n.keys();
}

const encendido = (ns: PDFName[]) => ns.find((k) => k.asString() !== '/Off')!;

(async () => {
  // --- el fixture es lo que decimos que es --------------------------------
  const original = await pdfConCasilla('minuscula');
  ok(latin1(original).includes('/S#ed'), 'el PDF de entrada trae el estado escrito como /S#ed');

  const leido = await readPdfFields(original);
  ok(leido.leaves.length === 1, `se detecta 1 campo (got ${leido.leaves.length})`);
  ok(leido.leaves[0]?.ft === '/Btn', 'y es un /Btn');

  // --- el renombrado no puede tocar el estado ------------------------------
  const res = await escribirPdfRenombrado(original, new Map([['casilla', 'chk_acepta']]), {
    limitarFuente: true,
  });
  ok(res.renombrados === 1, `1 campo renombrado (got ${res.renombrados})`);

  const salida = await estadosDe(res.bytes);
  ok(salida.length === 2, `el /AP/N de salida sigue teniendo 2 estados (got ${salida.length})`);

  const on = encendido(salida);
  ok(
    on.asString() === '/S#ed',
    `el estado encendido sale byte por byte como entró: esperado /S#ed, salió ${on.asString()}`,
  );
  ok(
    hex(on.asBytes()) === '53 ed',
    `y decodifica a «Sí» (53 ed), no a los 4 caracteres literales: got ${hex(on.asBytes())}`,
  );
  ok(
    salida.some((k) => k.asString() === '/Off'),
    'el estado /Off sigue estando',
  );

  // --- lo que sí se limpia -------------------------------------------------
  const doc = await PDFDocument.load(res.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!;
  const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray)!;
  const dict = doc.context.lookup((fields.get(0) as PDFRef)) as PDFDict;
  ok(dict.get(PDFName.of('V')) === undefined, '/V se borró');
  ok(dict.get(PDFName.of('AS'))?.toString() === '/Off', '/AS quedó en /Off');
  ok(dict.lookupMaybe(PDFName.of('MK'), PDFDict) !== undefined, '/MK sigue estando');

  // --- el caso en mayúscula tampoco se puede mover -------------------------
  const may = await pdfConCasilla('mayuscula');
  ok(latin1(may).includes('/S#ED'), 'el segundo fixture trae /S#ED en mayúscula');
  const resMay = await escribirPdfRenombrado(may, new Map([['casilla', 'chk_acepta']]), {});
  const onMay = encendido(await estadosDe(resMay.bytes));
  ok(onMay.asString() === '/S#ED', `el hex en mayúscula se respeta tal cual: got ${onMay.asString()}`);

  console.log(fail === 0 ? '\nOK' : `\n${fail} fallo(s)`);
  process.exit(fail === 0 ? 0 : 1);
})();
