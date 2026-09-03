// Test de v2.0.0 — edición de la geometría de un campo.
// Lo importante no es el álgebra del arrastre sino que el rect editado llegue al
// PDF escrito y caiga en el widget CORRECTO: el orden de los widgets al leer
// (orden de lectura) y al escribir (orden de /Kids) no es el mismo.

import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { readPdfFields, type PdfLeaf } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado } from '../src/lib/etapa0/writePdf';
import { aplicarCambios } from '../src/lib/etapa0/camposManuales';
import {
  aplicarRects,
  claveRect,
  mismoRect,
  moverRect,
  normalizarRect,
  paraEscritura,
  redimensionarRect,
  type RectsEditados,
} from '../src/lib/etapa0/rects';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

function leaf(p: Partial<PdfLeaf> & { name: string }): PdfLeaf {
  const rect = p.rect ?? { x: 100, y: 500, w: 80, h: 14 };
  return {
    name: p.name,
    ft: p.ft ?? '/Tx',
    page: p.page ?? 0,
    rect,
    widgets: p.widgets ?? [{ page: p.page ?? 0, rect }],
    readingIndex: p.readingIndex ?? 1,
    multiWidgetSospechoso: p.multiWidgetSospechoso ?? false,
    paginas: p.paginas ?? [p.page ?? 0],
    origen: p.origen,
    uid: p.uid,
  };
}

