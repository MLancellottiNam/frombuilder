// Test de la escritura del PDF renombrado.
// La ficha con col N y el reporte CSV eran de v1.5.0 y se borraron con el
// recorte a Etapa 0 (v3.0.0): la ficha ya no se reescribe —la col N la llena la
// skill— y el reporte lo reemplazó el paquete de campos, que tiene su propio
// test. Lo que queda acá es lo que sigue vivo: el PDF.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { readPdfFields } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado, capDA } from '../src/lib/etapa0/writePdf';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

/** PDF con jerarquía, valores cargados, tooltip y /DA gigante. */
async function buildPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const form = doc.getForm();

  const a = form.createTextField('Profesión');
  a.setText('dato viejo');
  a.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });

  const b = form.createTextField('padre.hijo');
  b.setText('otro dato');
  b.addToPage(p1, { x: 50, y: 650, width: 200, height: 20 });

  const c = form.createCheckBox('acepta');
  c.check();
  c.addToPage(p1, { x: 50, y: 600, width: 12, height: 12 });

  // tooltip + /DA con auto-size en el campo "Profesión"
  const dict = a.acroField.dict;
  dict.set(PDFName.of('TU'), PDFString.of('tooltip que miente'));
  dict.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));

  return doc.save();
}

/** Hoja de ficha mínima con el header de 14 columnas. */

(async () => {
  // --- capDA -------------------------------------------------------------
  ok(capDA('/Helv 0 Tf 0 g', 10) === '/Helv 10 Tf 0 g', 'capDA: auto-size (0) -> tope');
  ok(capDA('/Helv 18 Tf 0 g', 10) === '/Helv 10 Tf 0 g', 'capDA: 18pt -> tope');
  ok(capDA('/Helv 8 Tf 0 g', 10) === '/Helv 8 Tf 0 g', 'capDA: 8pt no se toca');

  // --- escritura del PDF --------------------------------------------------
  const original = await buildPdf();
  const antes = await readPdfFields(original);
  ok(antes.leaves.length === 3, `3 campos antes (got ${antes.leaves.length})`);
  ok(antes.leaves.some((l) => l.name === 'padre.hijo'), 'el nombre jerárquico se lee como padre.hijo');

  const renombres = new Map<string, string>([
    // renombrado circular: A pasa a llamarse como B y B como A
    ['Profesión', 'padre.hijo'],
    ['padre.hijo', 'detalle_domicilio_extranjero'],
    ['acepta', 'asg_acepta_terminos'],
  ]);
  const w = await escribirPdfRenombrado(original, renombres, { limitarFuente: true, tamanoFuente: 10 });
  ok(w.renombrados === 3, `3 campos renombrados (got ${w.renombrados})`);
  ok(w.limpiados >= 2, `al menos 2 campos traían valor (got ${w.limpiados})`);

  const despues = await readPdfFields(w.bytes);
  const nombres = despues.leaves.map((l) => l.name).sort();
  ok(despues.leaves.length === 3, `3 campos después (got ${despues.leaves.length})`);
  ok(
    JSON.stringify(nombres) === JSON.stringify(['asg_acepta_terminos', 'detalle_domicilio_extranjero', 'padre.hijo']),
    'los 3 nombres nuevos están, incluido el intercambio circular: ' + nombres.join(', '),
  );
  ok(
    despues.leaves.every((l) => l.ft === antes.leaves.find((x) => renombres.get(x.name) === l.name)?.ft),
    'cada campo conserva su /FT tras aplanar',
  );

  // valores / tooltip limpiados y /DA topeado
  const doc2 = await PDFDocument.load(w.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const acro = doc2.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!;
  const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray)!;
  ok(fields.size() === 3, `/AcroForm/Fields quedó plano con 3 entradas (got ${fields.size()})`);
  let conValor = 0;
  let conTU = 0;
  let conParent = 0;
  let daOk = 0;
  for (let i = 0; i < fields.size(); i++) {
    const d = doc2.context.lookup(fields.get(i)) as InstanceType<typeof PDFDict>;
    if (d.get(PDFName.of('V')) !== undefined) conValor++;
    if (d.get(PDFName.of('TU')) !== undefined) conTU++;
    if (d.get(PDFName.of('Parent')) !== undefined) conParent++;
    const da = d.lookup(PDFName.of('DA'));
    if (da instanceof PDFString && /\s10 Tf/.test(da.decodeText())) daOk++;
  }
  ok(conValor === 0, `ningún campo conserva /V (got ${conValor})`);
  ok(conTU === 0, `ningún campo conserva /TU (got ${conTU})`);
  ok(conParent === 0, `ningún campo conserva /Parent (got ${conParent})`);
  ok(daOk >= 1, `el /DA con auto-size quedó topeado a 10pt (got ${daOk})`);
  ok(acro.get(PDFName.of('NeedAppearances')) !== undefined, '/NeedAppearances quedó seteado');

  // --- Fix D: el assert de post-escritura no deja pasar duplicados ---------
  const conColision = new Map<string, string>([
    ['Profesión', 'mismo_nombre'],
    ['padre.hijo', 'mismo_nombre'],
  ]);
  let tiro = '';
  try {
    await escribirPdfRenombrado(original, conColision, {});
  } catch (e) {
    tiro = String(e);
  }
  ok(/duplicados/.test(tiro), 'escribir con nombres duplicados tira Error, no warning: ' + tiro.slice(0, 90));
  ok(/mismo_nombre/.test(tiro), 'el error nombra la colisión concreta');

  // Colisión contra un campo que NO se renombra (queda con su nombre original).
  let tiro2 = '';
  try {
    await escribirPdfRenombrado(original, new Map([['Profesión', 'acepta']]), {});
  } catch (e) {
    tiro2 = String(e);
  }
  ok(/duplicados/.test(tiro2), 'también detecta la colisión contra un campo sin renombrar');

  console.log(fail === 0 ? '\nOK — todos los asserts pasaron' : `\n${fail} assert(s) fallaron`);
  process.exit(fail === 0 ? 0 : 1);
})();
