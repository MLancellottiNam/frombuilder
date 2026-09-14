// Test de v2.0.0 — paquete de campos.
// Sintéticos para la forma, y el CSC real para medir la cobertura de texto: el
// paquete solo sirve si `etiqueta_impresa` viene llena en la mayoría de los
// campos, así que ese número es el criterio de éxito, no un detalle.

import fs from 'fs';
import path from 'path';
import { readPdfFields, type PdfLeaf } from '../src/lib/etapa0/pdfFields';
import { textItemDePdfjs, type TextItem } from '../src/lib/etapa0/textoPdf';
import {
  candidatasDeWidget,
  construirPaquete,
  cobertura,
  COLUMNAS_EXTERNAS,
  externasPorCampo,
  HEADERS_APP,
  HEADERS_PAQUETE,
  leerPaqueteAoa,
  paqueteAAoa,
  presembrarDesdeFicha,
  textoDeZona,
} from '../src/lib/etapa0/paquete';
import { buildFichaRaw, readFichaSheets } from '../src/lib/etapa0/fichaRaw';
import { derivarValidacion } from '../src/lib/etapa0/validaciones';

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

const t = (str: string, x: number, y: number, w = 40, page = 0): TextItem => ({
  str,
  page,
  x,
  y,
  w,
  rotado: false,
});

