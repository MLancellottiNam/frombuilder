// Test de v1.1.0 — walk crudo del AcroForm + orden de lectura (page, -Y, X).
// Genera un PDF sintético donde el orden NATIVO del diccionario está desordenado
// a propósito (como el CSC: provincia #35, distrito #37, cantón #85).
// El fixture real del cliente es opcional.

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from 'pdf-lib';
import { readPdfFields, compareReadingOrder } from '../src/lib/etapa0/pdfFields';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

async function build(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  const form = doc.getForm();

  // Se crean en orden DESORDENADO respecto a la posición visual.
  // Visualmente en p1, de arriba hacia abajo: provincia(y=700) canton(y=650) distrito(y=600)
  form.createTextField('provincia_asegurado').addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });
  form.createTextField('distrito_asegurado').addToPage(p1, { x: 50, y: 600, width: 200, height: 20 });
  form.createTextField('canton_asegurado').addToPage(p1, { x: 50, y: 650, width: 200, height: 20 });
  // Misma fila (mismo Y): debe ordenar por X.
  form.createTextField('izquierda').addToPage(p1, { x: 50, y: 500, width: 100, height: 20 });
  form.createTextField('derecha').addToPage(p1, { x: 300, y: 500, width: 100, height: 20 });
  // Checkbox -> /Btn
  form.createCheckBox('acepta').addToPage(p1, { x: 50, y: 400, width: 12, height: 12 });
  // Campo en la página 2: siempre después de los de p1.
  form.createTextField('firma_nombre').addToPage(p2, { x: 50, y: 700, width: 200, height: 20 });

  return doc.save();
}

async function buildJerarquico(): Promise<Uint8Array> {
  // Campo con nombre jerárquico y un nodo con 2 widgets (mismo campo, 2 lugares).
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const form = doc.getForm();
  const tf = form.createTextField('padre.hijo');
  tf.addToPage(p1, { x: 50, y: 700, width: 100, height: 20 });
  tf.addToPage(p1, { x: 50, y: 300, width: 100, height: 20 }); // 2do widget
  return doc.save();
}

(async () => {
  // --- orden de lectura ---
  const res = await readPdfFields(await build());
  const names = res.leaves.map((l) => l.name);
  console.log('orden:', names.join(' → '));

  ok(res.leaves.length === 7, `7 leaves (got ${res.leaves.length})`);
  ok(res.pageCount === 2, '2 páginas');

  const iProv = names.indexOf('provincia_asegurado');
  const iCant = names.indexOf('canton_asegurado');
  const iDist = names.indexOf('distrito_asegurado');
  ok(iProv < iCant && iCant < iDist, 'orden (page,-Y,X): provincia → cantón → distrito consecutivos');
  ok(iCant === iProv + 1 && iDist === iCant + 1, 'y son consecutivos, sin nada en el medio');

  ok(names.indexOf('izquierda') < names.indexOf('derecha'), 'misma fila -> ordena por X');
  ok(names.indexOf('firma_nombre') === names.length - 1, 'la página 2 va después de toda la página 1');

  ok(res.leaves.find((l) => l.name === 'acepta')?.ft === '/Btn', 'checkbox -> /Btn');
  ok(res.leaves.find((l) => l.name === 'provincia_asegurado')?.ft === '/Tx', 'texto -> /Tx');
  ok(res.leaves.every((l) => l.readingIndex >= 1), 'readingIndex asignado 1-based');
  ok(res.warnings.some((w) => w.includes('/Sig')), 'reporta la ausencia de campos de firma');

  // rect coherente con lo que se creó
  const prov = res.leaves.find((l) => l.name === 'provincia_asegurado')!;
  ok(Math.abs(prov.rect.x - 50) < 1 && Math.abs(prov.rect.y - 700) < 1, 'rect en coordenadas PDF (origen abajo-izq)');
  // pdf-lib agrega 0.5pt de borde al widget: 200x20 -> 201x21.
ok(Math.abs(prov.rect.w - 200) <= 1.5 && Math.abs(prov.rect.h - 20) <= 1.5, 'ancho/alto del rect (tolerancia por el borde de 0.5pt)');
  ok(prov.page === 0, 'página 0-based');

  // --- jerárquico + multi-widget ---
  const res2 = await readPdfFields(await buildJerarquico());
  ok(res2.leaves.length === 1, `campo con 2 widgets = 1 leaf (got ${res2.leaves.length})`);
  ok(res2.leaves[0].widgets.length === 2, '2 widgets en el mismo campo');
  ok(res2.totalWidgets === 2, 'totalWidgets cuenta los widgets, no los campos');
  ok(Math.abs(res2.leaves[0].rect.y - 700) <= 1, 'el widget primario es el de arriba (primero en orden de lectura)');

  // --- comparador puro ---
  const c = compareReadingOrder({ page: 0, rect: { x: 0, y: 700, w: 10, h: 10 } }, { page: 0, rect: { x: 0, y: 600, w: 10, h: 10 } });
  ok(c < 0, 'comparador: Y mayor va primero');
  const c2 = compareReadingOrder({ page: 0, rect: { x: 10, y: 0, w: 1, h: 1 } }, { page: 1, rect: { x: 0, y: 999, w: 1, h: 1 } });
  ok(c2 < 0, 'comparador: la página manda sobre Y');

  // --- fixture real (opcional) ---
  const FIXTURE = path.resolve('fixtures/BUC_Formulario_Conozca_Cliente_Homologado.pdf');
  if (fs.existsSync(FIXTURE)) {
    const real = await readPdfFields(fs.readFileSync(FIXTURE));
    console.log('\n--- CSC real ---');
    console.log(`leaves=${real.leaves.length} widgets=${real.totalWidgets} páginas=${real.pageCount}`);
    console.log('duplicados:', JSON.stringify(real.duplicados));
    ok(real.leaves.length === 115, `CSC: 115 leaves (got ${real.leaves.length})`);
    ok(real.pageCount === 2, `CSC: 2 páginas (got ${real.pageCount})`);
    ok(real.leaves.filter((l) => l.ft === '/Sig').length === 0, 'CSC: 0 campos /Sig');
    const n = real.leaves.map((l) => l.name);
    const ip = n.indexOf('provincia_asegurado');
    const ic = n.indexOf('canton_asegurado');
    const id = n.indexOf('distrito_asegurado');
    ok(ip >= 0 && ic === ip + 1 && id === ic + 1, `CSC: provincia→cantón→distrito consecutivos (${ip},${ic},${id})`);
  } else {
    console.log(`\n(SKIP) fixture real no encontrado: ${FIXTURE}`);
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
