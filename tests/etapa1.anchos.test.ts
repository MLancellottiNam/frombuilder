// Test de v3.0.0 — anchos derivados del rect del main y validaciones de la col K.
// El fixture real es el main del CSC: los números de la escala se miden ahí, no
// contra rects inventados.

import fs from 'fs';
import path from 'path';
import type { AcroField } from '../src/types';
import { anchoDeCampo, anchoUtil, escalonDeAncho, rectDeAcro } from '../src/lib/etapa1/anchos';
import {
  derivarValidacion,
  PATRON_CORREO,
  PATRON_NUMERICO,
} from '../src/lib/etapa1/validaciones';
import { extractAcroFromForm } from '../src/lib/matching';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const acro = (name: string, page: number, X: number, Width: number, type = 'text'): AcroField => ({
  name,
  page,
  sourceMeta: { sourceName: name, page, type, rect: { X, Y: 100, Width, Height: 12 } },
});

(async () => {
  // --- ancho útil ----------------------------------------------------------
  {
    // una página con márgenes de 30 sobre 612
    const campos = [acro('a', 1, 30, 100), acro('b', 1, 200, 382), acro('c', 1, 500, 82)];
    const u = anchoUtil(campos);
    ok(u.porPagina.length === 1 && u.porPagina[0].min === 30, 'el margen izquierdo sale del mínimo X');
    ok(u.util === 552, `el útil es max(X+W) - min(X) = 552 (got ${u.util})`);
    ok(escalonDeAncho(552, u.util) === 'full', 'un campo de 552 sobre 552 es full, no half');
    ok(escalonDeAncho(276, u.util) === 'half', 'la mitad es half');
    ok(escalonDeAncho(170, u.util) === 'third', 'un tercio es third');
    ok(escalonDeAncho(100, u.util) === 'quarter', 'un cuarto es quarter');
    ok(escalonDeAncho(120, 0) === 'full', 'sin ancho útil no se adivina: full');
  }

  // --- un útil para todo el documento -------------------------------------
  {
    // la página 1 tiene una banda que le come el margen: útil 524 vs 554
    const campos = [
      acro('p1a', 1, 58.9, 382),
      acro('p1b', 1, 58.9, 100),
      acro('p1c', 1, 400, 183.5),
      acro('p2a', 2, 29.7, 382),
      acro('p2b', 2, 29.7, 551.8),
    ];
    const u = anchoUtil(campos);
    ok(u.porPagina.length === 2, 'mide las dos páginas');
    ok(
      Math.round(u.porPagina[0].util) === 525 && Math.round(u.porPagina[1].util) === 552,
      `útiles por página (got ${u.porPagina.map((p) => Math.round(p.util)).join('/')})`,
    );
    ok(
      escalonDeAncho(382, u.util) === escalonDeAncho(382, u.util),
      'el mismo ancho da el mismo escalón en las dos páginas (un solo útil de documento)',
    );
    // con dos páginas la mediana es el promedio de las dos
    ok(Math.abs(u.util - (u.porPagina[0].util + u.porPagina[1].util) / 2) < 0.01, `el útil del documento es la mediana (got ${u.util})`);
  }

  // --- las casillas no se miden por su rect -------------------------------
  {
    const rect = { X: 10, Y: 10, Width: 10.3, Height: 10.3 };
    ok(anchoDeCampo({ tipo: 'checkbox' }, rect, 552) === 'full', 'una casilla no es quarter por medir 10pt');
    ok(anchoDeCampo({ tipo: 'radio' }, rect, 552) === 'full', 'un radio tampoco');
    ok(anchoDeCampo({ tipo: 'text', esOpcion: true }, rect, 552) === 'full', 'ni una opción de grupo');
    ok(anchoDeCampo({ tipo: 'signature' }, rect, 552) === 'full', 'la firma ocupa su renglón');
    ok(anchoDeCampo({ tipo: 'text' }, { X: 0, Y: 0, Width: 552, Height: 12 }, 552) === 'full', 'un texto sí se mide');
    ok(anchoDeCampo({ tipo: 'text' }, null, 552) === 'full', 'un campo sin rect (sin main) queda full');
  }

  // --- rect en distintas grafías ------------------------------------------
  {
    ok(rectDeAcro({ name: 'x', sourceMeta: { rect: { X: 1, Y: 2, Width: 3, Height: 4 } } })?.Width === 3, 'lee X/Y/Width/Height');
    ok(rectDeAcro({ name: 'x', sourceMeta: { rect: { x: 1, y: 2, w: 3, h: 4 } } })?.Width === 3, 'y también x/y/w/h');
    ok(rectDeAcro({ name: 'x' }) === null, 'sin rect devuelve null, no ceros');
  }

  // --- validaciones de la col K -------------------------------------------
  {
    const d = derivarValidacion('8 dígitos');
    ok(d.maxLength === 8 && d.validationPattern === PATRON_NUMERICO, `«8 dígitos» -> maxLength 8 + numérico (got ${JSON.stringify(d)})`);

    const c = derivarValidacion('150 caracteres alfanuméricos');
    ok(c.maxLength === 150 && !c.validationPattern, `«150 caracteres alfanuméricos» -> solo maxLength (got ${JSON.stringify(c)})`);

    const f = derivarValidacion('Formato dd/mm/aaaa');
    ok(f.jsonDateFormat === 'dd/MM/yyyy', `«Formato dd/mm/aaaa» -> dd/MM/yyyy (got ${f.jsonDateFormat})`);

    const e = derivarValidacion('Formato de correo');
    ok(e.validationPattern === PATRON_CORREO, 'correo -> patrón de correo');

    const n = derivarValidacion('numérico');
    ok(n.validationPattern === PATRON_NUMERICO && n.maxLength === undefined, 'numérico sin cantidad: patrón sin tope');

    const vacio = derivarValidacion('');
    ok(vacio.reconocido && vacio.senales.length === 0, 'una celda vacía no es un problema');

    const raro = derivarValidacion('según criterio del suscriptor');
    ok(!raro.reconocido && raro.crudo === 'según criterio del suscriptor', 'lo que no se entiende NO se inventa: queda sin reconocer');

    const mixto = derivarValidacion('12 dígitos, formato dd/mm/aaaa');
    ok(mixto.maxLength === 12 && mixto.jsonDateFormat === 'dd/MM/yyyy', 'dos señales en la misma celda');

    // «dígitos» pero alfanumérico: no se fuerza el patrón numérico
    const amb = derivarValidacion('20 dígitos alfanuméricos');
    ok(amb.maxLength === 20 && !amb.validationPattern, 'si dice alfanumérico no se fuerza numérico');
  }

  // --- CSC real ------------------------------------------------------------
  const F_MAIN = path.resolve('fixtures/csc-main-derivado.json');
  if (!fs.existsSync(F_MAIN)) {
    console.log('\n(SKIP) fixture del main no encontrado en fixtures/');
  } else {
    const campos = extractAcroFromForm(JSON.parse(fs.readFileSync(F_MAIN, 'utf8')));
    const u = anchoUtil(campos);
    console.log(
      `\n--- CSC main: ${campos.length} campos · útil ${u.util.toFixed(1)}pt · ` +
        u.porPagina.map((p) => `p${p.pagina}=${p.util.toFixed(0)}`).join(' ') +
        ' ---',
    );
    ok(campos.length === 111, `el main derivado trae 111 campos (got ${campos.length})`);
    ok(u.util > 500 && u.util < 570, `el ancho útil cae en el rango de un A4 con márgenes (got ${u.util.toFixed(1)})`);

    const cuenta: Record<string, number> = {};
    for (const a of campos) {
      const r = rectDeAcro(a);
      const tipo = ((a.sourceMeta as any)?.type as string) ?? 'text';
      const w = anchoDeCampo({ tipo }, r, u.util);
      cuenta[w] = (cuenta[w] ?? 0) + 1;
    }
    console.log('    escalones:', JSON.stringify(cuenta));
    const casillas = campos.filter((a) => ((a.sourceMeta as any)?.type as string) === 'checkbox');
    ok(
      casillas.length > 40 && casillas.every((a) => anchoDeCampo({ tipo: 'checkbox' }, rectDeAcro(a), u.util) === 'full'),
      `las ${casillas.length} casillas caen todas en full, aunque midan 10pt`,
    );
    ok((cuenta.quarter ?? 0) + (cuenta.third ?? 0) >= 25, 'y los campos de texto se reparten en los escalones angostos');

    // el más ancho de la página 2 mide 552pt: tiene que ser full
    const ancho = campos.find((a) => /Intermediario/.test(a.name))!;
    ok(
      anchoDeCampo({ tipo: 'text' }, rectDeAcro(ancho), u.util) === 'full',
      'el campo de 552pt del intermediario es full',
    );
    // y el mismo «detalle» de 382pt tiene que dar lo mismo en las dos páginas
    const asg = campos.find((a) => a.name === 'asg_detalle');
    const rpl = campos.find((a) => a.name === 'rpl_detalle');
    if (asg && rpl) {
      const wa = anchoDeCampo({ tipo: 'text' }, rectDeAcro(asg), u.util);
      const wr = anchoDeCampo({ tipo: 'text' }, rectDeAcro(rpl), u.util);
      ok(wa === wr, `«detalle» da el mismo escalón en p1 y p2 (got ${wa} / ${wr})`);
    }
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
