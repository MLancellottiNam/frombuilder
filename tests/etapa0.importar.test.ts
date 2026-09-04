// Test de v2.0.0 — importar los nombres resueltos afuera.
// Lo que hay que garantizar: que NADA se aplique a medias, que un nombre
// repetido bloquee, y que lo editado a mano no se pise sin avisar.

import type { PdfLeaf } from '../src/lib/etapa0/pdfFields';
import { HEADERS_PAQUETE } from '../src/lib/etapa0/paquete';
import {
  importarColNDeFicha,
  importarDesdePaquete,
  partirTokens,
} from '../src/lib/etapa0/importarNombres';
import type { RawSheet } from '../src/lib/etapa0/fichaRaw';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

function leaf(name: string, extra: Partial<PdfLeaf> = {}): PdfLeaf {
  const rect = extra.rect ?? { x: 10, y: 700, w: 50, h: 12 };
  return {
    name,
    ft: extra.ft ?? '/Tx',
    page: 0,
    rect,
    widgets: extra.widgets ?? [{ page: 0, rect }],
    readingIndex: extra.readingIndex ?? 1,
    multiWidgetSospechoso: false,
    paginas: [0],
    ...extra,
  };
}

/** aoa de paquete con las columnas acordadas. */
function paquete(filas: Record<string, string>[]): string[][] {
  return [
    HEADERS_PAQUETE as string[],
    ...filas.map((f) => (HEADERS_PAQUETE as string[]).map((h) => f[h] ?? '')),
  ];
}

/** Hoja de ficha con el header de 14 columnas del INS. */
function hoja(name: string, filas: string[][]): RawSheet {
  // Los encabezados son los reales del INS: `fichaRaw` los detecta por alias.
  const header = [
    'Pasos formulario',
    'Sección',
    'Nombre en PDF',
    'Nombre del campo en formulario',
    'Tipo de dato',
    'Valor',
    'Regla',
    'Obligatorio',
    'Formulario',
    'Visualización',
    'Observaciones',
    'Sección JSON',
    'Campo JSON',
    'Nombre interno del campo en PDF',
  ];
  return { name, aoa: [['datosFormulario.' + name], header, ...filas] };
}

const F = (
  nombrePdf: string,
  valor = '',
  colN = '',
  campoJson = 'x',
  tipo = 'Texto',
): string[] => ['', 'Sección', nombrePdf, nombrePdf, tipo, valor, '', 'Sí', '', '', '', 'datos', campoJson, colN];