(async () => {
  // --- candidatas y zona ---------------------------------------------------
  {
    const texto = [
      t('1er Apellido:', 40, 500, 55),
      t('2do Apellido:', 200, 500, 55),
      t('_____', 300, 500, 30),
      t('otra línea', 40, 460, 50),
    ];
    const cands = candidatasDeWidget(0, { x: 100, y: 497, w: 80, h: 14 }, texto);
    ok(cands[0] === '1er Apellido:', `la más cercana primero (got ${cands[0]})`);
    ok(cands.includes('2do Apellido:'), 'la de la derecha también es candidata');
    ok(!cands.includes('_____'), 'un placeholder de guiones no es candidata');
    ok(!cands.includes('otra línea'), 'otra línea no entra en la ventana');

    const zona = textoDeZona(0, { x: 100, y: 497, w: 80, h: 14 }, texto);
    ok(zona.startsWith('1er Apellido:') && zona.includes('2do Apellido:'), `la zona junta la banda: «${zona}»`);
  }

  // --- una fila por widget -------------------------------------------------
  {
    const multi = leaf({
      name: 'compartido',
      readingIndex: 2,
      widgets: [
        { page: 0, rect: { x: 100, y: 500, w: 80, h: 14 } },
        { page: 1, rect: { x: 100, y: 300, w: 80, h: 14 } },
      ],
      paginas: [0, 1],
      multiWidgetSospechoso: true,
    });
    const simple = leaf({ name: 'solo', readingIndex: 1, rect: { x: 100, y: 700, w: 80, h: 14 } });
    const filas = construirPaquete({
      leaves: [simple, multi],
      nombreFinal: (i) => (i === 0 ? 'nombre_nuevo' : 'compartido'),
      texto: [],
    });
    ok(filas.length === 3, `2 campos con 3 widgets = 3 filas (got ${filas.length})`);
    ok(filas[0].nombre_actual === 'solo' && filas[0].nombre_nuevo === 'nombre_nuevo', 'el renombrado sale en col nombre_nuevo');
    ok(filas[1].nombre_nuevo === '', 'sin renombrar, nombre_nuevo queda vacío');
    ok(
      filas[1].multi_widget === '1 de 2 (págs 1,2)' && filas[2].multi_widget === '2 de 2 (págs 1,2)',
      `cada widget dice cuál es (got ${filas[1].multi_widget} / ${filas[2].multi_widget})`,
    );
    ok(filas[1]['#'] === filas[2]['#'], 'los dos widgets comparten el # del campo');
    ok(/colisión del PDF original/.test(filas[1].notas), 'el /Tx multi-widget queda anotado');
    ok(filas[0].pagina === 1 && filas[2].pagina === 2, 'la página sale 1-based');
    ok(
      filas[0].x === 100 && filas[0].y === 700 && filas[0].w === 80 && filas[0].h === 14,
      'el rect va en coordenadas PDF',
    );
  }

  // --- orden de lectura del widget, no del campo ---------------------------
  {
    const abajo = leaf({ name: 'abajo', readingIndex: 1, rect: { x: 50, y: 100, w: 40, h: 10 } });
    const arriba = leaf({ name: 'arriba', readingIndex: 2, rect: { x: 50, y: 700, w: 40, h: 10 } });
    const filas = construirPaquete({ leaves: [abajo, arriba], nombreFinal: (i) => [abajo, arriba][i].name, texto: [] });
    ok(filas[0].nombre_actual === 'arriba', 'las filas salen en orden de lectura del widget');
  }

  // --- creados, borrados y notas ------------------------------------------
  {
    const creado = leaf({ name: 'firma_cliente', ft: '/Sig', origen: 'creado', uid: 'u1' });
    const borrado = leaf({ name: 'sobra', readingIndex: 9 });
    const filas = construirPaquete({
      leaves: [creado],
      nombreFinal: () => 'firma_cliente',
      texto: [],
      borrados: [borrado],
      notaDeLeaf: () => 'aviso de la col M: grafía inconsistente',
    });
    ok(filas.length === 2, 'el borrado también entra al paquete');
    ok(filas[0].origen === 'creado' && filas[0].tipo === '/Sig', 'el creado se marca y lleva su tipo');
    ok(filas[1].origen === 'borrado' && /quitó del PDF/.test(filas[1].notas), 'el borrado se marca y se explica');
    ok(/col M/.test(filas[0].notas), 'la nota externa llega a la columna notas');
  }

  // --- headers y aoa -------------------------------------------------------
  {
    const filas = construirPaquete({ leaves: [leaf({ name: 'x' })], nombreFinal: () => 'x', texto: [] });
    const aoa = paqueteAAoa(filas);
    ok(aoa[0].length === HEADERS_PAQUETE.length && aoa[0][0] === '#', 'la primera fila del aoa son los headers');
    ok(aoa.length === 2 && aoa[1].length === HEADERS_PAQUETE.length, 'una fila de datos, del mismo ancho');
    ok(
      (HEADERS_APP as string[]).join(',') ===
        '#,nombre_actual,nombre_nuevo,tipo,pagina,x,y,w,h,etiqueta_impresa,etiquetas_candidatas,texto_zona,multi_widget,origen,notas',
      'las columnas de la app son las acordadas, en orden',
    );
    ok(
      COLUMNAS_EXTERNAS.join(',') === 'seccion,subseccion,label,ruta_json,required,validaciones,grupo,valor,instancia',
      'y después van las que se completan afuera',
    );
  }

  // --- ida y vuelta: las columnas de afuera NO se pierden -----------------
  {
    const uno = leaf({ name: 'campo_uno', readingIndex: 1 });
    const dos = leaf({ name: 'campo_dos', readingIndex: 2, rect: { x: 100, y: 400, w: 80, h: 14 } });
    const filas = construirPaquete({ leaves: [uno, dos], nombreFinal: (i) => [uno, dos][i].name, texto: [] });

    // así vuelve de la skill: con nombre_nuevo y con las columnas completadas
    const aoa = paqueteAAoa(filas).map((f) => [...f]);
    const h = (aoa[0] as string[]).map(String);
    const set = (fila: number, col: string, v: string) => (aoa[fila][h.indexOf(col)] = v);
    set(1, 'nombre_nuevo', 'asg_uno');
    set(1, 'seccion', 'Datos del cliente');
    set(1, 'ruta_json', 'datos.personas[0].uno');
    set(1, 'required', 'Both');
    set(1, 'validaciones', 'máximo 8 dígitos');
    // y con una columna que la app no conoce
    aoa[0].push('comentario_skill');
    aoa[1].push('revisar con el cliente');

    const leido = leerPaqueteAoa(aoa);
    ok(leido.filas.length === 2, 'lee las dos filas');
    ok(leido.filas[0].nombre_nuevo === 'asg_uno', 'y el nombre nuevo');
    ok(leido.filas[0].externas?.ruta_json === 'datos.personas[0].uno', 'con las columnas de afuera');
    ok(leido.filas[0].externas?.comentario_skill === 'revisar con el cliente', 'incluida una columna que la app no conoce');
    ok(leido.columnasExternas.includes('comentario_skill'), 'que se reporta como externa');

    // al reexportar TIENEN que seguir estando
    const vuelta = paqueteAAoa(leido.filas);
    const h2 = (vuelta[0] as string[]).map(String);
    ok(h2.includes('comentario_skill'), 'al reexportar, la columna desconocida sigue en el header');
    ok(
      String(vuelta[1][h2.indexOf('ruta_json')]) === 'datos.personas[0].uno' &&
        String(vuelta[1][h2.indexOf('comentario_skill')]) === 'revisar con el cliente',
      'y los valores de afuera siguen ahí: el archivo puede dar vueltas sin perder información',
    );

    const porCampo = externasPorCampo(leido.filas);
    ok(porCampo.get('campo_uno')?.seccion === 'Datos del cliente', 'las externas se indexan por nombre_actual');
    ok(!porCampo.has('campo_dos'), 'y una fila sin externas no ocupa lugar');

    // un archivo que no es el paquete
    const malo = leerPaqueteAoa([['cualquier', 'cosa']]);
    ok(malo.filas.length === 0 && malo.avisos.length === 1, 'un archivo que no es el paquete se rechaza');
  }

  // --- CSC real: cobertura de texto ---------------------------------------
  const F_PDF = path.resolve('fixtures/BUC_Formulario_Conozca_Cliente_Homologado.pdf');
  if (!fs.existsSync(F_PDF)) {
    console.log('\n(SKIP) fixture real no encontrado en fixtures/');
  } else {
    const bytes = new Uint8Array(fs.readFileSync(F_PDF));
    const pdf = await readPdfFields(bytes);
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const texto: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const it of tc.items) if (it?.str?.trim()) texto.push(textItemDePdfjs(it, p - 1));
    }
    const filas = construirPaquete({
      leaves: pdf.leaves,
      nombreFinal: (i) => pdf.leaves[i].name,
      texto,
    });
    const c = cobertura(filas);
    console.log(
      `\n--- CSC: ${pdf.leaves.length} campos / ${pdf.totalWidgets} widgets -> ${c.total} filas · ` +
        `${c.conEtiqueta} con etiqueta impresa · ${c.conZona} con texto de zona ---`,
    );
    ok(c.total === pdf.totalWidgets, `una fila por widget (got ${c.total} vs ${pdf.totalWidgets})`);
    // El piso es lo que la alineación anclaba por texto en v1.4.3: 67.
    ok(c.conEtiqueta >= 60, `al menos 60 con etiqueta impresa (got ${c.conEtiqueta})`);
    ok(c.conZona >= c.conEtiqueta, `el texto de zona cubre al menos lo mismo (got ${c.conZona})`);
    const sinNada = filas.filter((f) => !f.etiqueta_impresa && !f.etiquetas_candidatas && !f.texto_zona);
    console.log(`    widgets sin ningún texto alrededor: ${sinNada.length}`);
    ok(sinNada.length < c.total * 0.15, `menos del 15% queda sin texto alguno (got ${sinNada.length})`);
  }

  // --- presembrado desde la ficha (fixture SINTÉTICO, commiteado) ---------
  {
    const F = path.resolve('tests/fixtures/ficha-sintetica-col-n.xlsx');
    if (!fs.existsSync(F)) {
      console.log('\n(SKIP) falta tests/fixtures/ficha-sintetica-col-n.xlsx (npm run fixture:ficha)');
    } else {
      const ficha = buildFichaRaw(await readFichaSheets(fs.readFileSync(F)));
      console.log(
        `\n--- ficha sintética: ${new Set(ficha.rows.map((r) => r.hoja)).size} hojas · ${ficha.rows.length} filas · ` +
          `${ficha.rows.filter((r) => r.campoPdfInterno.trim()).length} con col N ---`,
      );
      ok(ficha.rows.length > 20, 'el fixture tiene filas de sobra para probar');
      ok(ficha.stats.excluidas >= 2, `y trae exclusiones reales (${ficha.stats.excluidas})`);
      ok(ficha.stats.filasNota >= 1, 'y una fila-nota');

      // los campos del PDF, con los nombres que la col N menciona
      const nombres = [
        ...new Set(
          ficha.rows.flatMap((r) =>
            r.campoPdfInterno
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ),
      ];
      const leaves = nombres.map((n, i) => leaf({ name: n, readingIndex: i + 1, rect: { x: 10, y: 700 - i * 20, w: 80, h: 12 } }));
      const filas = construirPaquete({ leaves, nombreFinal: (i) => leaves[i].name, texto: [] });

      const filasFicha = ficha.rows.map((x) => ({
        hoja: x.hoja,
        fila: x.fila,
        campoPdfInterno: x.campoPdfInterno,
        campoJson: x.campoJson,
        obligatorio: x.obligatorio,
        observaciones: x.observaciones,
        regla: x.regla,
        label: x.label,
        valor: x.valor,
      }));
      const r = presembrarDesdeFicha(filas, filasFicha, derivarValidacion);
      console.log(`    presembrado: ${r.tocadas} filas · ${r.avisos.length} avisos`);
      ok(r.tocadas > 10, `presiembra la mayoría de las filas (got ${r.tocadas})`);
      const conRuta = filas.filter((f) => f.externas?.ruta_json).length;
      ok(conRuta === r.tocadas || conRuta > 10, `${conRuta} filas quedan con ruta_json sugerida`);
      ok(
        filas.every((f) => !f.externas?.ruta_json || /presembrado desde la ficha/.test(f.notas)),
        'y cada una dice en «notas» que es una sugerencia de la ficha',
      );
      const conVal = filas.filter((f) => f.externas?.validaciones).length;
      ok(conVal > 3, `${conVal} filas con validaciones derivadas de las cols K y G`);

      // NO pisa lo que vino de afuera
      const yaResuelta = filas.find((f) => f.externas?.ruta_json)!;
      const decidido = { ...yaResuelta, externas: { ...yaResuelta.externas, ruta_json: 'lo.que.decidio.la.skill' } };
      const r2 = presembrarDesdeFicha([decidido], filasFicha, derivarValidacion);
      ok(
        decidido.externas.ruta_json === 'lo.que.decidio.la.skill',
        `no pisa una ruta que ya venía de afuera (got ${decidido.externas.ruta_json})`,
      );
      void r2;
    }
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
