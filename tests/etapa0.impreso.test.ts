// Test de v2.0.0 — PDF con los nombres impresos encima.
// La verificación de verdad es extraer el texto del PDF resultante con pdfjs y
// encontrar los nombres ahí: si los rótulos no son texto extraíble, tampoco son
// legibles para una persona.

import { PDFDocument } from 'pdf-lib';
import { readPdfFields } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado } from '../src/lib/etapa0/writePdf';
import { escribirPdfConNombresImpresos, sanearWinAnsi } from '../src/lib/etapa0/writePdfImpreso';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

async function buildPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  const form = doc.getForm();

  const a = form.createTextField('uno');
  a.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });
  const b = form.createTextField('dos');
  b.addToPage(p1, { x: 50, y: 640, width: 200, height: 20 });
  // pegado al borde de arriba: el rótulo tiene que irse abajo
  const c = form.createTextField('tres');
  c.addToPage(p2, { x: 50, y: 795, width: 100, height: 4 });
  return doc.save();
}

async function textoPorPagina(bytes: Uint8Array): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(tc.items.map((i: any) => i.str ?? '').join(' '));
  }
  return out;
}

(async () => {
  // --- saneado -------------------------------------------------------------
  {
    ok(sanearWinAnsi('profesión_ok').cambiado === false, 'un acento pasa: Helvetica codifica WinAnsi');
    const s = sanearWinAnsi('casilla_☐_rara');
    ok(s.cambiado && s.texto === 'casilla_?_rara', `un carácter fuera de WinAnsi se reemplaza (got ${s.texto})`);
  }

  const original = await buildPdf();

  // --- sobre el PDF ya renombrado -----------------------------------------
  const renombrado = await escribirPdfRenombrado(
    original,
    new Map([
      ['uno', 'asg_primer_apellido'],
      ['dos', 'asg_profesión'],
    ]),
  );
  const leaves = (await readPdfFields(renombrado.bytes)).leaves;

  const r = await escribirPdfConNombresImpresos(
    renombrado.bytes,
    leaves.map((l) => ({ nombre: l.name, indice: l.readingIndex, page: l.page, rect: l.rect, tipo: l.ft })),
  );
  ok(r.dibujados === leaves.length, `rotula todos los campos (got ${r.dibujados} de ${leaves.length})`);
  ok(r.warnings.length === 0, `sin warnings (got ${r.warnings.join(' · ')})`);

  const paginas = await textoPorPagina(r.bytes);
  ok(/asg_primer_apellido/.test(paginas[0]), 'el nombre queda como texto extraíble en su página');
  ok(/asg_profesión/.test(paginas[0]), 'y también el que tiene acento');
  ok(/\b1\.\s*asg_primer_apellido/.test(paginas[0].replace(/\s+/g, ' ')), 'el rótulo lleva el # del paquete adelante');
  ok(/tres/.test(paginas[1]), 'el campo de la página 2 se rotula en la página 2');
  ok(!/tres/.test(paginas[0]), 'y no en la 1');

  // --- no rompe el AcroForm ------------------------------------------------
  {
    const despues = await readPdfFields(r.bytes);
    ok(
      despues.leaves.length === leaves.length,
      `el AcroForm queda intacto: ${despues.leaves.length} campos (esperado ${leaves.length})`,
    );
    ok(
      despues.leaves.map((l) => l.name).sort().join(',') === leaves.map((l) => l.name).sort().join(','),
      'con los mismos nombres',
    );
    const antes = leaves.find((l) => l.name === 'asg_primer_apellido')!.rect;
    const ahora = despues.leaves.find((l) => l.name === 'asg_primer_apellido')!.rect;
    ok(
      antes.x === ahora.x && antes.y === ahora.y && antes.w === ahora.w && antes.h === ahora.h,
      'y con el mismo rect: dibujar no mueve los campos',
    );
  }

  // --- página inexistente: avisa, no explota ------------------------------
  {
    const x = await escribirPdfConNombresImpresos(renombrado.bytes, [
      { nombre: 'fantasma', page: 99, rect: { x: 0, y: 0, w: 10, h: 10 } },
    ]);
    ok(x.dibujados === 0 && /no existe/.test(x.warnings[0] ?? ''), 'un campo en una página que no existe se avisa');
  }

  // --- sin índice ----------------------------------------------------------
  {
    const x = await escribirPdfConNombresImpresos(
      renombrado.bytes,
      [{ nombre: 'sin_indice', indice: 1, page: 0, rect: { x: 300, y: 400, w: 80, h: 12 } }],
      { conIndice: false, tamano: 7 },
    );
    const t = (await textoPorPagina(x.bytes))[0].replace(/\s+/g, ' ');
    ok(/sin_indice/.test(t) && !/1\. sin_indice/.test(t), 'con conIndice:false el rótulo va sin número');
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