(async () => {
  // --- tokens --------------------------------------------------------------
  {
    ok(JSON.stringify(partirTokens('a, b ; c')) === JSON.stringify(['a', 'b', 'c']), 'parte por coma y punto y coma');
    ok(partirTokens('No aplica').length === 0, '«No aplica» es vacío, no un nombre de campo');
    ok(partirTokens('  ').length === 0, 'espacios son vacío');
  }

  // --- paquete -------------------------------------------------------------
  {
    const leaves = [leaf('Profesión'), leaf('cv_otro_tipoid'), leaf('sobra')];
    const r = importarDesdePaquete(
      paquete([
        { nombre_actual: 'Profesión', nombre_nuevo: 'asg_detalle_domicilio' },
        { nombre_actual: 'cv_otro_tipoid', nombre_nuevo: 'asg_otro_tipo_id' },
        { nombre_actual: 'fantasma', nombre_nuevo: 'no_existe' },
        { nombre_actual: 'sobra', nombre_nuevo: 'ignorado', origen: 'borrado' },
      ]),
      leaves,
    );
    ok(r.aplicar.length === 2, `aplica los 2 que matchean (got ${r.aplicar.length})`);
    ok(r.aplicar[0].nombreNuevo === 'asg_detalle_domicilio', 'con el nombre nuevo del paquete');
    ok(r.sinCampoEnPdf.length === 1 && /fantasma/.test(r.sinCampoEnPdf[0].valor), 'reporta el que no existe en el PDF');
    ok(r.camposSinNombre.length === 1 && r.camposSinNombre[0] === 'sobra', 'y el campo que el paquete no menciona');
    ok(r.colisiones.length === 0, 'sin colisiones');
    ok(r.aplicar.every((x) => /paquete fila \d+/.test(x.fuente)), 'cada renombre dice de qué fila salió');
  }

  // --- paquete: multi-widget = un solo nombre -----------------------------
  {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    const leaves = [
      leaf('compartido', {
        widgets: [
          { page: 0, rect },
          { page: 1, rect },
        ],
      }),
    ];
    const r = importarDesdePaquete(
      paquete([
        { nombre_actual: 'compartido', nombre_nuevo: 'uno', multi_widget: '1 de 2' },
        { nombre_actual: 'compartido', nombre_nuevo: 'uno', multi_widget: '2 de 2' },
      ]),
      leaves,
    );
    ok(r.aplicar.length === 1, 'dos filas del mismo campo dan un solo renombre');

    const r2 = importarDesdePaquete(
      paquete([
        { nombre_actual: 'compartido', nombre_nuevo: 'uno' },
        { nombre_actual: 'compartido', nombre_nuevo: 'dos' },
      ]),
      leaves,
    );
    ok(r2.aplicar.length === 1 && r2.aplicar[0].nombreNuevo === 'uno', 'si difieren, se aplica el primero');
    ok(/dos nombres nuevos distintos/.test(r2.avisos.join(' ')), 'y se avisa: un campo con varios widgets lleva UN nombre');
  }

  // --- paquete: colisión bloquea ------------------------------------------
  {
    const leaves = [leaf('a'), leaf('b'), leaf('ya_existe')];
    const r = importarDesdePaquete(
      paquete([
        { nombre_actual: 'a', nombre_nuevo: 'igual' },
        { nombre_actual: 'b', nombre_nuevo: 'igual' },
      ]),
      leaves,
    );
    ok(r.colisiones.length === 1 && r.colisiones[0] === 'igual', 'dos campos con el mismo nombre nuevo = colisión');

    // también colisiona contra un campo que NO se toca
    const r2 = importarDesdePaquete(paquete([{ nombre_actual: 'a', nombre_nuevo: 'ya_existe' }]), leaves);
    ok(
      r2.colisiones.length === 1 && r2.colisiones[0] === 'ya_existe',
      'y contra el nombre de un campo que el archivo no toca',
    );
  }

  // --- paquete: no pisa lo manual sin avisar ------------------------------
  {
    const leaves = [leaf('a'), leaf('b')];
    const r = importarDesdePaquete(
      paquete([
        { nombre_actual: 'a', nombre_nuevo: 'del_archivo' },
        { nombre_actual: 'b', nombre_nuevo: 'igual_al_manual' },
      ]),
      leaves,
      (n) => (n === 'a' ? 'puesto_a_mano' : n === 'b' ? 'igual_al_manual' : undefined),
    );
    ok(r.pisaManual.length === 1 && r.pisaManual[0].nombreActual === 'a', 'marca el que pisaría una edición manual');
    ok(!r.pisaManual.some((x) => x.nombreActual === 'b'), 'y no marca el que coincide con lo que ya había');
  }

  // --- archivo que no es un paquete ---------------------------------------
  {
    const r = importarDesdePaquete([['cualquier', 'cosa'], ['1', '2']], [leaf('a')]);
    ok(r.aplicar.length === 0 && /no parece un paquete/.test(r.avisos.join(' ')), 'un archivo que no es el paquete se rechaza entero');
  }

  // --- ficha: col N ------------------------------------------------------
  {
    const sheets = [
      hoja('personas', [
        F('1er Apellido', '', 'apellido1_asegurado'),
        F('Fecha de Nacimiento', 'dd/mm/aaaa', 'dia_nac, mes_nac, anio_nac'),
        F('Nacionalidad', '', 'No aplica'),
        F('Profesión', '', 'campo_que_no_existe'),
      ]),
    ];
    const leaves = [leaf('apellido1_asegurado'), leaf('dia_nac'), leaf('mes_nac'), leaf('anio_nac'), leaf('otro')];
    const r = importarColNDeFicha(sheets, leaves);

    const porActual = new Map(r.aplicar.map((x) => [x.nombreActual, x.nombreNuevo]));
    ok(porActual.get('apellido1_asegurado') === '1er_apellido', `el nombre sale de la col C (got ${porActual.get('apellido1_asegurado')})`);
    ok(
      porActual.get('dia_nac') === 'fecha_de_nacimiento_dia' &&
        porActual.get('mes_nac') === 'fecha_de_nacimiento_mes' &&
        porActual.get('anio_nac') === 'fecha_de_nacimiento_ano',
      `1:N con sufijos derivados del formato (got ${[...porActual.values()].join(', ')})`,
    );
    ok(!r.aplicar.some((x) => /Nacionalidad/i.test(x.nombreNuevo)), '«No aplica» no genera renombre');
    ok(
      r.sinCampoEnPdf.length === 1 && r.sinCampoEnPdf[0].valor === 'campo_que_no_existe',
      `reporta la col N que no matchea (got ${JSON.stringify(r.sinCampoEnPdf)})`,
    );
    ok(r.camposSinNombre.includes('otro'), 'y el campo del PDF que la ficha no menciona');
    ok(r.colisiones.length === 0, `sin colisiones (got ${r.colisiones.join(', ')})`);
  }

  // --- ficha: dos filas apuntando al mismo campo -------------------------
  {
    const sheets = [
      hoja('personas', [F('Uno', '', 'mismo_campo'), F('Dos', '', 'mismo_campo')]),
    ];
    const r = importarColNDeFicha(sheets, [leaf('mismo_campo')]);
    ok(/aparece en la col N de 2 filas/.test(r.avisos.join(' ')), 'dos filas al mismo campo se avisa, no se resuelve sola');
  }

  // --- ficha vacía --------------------------------------------------------
  {
    const sheets = [hoja('personas', [F('Uno'), F('Dos')])];
    const r = importarColNDeFicha(sheets, [leaf('a')]);
    ok(r.aplicar.length === 0 && /Ninguna fila/.test(r.avisos.join(' ')), 'una ficha sin col N lo dice claro');
  }

  // --- CSC real: ida y vuelta completa ------------------------------------
  {
    const fs = await import('fs');
    const path = await import('path');
    const F_PDF = path.resolve('fixtures/BUC_Formulario_Conozca_Cliente_Homologado.pdf');
    if (!fs.existsSync(F_PDF)) {
      console.log('\n(SKIP) fixture real no encontrado en fixtures/');
    } else {
      const { readPdfFields } = await import('../src/lib/etapa0/pdfFields');
      const { construirPaquete, paqueteAAoa } = await import('../src/lib/etapa0/paquete');
      const pdf = await readPdfFields(new Uint8Array(fs.readFileSync(F_PDF)));
      // el paquete que bajaría el usuario, con el mapeo ya resuelto afuera
      const filas = construirPaquete({
        leaves: pdf.leaves,
        nombreFinal: (i) => pdf.leaves[i].name,
        texto: [],
      }).map((f, k) => ({ ...f, nombre_nuevo: `campo_${k + 1}` }));
      const r = importarDesdePaquete(paqueteAAoa(filas), pdf.leaves);
      console.log(
        `\n--- CSC: ${filas.length} filas de paquete -> ${r.aplicar.length} renombres · ` +
          `${r.colisiones.length} colisiones · ${r.sinCampoEnPdf.length} sin campo · ${r.camposSinNombre.length} sin nombre ---`,
      );
      ok(r.aplicar.length === pdf.leaves.length, `un renombre por campo (got ${r.aplicar.length} de ${pdf.leaves.length})`);
      ok(r.camposSinNombre.length === 0, 'ningún campo queda sin nombre');
      ok(r.sinCampoEnPdf.length === 0, 'ninguna fila del paquete sobra');
      // los 4 widgets extra son de campos multi-widget: mismo campo, un nombre
      ok(
        filas.length - r.aplicar.length === pdf.totalWidgets - pdf.leaves.length,
        `las filas de más son exactamente los widgets de más (got ${filas.length - r.aplicar.length})`,
      );
      ok(r.avisos.some((a) => /varios widgets/.test(a)), 'y se avisa del caso multi-widget');
    }
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