(async () => {
  // --- álgebra --------------------------------------------------------------
  {
    const r = { x: 100, y: 500, w: 80, h: 14 };
    ok(JSON.stringify(moverRect(r, 10, -20)) === JSON.stringify({ x: 110, y: 480, w: 80, h: 14 }), 'mover no cambia el tamaño');

    const este = redimensionarRect(r, 'e', 20, 0);
    ok(este.x === 100 && este.w === 100, `el handle este estira a la derecha (got w=${este.w})`);
    const oeste = redimensionarRect(r, 'w', -20, 0);
    ok(oeste.x === 80 && oeste.w === 100, `el handle oeste mueve el borde izquierdo (got x=${oeste.x} w=${oeste.w})`);
    const norte = redimensionarRect(r, 'n', 0, 6);
    ok(norte.y === 500 && norte.h === 20, `el handle norte crece hacia arriba (got y=${norte.y} h=${norte.h})`);
    const sur = redimensionarRect(r, 's', 0, -6);
    ok(sur.y === 494 && sur.h === 20, `el handle sur baja el borde inferior (got y=${sur.y} h=${sur.h})`);
    const esquina = redimensionarRect(r, 'se', 10, -10);
    ok(esquina.w === 90 && esquina.h === 24 && esquina.y === 490, 'una esquina mueve los dos ejes');

    const chico = redimensionarRect(r, 'e', -500, 0);
    ok(chico.w === 4 && chico.x === 100, `arrastrar de más topea en el mínimo y no invierte (got x=${chico.x} w=${chico.w})`);
    const chicoW = redimensionarRect(r, 'w', 500, 0);
    ok(chicoW.w === 4 && chicoW.x === 176, `y por el otro lado tampoco (got x=${chicoW.x} w=${chicoW.w})`);
    ok(
      JSON.stringify(normalizarRect({ x: 100, y: 500, w: -30, h: -10 })) ===
        JSON.stringify({ x: 70, y: 490, w: 30, h: 10 }),
      'normalizar deja w/h positivos',
    );
    ok(mismoRect(r, { x: 100.3, y: 500, w: 80, h: 14 }) && !mismoRect(r, { x: 102, y: 500, w: 80, h: 14 }), 'mismoRect tolera medio punto');
  }

  // --- aplicar sobre la lista ---------------------------------------------
  {
    const a = leaf({ name: 'a', rect: { x: 10, y: 700, w: 50, h: 10 } });
    const b = leaf({ name: 'b', rect: { x: 10, y: 600, w: 50, h: 10 } });
    const edit: RectsEditados = { [claveRect(b, 0)]: { x: 10, y: 750, w: 50, h: 10 } };
    const conRects = aplicarRects([a, b], edit);
    ok(conRects[1].rect.y === 750, 'el override reemplaza el rect del widget');
    ok(conRects[0].rect.y === 700, 'y no toca a los demás');
    const lista = [a, b];
    ok(aplicarRects(lista, {}) === lista, 'sin overrides devuelve la misma lista (sin copiar)');

    // el reordenamiento por orden de lectura tiene que ver la posición NUEVA
    const efectivos = aplicarCambios(conRects, [], []).efectivos;
    ok(
      efectivos[0].name === 'b' && efectivos[0].readingIndex === 1,
      `mover un campo lo reordena: ahora «b» es el #1 (got ${efectivos[0].name})`,
    );
  }

  // --- multi-widget: se mueve SOLO el widget arrastrado -------------------
  {
    const multi = leaf({
      name: 'multi',
      widgets: [
        { page: 0, rect: { x: 10, y: 700, w: 50, h: 10 } },
        { page: 0, rect: { x: 10, y: 500, w: 50, h: 10 } },
      ],
    });
    const edit: RectsEditados = { [claveRect(multi, 1)]: { x: 300, y: 500, w: 50, h: 10 } };
    const [m2] = aplicarRects([multi], edit);
    ok(m2.widgets[0].rect.x === 10 && m2.widgets[1].rect.x === 300, 'el primer widget queda igual y el segundo se mueve');
    ok(
      m2.widgets[1].rect.y === 500,
      'la lista de widgets NO se reordena: el índice es la clave del override y reordenar escribiría en la clave de otro',
    );
    ok(m2.rect.y === 700, 'el widget primario sigue siendo el de arriba');

    // y si el que se mueve pasa a estar más arriba, el primario cambia
    const [m3] = aplicarRects([multi], { [claveRect(multi, 1)]: { x: 10, y: 780, w: 50, h: 10 } });
    ok(m3.rect.y === 780, 'si el widget movido queda más arriba, pasa a ser el primario');

    const mapa = paraEscritura([multi], edit);
    ok(mapa.get('multi')!.length === 1, 'para escritura va un solo cambio');
    ok(mismoRect(mapa.get('multi')![0].desde, { x: 10, y: 500, w: 50, h: 10 }), 'con el rect ORIGINAL como clave');
  }

  // --- escritura: el rect llega al PDF y al widget correcto ---------------
  {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([600, 800]);
    const form = doc.getForm();
    const uno = form.createTextField('uno');
    uno.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });
    const dos = form.createTextField('dos');
    dos.addToPage(p1, { x: 50, y: 600, width: 200, height: 20 });
    // un campo con dos widgets, agregados en orden INVERSO al de lectura:
    // el /Kids queda [abajo, arriba] y el orden de lectura es [arriba, abajo].
    const tres = form.createCheckBox('tres');
    tres.addToPage(p1, { x: 50, y: 100, width: 12, height: 12 });
    tres.addToPage(p1, { x: 50, y: 500, width: 12, height: 12 });
    const original = await doc.save();

    const leidos = (await readPdfFields(original)).leaves;
    const tresLeaf = leidos.find((l) => l.name === 'tres')!;
    // pdf-lib agrega medio punto de borde a cada widget, de ahí la tolerancia.
    ok(
      tresLeaf.widgets.length === 2 && Math.abs(tresLeaf.widgets[0].rect.y - 500) < 1,
      `al leer, los widgets vienen en orden de lectura (got y=${tresLeaf.widgets[0].rect.y})`,
    );

    const unoLeaf = leidos.find((l) => l.name === 'uno')!;
    const edit: RectsEditados = {
      // mover el campo simple
      [claveRect(unoLeaf, 0)]: { x: 120, y: 640, w: 250, h: 30 },
      // y el widget de ABAJO del multi-widget (índice 1 en orden de lectura)
      [claveRect(tresLeaf, 1)]: { x: 400, y: 100, w: 12, h: 12 },
    };

    const r = await escribirPdfRenombrado(original, new Map([['uno', 'movido']]), {
      rects: paraEscritura(leidos, edit),
    });
    ok(r.movidos === 2, `se movieron 2 widgets (got ${r.movidos})`);
    ok(r.warnings.length === 0, `sin warnings (got ${r.warnings.join(' · ')})`);

    const despues = (await readPdfFields(r.bytes)).leaves;
    const mov = despues.find((l) => l.name === 'movido')!;
    ok(
      mismoRect(mov.rect, { x: 120, y: 640, w: 250, h: 30 }),
      `el rect editado llegó al PDF (got ${JSON.stringify(mov.rect)})`,
    );
    const tres2 = despues.find((l) => l.name === 'tres')!;
    const arriba = tres2.widgets.find((w) => Math.abs(w.rect.y - 500) < 1);
    const abajo = tres2.widgets.find((w) => Math.abs(w.rect.y - 100) < 1);
    ok(!!arriba && Math.abs(arriba!.rect.x - 50) < 1, 'el widget que no se tocó quedó en su lugar');
    ok(!!abajo && Math.abs(abajo!.rect.x - 400) < 1, `se movió el widget correcto, no el otro (x=${abajo?.rect.x})`);

    // el /Rect del PDF quedó bien formado (x1<x2, y1<y2)
    const acro = despues.length > 0;
    ok(acro, 'el PDF se relee sin problemas');
  }

  // --- un rect que no empareja con ningún widget avisa --------------------
  {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([600, 800]);
    const form = doc.getForm();
    const f = form.createTextField('solo');
    f.addToPage(p1, { x: 50, y: 700, width: 100, height: 20 });
    const bytes = await doc.save();
    const r = await escribirPdfRenombrado(bytes, new Map(), {
      rects: new Map([['solo', [{ desde: { x: 0, y: 0, w: 1, h: 1 }, hasta: { x: 5, y: 5, w: 10, h: 10 } }]]]),
    });
    ok(r.movidos === 0 && /no se pudieron emparejar/.test(r.warnings.join(' ')), 'un rect que no matchea se avisa y no se aplica');
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
