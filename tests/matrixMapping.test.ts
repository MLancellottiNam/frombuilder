// Regresión de Etapa 1: agregar las columnas C y L al mapeo NO debe cambiar
// la resolución de las columnas que ya usaba readMatrix.

import { guessMatrixMapping } from '../src/lib/matrix';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

// Header real de una hoja de nodo del INS (14 columnas A–N).
const INS = [
  'Pasos Formulario',
  'Sección',
  'Nombre en PDF',
  'Nombre del campo en formulario',
  'Tipo de dato',
  'Valor',
  'Regla',
  'Obligatorio',
  'Formulario a visualizar',
  'Visualización en Formularios',
  'Observaciones',
  'Nombre de la sección del JSON',
  'Nombre del campo en el JSON',
  'Nombre interno del campo en PDF',
];

const m = guessMatrixMapping(INS);

// --- lo que ya funcionaba (no debe cambiar) ---
ok(m.section === 'Pasos Formulario', 'section = Pasos Formulario');
ok(m.subsection === 'Sección', 'subsection = Sección (no se la roba "sección del JSON")');
ok(m.label === 'Nombre del campo en formulario', 'label = col D');
ok(m.type === 'Tipo de dato', 'type = col E');
ok(m.value === 'Valor', 'value = col F');
ok(m.condition === 'Regla', 'condition = col G');
ok(m.required === 'Obligatorio', 'required = col H');
ok(m.visualization === 'Visualización en Formularios', 'visualization = col J');
ok(m.path === 'Nombre del campo en el JSON', 'path = col M (no col L)');
ok(m.sourceName === 'Nombre interno del campo en PDF', 'sourceName = col N (no col C)');

// --- lo nuevo ---
ok(m.nombrePdf === 'Nombre en PDF', 'nombrePdf = col C');
ok(m.seccionJson === 'Nombre de la sección del JSON', 'seccionJson = col L');

// --- variante: ficha ya mapeada (header sin "interno"), como Book1_MAPEADO ---
const MAPEADO = [...INS.slice(0, 13), 'Nombre del campo en el PDF '];
const m2 = guessMatrixMapping(MAPEADO);
ok(m2.sourceName === 'Nombre del campo en el PDF ', 'variante MAPEADO: sourceName = col N');
ok(m2.subsection === 'Sección', 'variante MAPEADO: subsection intacta');
ok(m2.path === 'Nombre del campo en el JSON', 'variante MAPEADO: path = col M');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
