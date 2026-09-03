// Test de v1.4.4 (a) — campos creados y borrados a mano.
// Cubre el modelo (lista efectiva, troceado, remapeo de índices) y la escritura
// del PDF: crear /Tx, /Btn y /Sig, borrar detectados, y el assert de conteo.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { readPdfFields, type PdfLeaf } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado } from '../src/lib/etapa0/writePdf';
import {
  aplicarCambios,
  trocearRect,
  remapearPorClave,
  claveEstable,
  type CampoCreado,
} from '../src/lib/etapa0/camposManuales';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const det = (name: string, page: number, y: number, x = 50, w = 100): PdfLeaf => ({
  name,
  ft: '/Tx',
  page,
  rect: { x, y, w, h: 12 },
  widgets: [{ page, rect: { x, y, w, h: 12 } }],
  readingIndex: 0,
  multiWidgetSospechoso: false,
  paginas: [page],
  origen: 'detectado',
});

const creado = (uid: string, nombre: string, page: number, y: number, x = 50): CampoCreado => ({
  uid,
  nombre,
  tipo: '/Tx',
  page,
  rect: { x, y, w: 80, h: 12 },
  filaClave: null,
});

/** PDF con 3 campos de texto en la página 1 y 1 en la página 2. */
async function buildPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField('uno').addToPage(p1, { x: 50, y: 700, width: 100, height: 20 });
  form.createTextField('dos').addToPage(p1, { x: 50, y: 650, width: 100, height: 20 });
  form.createTextField('tres').addToPage(p1, { x: 50, y: 600, width: 100, height: 20 });
  form.createTextField('cuatro').addToPage(p2, { x: 50, y: 700, width: 100, height: 20 });
  return doc.save();
}

