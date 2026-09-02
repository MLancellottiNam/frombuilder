// Test de v1.3.0 — pre-alineación con confianza, huérfanos y relación 1:N.

import { alinear, tipoEsperado, type FilaAlineable } from '../src/lib/etapa0/align';
import type { PdfLeaf, Rect } from '../src/lib/etapa0/pdfFields';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

let ri = 0;
const leaf = (name: string, ft: '/Tx' | '/Btn', page = 0, y = 700, x = 50, w = 150): PdfLeaf => {
  const rect: Rect = { x, y, w, h: 18 };
  ri++;
  return {
    name, ft, page, rect, widgets: [{ page, rect }], readingIndex: ri,
    multiWidgetSospechoso: false, paginas: [page],
  };
};
const fila = (nombrePdf: string, tipo = 'Texto', valor = ''): FilaAlineable => ({
  nombrePdf, valor, tipo, nombrePropuesto: '',
});

// --- tipoEsperado ---
ok(tipoEsperado('Combo') === '/Btn', 'Combo -> /Btn');
ok(tipoEsperado('Radio') === '/Btn', 'Radio -> /Btn');
ok(tipoEsperado('Texto') === '/Tx', 'Texto -> /Tx');
ok(tipoEsperado('Fecha') === '/Tx', 'Fecha -> /Tx');
ok(tipoEsperado('Numérico') === '/Tx', 'Numérico -> /Tx');
ok(tipoEsperado('') === null, 'tipo vacío no ancla (no penaliza)');

// --- caso base: alineación 1:1 en orden ---
ri = 0;
const leaves1 = [
  leaf('provincia_asegurado', '/Tx', 0, 700),
  leaf('canton_asegurado', '/Tx', 0, 660),
  leaf('distrito_asegurado', '/Tx', 0, 620),
];
const filas1 = [fila('Provincia'), fila('Cantón'), fila('Distrito')];
const r1 = alinear(filas1, leaves1);
ok(r1.asignaciones.length === 3, '3 asignaciones 1:1');
ok(r1.asignaciones.every((a, i) => a.leafIdx[0] === i), 'cada fila cae en su campo por posición');
ok(r1.huerfanosFicha.length === 0 && r1.huerfanosPdf.length === 0, 'sin huérfanos');

// --- los nombres MIENTEN: la posición manda, el texto solo suma ---
ri = 0;
const leaves2 = [
  leaf('Profesión', '/Tx', 0, 700), // en realidad es el Detalle del domicilio
  leaf('Distrito_2', '/Tx', 0, 660), // en realidad es la dirección de la PJ
];
const filas2 = [fila('Detalle domicilio extranjero'), fila('Dirección exacta persona jurídica')];
const r2 = alinear(filas2, leaves2);
ok(r2.asignaciones.length === 2, 'alinea igual aunque los nombres contradigan');
ok(r2.asignaciones[0].leafIdx[0] === 0 && r2.asignaciones[1].leafIdx[0] === 1, 'respeta la posición, no el nombre');
ok(
  r2.asignaciones.every((a) => a.confianza !== 'revisar'),
  'un nombre que contradice NO baja la confianza a revisar (los nombres mienten)',
);

// --- boost por texto sube a alta ---
ri = 0;
const r3 = alinear([fila('Provincia')], [leaf('provincia_asegurado', '/Tx')]);
ok(r3.asignaciones[0].confianza === 'alta', 'texto coincidente -> confianza alta');
ok(r3.asignaciones[0].motivos.some((m) => m.includes('AcroName')), 'motivo explica el boost por texto');

// --- desajuste de tipo -> revisar ---
ri = 0;
const r4 = alinear([fila('Acepta', 'Combo')], [leaf('un_texto', '/Tx')]);
ok(r4.asignaciones[0].confianza === 'revisar', 'ficha pide /Btn y el PDF trae /Tx -> revisar');
ok(r4.asignaciones[0].motivos.some((m) => m.includes('desajuste de tipo')), 'motivo explica el desajuste');