(async () => {
  // --- lista efectiva ------------------------------------------------------
  {
    const detectados = [det('a', 0, 700), det('b', 0, 600), det('c', 1, 700)];
    const sin = aplicarCambios(detectados, [], []);
    ok(sin.efectivos.length === 3 && sin.borrados === 0 && sin.creados === 0, 'sin cambios, la lista es la detectada');
    ok(
      sin.efectivos.map((l) => l.readingIndex).join(',') === '1,2,3',
      'el readingIndex se recalcula 1-based',
    );

    const conBorrado = aplicarCambios(detectados, [], ['b']);
    ok(conBorrado.efectivos.map((l) => l.name).join(',') === 'a,c', 'el borrado sale de la lista');
    ok(conBorrado.borrados === 1, 'y se cuenta');
    ok(conBorrado.efectivos[1].readingIndex === 2, 'los índices se recomputan tras el borrado');

    // un campo creado se ordena por su POSICIÓN, no al final
    const conCreado = aplicarCambios(detectados, [creado('u1', 'nuevo', 0, 650)], []);
    ok(
      conCreado.efectivos.map((l) => l.name).join(',') === 'a,nuevo,b,c',
      `el creado cae en su lugar visual (got ${conCreado.efectivos.map((l) => l.name).join(',')})`,
    );
    ok(conCreado.efectivos[1].origen === 'creado' && conCreado.efectivos[1].uid === 'u1', 'y lleva origen y uid');
    ok(conCreado.efectivos[0].origen === 'detectado', 'los detectados conservan su origen');
  }

  // --- troceado ------------------------------------------------------------
  {
    const r = { x: 100, y: 500, w: 100, h: 12 };
    const tres = trocearRect(r, 3, 4);
    ok(tres.length === 3, '3 cajas');
    ok(Math.abs(tres[0].w - 30.666) < 0.01, `ancho parejo con gap 4 (got ${tres[0].w.toFixed(3)})`);
    ok(tres[0].x === 100, 'la primera arranca en el borde izquierdo');
    ok(
      Math.abs(tres[2].x + tres[2].w - (r.x + r.w)) < 0.01,
      `la última termina en el borde derecho (got ${(tres[2].x + tres[2].w).toFixed(2)})`,
    );
    ok(tres.every((c) => c.y === r.y && c.h === r.h), 'todas comparten Y y altura');
    ok(trocearRect(r, 1).length === 1, 'dividir en 1 devuelve el rect original');
    ok(trocearRect({ x: 0, y: 0, w: 5, h: 10 }, 4).length === 1, 'si no cabe, no se trocea');
  }

  // --- remapeo de índices --------------------------------------------------
  {
    const antes = [det('a', 0, 700), det('b', 0, 600), det('c', 1, 700)];
    const ediciones = { 0: 'nombre_a', 1: 'nombre_b', 2: 'nombre_c' };

    // insertar un campo en el medio corre los índices
    const despues = aplicarCambios(antes, [creado('u1', 'nuevo', 0, 650)], []).efectivos;
    const remap = remapearPorClave(ediciones, antes, despues);
    ok(remap[0] === 'nombre_a', 'el primero se mantiene');
    ok(remap[1] === undefined, 'el hueco del campo nuevo queda sin edición');
    ok(remap[2] === 'nombre_b', 'la edición de «b» sigue a «b», que ahora es el índice 2');
    ok(remap[3] === 'nombre_c', 'y la de «c» al índice 3');

    // borrar corre los índices para el otro lado
    const trasBorrar = aplicarCambios(antes, [], ['a']).efectivos;
    const remap2 = remapearPorClave(ediciones, antes, trasBorrar);
    ok(remap2[0] === 'nombre_b' && remap2[1] === 'nombre_c', 'tras borrar el primero, las ediciones se corren');

    // EL CASO BORDE: borrar un campo y crear otro con el MISMO nombre.
    // Si el remapeo fuera por nombre, la edición del borrado se reengancharía
    // al creado, que es otro campo.
    const bordeAntes = [det('x', 0, 700), det('y', 0, 600)];
    const edBorde = { 0: 'edicion_de_x', 1: 'edicion_de_y' };
    const bordeDespues = aplicarCambios(bordeAntes, [creado('u9', 'x', 0, 700)], ['x']).efectivos;
    ok(bordeDespues.length === 2, 'queda el detectado «y» y el creado «x»');
    const remapBorde = remapearPorClave(edBorde, bordeAntes, bordeDespues);
    const idxCreado = bordeDespues.findIndex((l) => l.uid === 'u9');
    ok(remapBorde[idxCreado] === undefined, 'el campo CREADO con el mismo nombre no hereda la edición del borrado');
    const idxY = bordeDespues.findIndex((l) => l.name === 'y');
    ok(remapBorde[idxY] === 'edicion_de_y', 'y la edición de «y» la sigue teniendo «y»');

    ok(claveEstable(bordeDespues[idxCreado]).startsWith('uid:'), 'la clave de un creado es su uid');
    ok(claveEstable(bordeDespues[idxY]) === 'pdf:y', 'y la de un detectado es su AcroName original');
  }

  // --- escritura: crear ----------------------------------------------------
  const original = await buildPdf();
  const antes = await readPdfFields(original);
  ok(antes.leaves.length === 4, `4 campos detectados (got ${antes.leaves.length})`);

  {
    const nuevos: CampoCreado[] = [
      { uid: 'f1', nombre: 'firma_cliente', tipo: '/Sig', page: 1, rect: { x: 60, y: 400, w: 200, h: 30 }, filaClave: null },
      { uid: 'c1', nombre: 'acepta_terminos', tipo: '/Btn', page: 1, rect: { x: 60, y: 350, w: 12, h: 12 }, filaClave: null },
      { uid: 't1', nombre: 'texto_extra', tipo: '/Tx', page: 0, rect: { x: 300, y: 700, w: 120, h: 14 }, filaClave: null },
    ];
    const w = await escribirPdfRenombrado(original, new Map(), { creados: nuevos });
    ok(w.creados === 3 && w.borrados === 0, `3 creados, 0 borrados (got ${w.creados}/${w.borrados})`);

    const r = await readPdfFields(w.bytes);
    ok(r.leaves.length === 7, `4 + 3 = 7 campos (got ${r.leaves.length})`);
    const porNombre = new Map(r.leaves.map((l) => [l.name, l]));
    ok(porNombre.get('firma_cliente')?.ft === '/Sig', `la firma sale como /Sig (got ${porNombre.get('firma_cliente')?.ft})`);
    ok(porNombre.get('acepta_terminos')?.ft === '/Btn', 'la casilla sale como /Btn');
    ok(porNombre.get('texto_extra')?.ft === '/Tx', 'el texto sale como /Tx');
    const f = porNombre.get('firma_cliente')!;
    ok(f.page === 1, `la firma quedó en la página 2 (got ${f.page + 1})`);
    ok(
      Math.abs(f.rect.x - 60) < 0.5 && Math.abs(f.rect.y - 400) < 0.5 && Math.abs(f.rect.w - 200) < 0.5,
      `y en el rect dibujado (got ${JSON.stringify(f.rect)})`,
    );

    // estructura mínima del /Btn y SigFlags del AcroForm
    const doc2 = await PDFDocument.load(w.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    const acro = doc2.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!;
    ok(acro.get(PDFName.of('SigFlags')) !== undefined, 'con un /Sig el AcroForm declara SigFlags');
    const flat = acro.lookupMaybe(PDFName.of('Fields'), PDFArray)!;
    ok(flat.size() === 7, `/AcroForm/Fields tiene los 7 (got ${flat.size()})`);
    let btnOk = false;
    for (let i = 0; i < flat.size(); i++) {
      const d = doc2.context.lookup(flat.get(i)) as InstanceType<typeof PDFDict>;
      if (d.get(PDFName.of('FT'))?.toString() !== '/Btn') continue;
      btnOk = d.get(PDFName.of('AS'))?.toString() === '/Off' && d.get(PDFName.of('AP')) !== undefined;
    }
    ok(btnOk, 'la casilla creada tiene /AS /Off y /AP');
    // los creados están en el /Annots de SU página
    const p2annots = doc2.getPages()[1].node.lookupMaybe(PDFName.of('Annots'), PDFArray)!;
    ok(p2annots.size() === 3, `la página 2 tiene 1 detectado + 2 creados (got ${p2annots.size()})`);
  }

  // --- escritura: borrar ---------------------------------------------------
  {
    const w = await escribirPdfRenombrado(original, new Map(), { borrados: ['dos'] });
    ok(w.borrados === 1, `1 borrado (got ${w.borrados})`);
    const r = await readPdfFields(w.bytes);
    ok(r.leaves.length === 3, `quedan 3 campos (got ${r.leaves.length})`);
    ok(!r.leaves.some((l) => l.name === 'dos'), 'el campo borrado no está');

    // y su anotación no quedó colgada en el /Annots de la página
    const doc2 = await PDFDocument.load(w.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    const annots = doc2.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray)!;
    ok(annots.size() === 2, `la página 1 pasa de 3 a 2 anotaciones (got ${annots.size()})`);
    let colgada = false;
    for (let i = 0; i < annots.size(); i++) {
      const e = annots.get(i);
      const d = e instanceof PDFRef ? doc2.context.lookup(e) : e;
      if (!(d instanceof PDFDict)) colgada = true;
    }
    ok(!colgada, 'no quedaron referencias colgadas');
  }

  // --- borrar y crear en la misma pasada -----------------------------------
  {
    const w = await escribirPdfRenombrado(
      original,
      new Map([['uno', 'renombrado_uno']]),
      {
        borrados: ['dos', 'tres'],
        creados: [
          { uid: 'a', nombre: 'caja_dia', tipo: '/Tx', page: 0, rect: { x: 50, y: 650, w: 30, h: 12 }, filaClave: null },
          { uid: 'b', nombre: 'caja_mes', tipo: '/Tx', page: 0, rect: { x: 84, y: 650, w: 30, h: 12 }, filaClave: null },
          { uid: 'c', nombre: 'caja_ano', tipo: '/Tx', page: 0, rect: { x: 118, y: 650, w: 32, h: 12 }, filaClave: null },
        ],
      },
    );
    ok(w.campos === 5, `4 - 2 + 3 = 5 campos (got ${w.campos})`);
    const r = await readPdfFields(w.bytes);
    const nombres = r.leaves.map((l) => l.name).sort();
    ok(
      JSON.stringify(nombres) === JSON.stringify(['caja_ano', 'caja_dia', 'caja_mes', 'cuatro', 'renombrado_uno']),
      `los 5 nombres esperados (got ${nombres.join(', ')})`,
    );
    ok(new Set(nombres).size === nombres.length, 'y todos únicos');
  }

  // --- el assert de post-escritura sigue atrapando duplicados --------------
  {
    let tiro = '';
    try {
      await escribirPdfRenombrado(original, new Map(), {
        creados: [{ uid: 'z', nombre: 'uno', tipo: '/Tx', page: 0, rect: { x: 400, y: 700, w: 50, h: 12 }, filaClave: null }],
      });
    } catch (e) {
      tiro = String(e);
    }
    ok(/duplicados/.test(tiro), 'crear un campo con el nombre de uno existente tira Error: ' + tiro.slice(0, 70));
  }

  // --- borrar algo que no existe avisa, no rompe ---------------------------
  {
    const w = await escribirPdfRenombrado(original, new Map(), { borrados: ['no_existe'] });
    ok(w.borrados === 0, 'borrar un campo inexistente no cuenta');
    ok(w.warnings.some((x) => /no están en el PDF/.test(x)), 'y se avisa');
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