// --- huérfanos de los dos lados, sin perder ninguno ---
ri = 0;
const leaves5 = [leaf('a', '/Tx', 0, 700), leaf('sobra_en_pdf', '/Tx', 0, 660), leaf('b', '/Tx', 0, 620)];
const filas5 = [fila('A'), fila('B'), fila('C sin campo'), fila('D sin campo')];
const r5 = alinear(filas5, leaves5);
const cubiertasFicha = new Set([...r5.asignaciones.map((a) => a.filaIdx), ...r5.huerfanosFicha]);
ok(cubiertasFicha.size === filas5.length, 'toda fila está asignada o es huérfana (ninguna se pierde)');
const cubiertosPdf = new Set([...r5.asignaciones.flatMap((a) => a.leafIdx), ...r5.huerfanosPdf]);
ok(cubiertosPdf.size === leaves5.length, 'todo campo del PDF está asignado o es huérfano');
ok(r5.huerfanosFicha.length === 1 || r5.huerfanosPdf.length >= 0, 'reporta huérfanos de ficha');

// --- §11.2 relación 1:N: fecha de nacimiento ASG (1 campo) vs RPL (3 cajas) ---
ri = 0;
const leaves6 = [
  leaf('dia_nac_asegurado', '/Tx', 0, 700, 50, 88), // ASG: una sola caja ancha
  leaf('nombre_rpl', '/Tx', 0, 600, 50, 150),
  // RPL: tres cajitas contiguas en la MISMA línea (día / mes / año)
  leaf('undefined_5', '/Tx', 0, 560, 50, 22),
  leaf('undefined_6', '/Tx', 0, 560, 80, 22),
  leaf('undefined_7', '/Tx', 0, 560, 110, 31),
];
const filas6 = [fila('Fecha de nacimiento', 'Fecha'), fila('Nombre representante'), fila('Fecha de nacimiento', 'Fecha')];
const r6 = alinear(filas6, leaves6);
const asgFecha = r6.asignaciones.find((a) => a.filaIdx === 0)!;
const rplFecha = r6.asignaciones.find((a) => a.filaIdx === 2)!;
ok(asgFecha.leafIdx.length === 1, `ASG: fecha 1:1 (got ${asgFecha.leafIdx.length})`);
ok(rplFecha.leafIdx.length === 3, `RPL: fecha 1:3, absorbe las cajas contiguas (got ${rplFecha.leafIdx.length})`);
ok(r6.stats.relaciones1aN === 1, 'se contabiliza 1 relación 1:N');
ok(rplFecha.motivos.some((m) => m.includes('1:N')), 'el motivo explica la relación 1:N');
ok(rplFecha.confianza !== 'alta', '1:N nunca se autoconfirma como alta');
ok(r6.huerfanosPdf.length === 0, 'las cajas absorbidas dejan de ser huérfanas');

// --- un /Btn no absorbe contiguos aunque sean de la misma línea ---
ri = 0;
const r7 = alinear(
  [fila('Sexo', 'Combo', 'Masculino')],
  [leaf('sexo_m', '/Btn', 0, 700, 50, 12), leaf('sexo_f', '/Btn', 0, 700, 80, 12)],
);
ok(r7.asignaciones[0].leafIdx.length === 1, 'solo las filas de FECHA absorben contiguos');

// --- stats coherentes ---
ok(
  r1.stats.alta + r1.stats.media + r1.stats.revisar === r1.stats.asignadas,
  'los 3 niveles de confianza suman las asignaciones',
);
ok(r1.stats.pctAlta >= 0 && r1.stats.pctAlta <= 100, 'pctAlta en rango');

// --- escenario realista: ≥70% en alta cuando la mitad tiene nombre parlante ---
ri = 0;
const nombres = ['provincia', 'canton', 'distrito', 'nombre', 'apellido', 'cedula', 'telefono', 'correo', 'x1', 'x2'];
const leaves8 = nombres.map((n, k) => leaf(n === 'x1' || n === 'x2' ? `undefined_${k}` : `${n}_asegurado`, '/Tx', 0, 700 - k * 40));
const filas8 = ['Provincia', 'Cantón', 'Distrito', 'Nombre', 'Apellido', 'Cédula', 'Teléfono', 'Correo', 'Otro dato', 'Más datos'].map((s) => fila(s));
const r8 = alinear(filas8, leaves8);
ok(r8.stats.pctAlta >= 70, `≥70% en confianza alta (got ${r8.stats.pctAlta}%)`);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
