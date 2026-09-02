// Test de v1.4.1 Fix B — regiones geométricas y alineación por segmentos.
// La parte pura (matching de texto, bandas, cortes) corre con datos sintéticos.
// Los números de éxito se miden contra los fixtures REALES del cliente.

import * as fs from 'fs';
import * as path from 'path';
import { buildFichaRaw, readFichaSheets, norm } from '../src/lib/etapa0/fichaRaw';
import { readPdfFields, type PdfLeaf } from '../src/lib/etapa0/pdfFields';
import {
  detectarBloquesInstanciables,
  hojasDelBloque,
  instanciasPorDefecto,
  expandirInstancias,
  generarNombres,
  marcarGruposDeOpciones,
} from '../src/lib/etapa0/acroName';
import { alinear, alinearPorSegmentos, type Segmento } from '../src/lib/etapa0/align';
import {
  valorMatcheaTexto,
  bandasDeGrupo,
  saltoEntre,
  cortePorMayorSalto,
  sembrarRegiones,
  textItemDePdfjs,
  type GrupoOpciones,
  type TextItem,
} from '../src/lib/etapa0/regiones';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const leaf = (i: number, page: number, y: number, ft = '/Tx'): PdfLeaf => ({
  name: `f${i}`,
  ft,
  page,
  rect: { x: 50, y, w: 100, h: 12 },
  widgets: [{ page, rect: { x: 50, y, w: 100, h: 12 } }],
  readingIndex: i,
  multiWidgetSospechoso: false,
  paginas: [page],
});

const ti = (str: string, page: number, y: number, x = 100, rotado = false): TextItem => ({
  str,
  page,
  x,
  y,
  w: str.length * 4,
  rotado,
});

(async () => {
  // --- matching de texto --------------------------------------------------
  ok(valorMatcheaTexto('Jurídico Nacional', 'Jurídica Nacional'), 'matchea por prefijo: "Jurídico" vs "Jurídica"');
  ok(valorMatcheaTexto('DIMEX', 'DIMEX'), 'matchea exacto');
  ok(!valorMatcheaTexto('DIMEX', 'DIDI'), 'no matchea otro valor del mismo grupo');
  ok(
    !valorMatcheaTexto(
      'Física',
      '- Cuando no aplique una sección (persona física o persona jurídica), debe trazarse una línea transversal.',
    ),
    'un valor corto NO matchea la prosa larga que lo contiene (banda fantasma)',
  );
  ok(valorMatcheaTexto('Institución Autónoma', 'Institución Autónoma'), 'matchea valor de dos palabras');
  ok(!valorMatcheaTexto('SI', 'Si'), 'los valores de 2 letras no se usan (ruido)');

  // --- bandas -------------------------------------------------------------
  const grupo: GrupoOpciones = { label: 'Tipo', valores: ['Cédula', 'DIMEX', 'DIDI', 'Pasaporte'] };
  const texto: TextItem[] = [
    ti('Cédula', 0, 578, 244),
    ti('DIMEX', 0, 578, 294),
    ti('DIDI', 0, 577, 346), // 1pt de diferencia: misma banda
    ti('Pasaporte', 0, 579, 389),
    ti('DIMEX', 1, 712, 294),
    ti('DIDI', 1, 712, 346),
  ];
  const bandas = bandasDeGrupo(grupo, texto);
  ok(bandas.length === 2, `2 bandas (una por página) (got ${bandas.length})`);
  ok(bandas[0].valores.length === 4, `la primera banda junta las 4 opciones de la fila (got ${bandas[0].valores.length})`);
  ok(bandas[0].page === 0 && bandas[1].page === 1, 'las bandas salen en orden de lectura');

  // grupo dibujado en DOS filas contiguas = UNA sola aparición
  const g2: GrupoOpciones = {
    label: 'Origen',
    valores: ['Empresa con actividad comercial', 'Empresa del estado', 'Asociación solidarista', 'Empresa patrimonial'],
  };
  const t2: TextItem[] = [
    ti('Empresa con actividad comercial', 0, 219, 158),
    ti('Empresa del estado', 0, 219, 302),
    ti('Asociación solidarista', 0, 201, 158),
    ti('Empresa patrimonial', 0, 201, 301),
  ];
  ok(bandasDeGrupo(g2, t2).length === 1, 'dos filas contiguas del mismo grupo se fusionan en una banda');
  ok(bandasDeGrupo(g2, t2)[0].valores.length === 4, 'la banda fusionada junta los 4 valores');

  // las etiquetas laterales rotadas no cuentan como opciones
  ok(
    bandasDeGrupo({ label: 'x', valores: ['Persona Física'] }, [ti('(PERSONA FÍSICA)', 0, 433, 49, true)]).length === 0,
    'el texto rotado (etiqueta lateral) se ignora',
  );

  // --- cortes por mayor salto ---------------------------------------------
  const ls = [leaf(1, 0, 700), leaf(2, 0, 600), leaf(3, 0, 580), leaf(4, 0, 560), leaf(5, 1, 700)];
  ok(saltoEntre(ls[1], ls[2]) === 8, `salto 600->580 con h=12 es 8 (got ${saltoEntre(ls[1], ls[2])})`);
  ok(saltoEntre(ls[3], ls[4]) === Infinity, 'un cambio de página es un salto infinito');
  ok(cortePorMayorSalto(ls, 1, 3) === 1, 'el mayor salto de la zona 1..3 está en el índice 1 (700->600)');
  ok(cortePorMayorSalto(ls, 2, 4) === 4, 'el cambio de página gana siempre');
  ok(cortePorMayorSalto(ls, 3, 3) === 3, 'zona de un solo candidato');

  // --- siembra sintética --------------------------------------------------
  // 3 instancias, un grupo que aparece 3 veces, con separaciones claras.
  const sint: PdfLeaf[] = [
    leaf(1, 0, 760), // libre inicial
    leaf(2, 0, 700), leaf(3, 0, 690), leaf(4, 0, 680), // A
    leaf(5, 0, 600), leaf(6, 0, 590), leaf(7, 0, 580), // B
    leaf(8, 1, 700), leaf(9, 1, 690), // C
  ];
  const tSint: TextItem[] = [
    ti('DIMEX', 0, 690),
    ti('DIMEX', 0, 590),
    ti('DIMEX', 1, 690),
  ];
  const s = sembrarRegiones(sint, tSint, [{ codigo: 'A' }, { codigo: 'B' }, { codigo: 'C' }], [
    { label: 'Tipo', valores: ['DIMEX'] },
  ]);
  ok(s.regiones.length === 3, `3 regiones sembradas (got ${s.regiones.length})`);
  ok(s.regiones[0].codigo === 'A' && s.regiones[0].desdeLeaf === 1 && s.regiones[0].hastaLeaf === 3, `A = #2..#4 (got #${s.regiones[0].desdeLeaf + 1}..#${s.regiones[0].hastaLeaf + 1})`);
  ok(s.regiones[1].codigo === 'B' && s.regiones[1].desdeLeaf === 4 && s.regiones[1].hastaLeaf === 6, `B = #5..#7 (got #${s.regiones[1].desdeLeaf + 1}..#${s.regiones[1].hastaLeaf + 1})`);
  ok(s.regiones[2].codigo === 'C' && s.regiones[2].desdeLeaf === 7, `C arranca en la página 2 (got #${s.regiones[2].desdeLeaf + 1})`);

  // un grupo que no aparece tantas veces como instancias no se usa
  const s2 = sembrarRegiones(sint, [ti('DIMEX', 0, 690)], [{ codigo: 'A' }, { codigo: 'B' }], [
    { label: 'Tipo', valores: ['DIMEX'] },
  ]);
  ok(s2.regiones.length === 0, 'sin anclas suficientes no se siembra ninguna región');
  ok(s2.avisos.some((a) => /no se pudo sembrar/.test(a)), 'y se avisa explícitamente');

  // --- alineación por segmentos -------------------------------------------
  const filas = [
    { nombrePdf: 'Nombre', valor: '', tipo: 'Texto', nombrePropuesto: 'a_nombre' },
    { nombrePdf: 'Nombre', valor: '', tipo: 'Texto', nombrePropuesto: 'b_nombre' },
  ];
  const dos = [leaf(1, 0, 700), leaf(2, 1, 700)];
  const segs: Segmento[] = [
    { etiqueta: 'A', filaIdxs: [0], leafIdxs: [0] },
    { etiqueta: 'B', filaIdxs: [1], leafIdxs: [1] },
  ];
  const porSeg = alinearPorSegmentos(filas, dos, segs);
  ok(porSeg.asignaciones.length === 2, '2 asignaciones, una por segmento');
  ok(porSeg.asignaciones[0].filaIdx === 0 && porSeg.asignaciones[0].leafIdx[0] === 0, 'los índices vuelven a ser globales');
  ok(porSeg.asignaciones[1].filaIdx === 1 && porSeg.asignaciones[1].leafIdx[0] === 1, 'la fila de B no cruza a la región de A');
  ok(porSeg.asignaciones.every((a) => a.motivos.some((m) => /región/.test(m))), 'el motivo dice en qué región se resolvió');

  // una fila sin campo en SU región queda huérfana, no roba el de la otra
  const segsDesbalanceados: Segmento[] = [
    { etiqueta: 'A', filaIdxs: [0, 1], leafIdxs: [0] },
    { etiqueta: 'B', filaIdxs: [], leafIdxs: [1] },
  ];
  const desb = alinearPorSegmentos(filas, dos, segsDesbalanceados);
  ok(desb.huerfanosFicha.length === 1, `1 fila huérfana (got ${desb.huerfanosFicha.length})`);
  ok(desb.huerfanosPdf.length === 1 && desb.huerfanosPdf[0] === 1, 'el campo de B queda sin asignar en vez de recibir una fila de A');

  // --- fixtures reales -----------------------------------------------------
  const F_FICHA = path.resolve('fixtures/Ficha_de_configuración_-_Conozca_a_su_cliente.xlsx');
  const F_PDF = path.resolve('fixtures/BUC_Formulario_Conozca_Cliente_Homologado.pdf');
  if (!fs.existsSync(F_FICHA) || !fs.existsSync(F_PDF)) {
    console.log('\n(SKIP) fixtures reales no encontrados en fixtures/');
  } else {
    const ficha = buildFichaRaw(await readFichaSheets(fs.readFileSync(F_FICHA)));
    const pdf = await readPdfFields(fs.readFileSync(F_PDF));

    // texto del PDF con el build legacy de pdfjs (el único que corre en node)
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(F_PDF)) }).promise;
    const txt: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const it of tc.items) if (it?.str?.trim()) txt.push(textItemDePdfjs(it, p - 1));
    }
    console.log(`\n--- CSC real: ${pdf.leaves.length} campos, ${txt.length} fragmentos de texto ---`);

    // bloque repetible: personas + sus hojas hijas
    const bl = detectarBloquesInstanciables(ficha.rows, ficha.routing)[0];
    ok(!!bl && bl.hoja === 'personas', 'CSC: el bloque repetible es `personas`');
    ok(
      bl.hojas.includes('personas') && bl.hojas.includes('direccion'),
      `CSC: el bloque incluye a su hoja hija \`direccion\` (${bl.hojas.join(', ')})`,
    );
    ok(
      hojasDelBloque('personas', ficha.routing, ficha.rows).includes('direccion'),
      'CSC: direccion es datosFormulario.personas.direccion, o sea hija de personas',
    );
    ok(JSON.stringify(bl.codigos) === JSON.stringify(['ASG', 'PJR', 'RPL']), 'CSC: 3 instancias ASG/PJR/RPL');

    const inst = instanciasPorDefecto(bl.codigos);
    const nombres = generarNombres(expandirInstancias(ficha.rows, bl.hojas, inst));
    const filasPdf = nombres.filter((n) => n.fila.destino === 'pdf');
    ok(nombres.filter((n) => n.colision).length === 0, `CSC: 0 colisiones entre nombres propuestos (got ${nombres.filter((n) => n.colision).length})`);

    // grupos de opciones del bloque, una sola vez (sin expandir)
    const soloBloque = ficha.rows
      .filter((r) => bl.hojas.includes(r.hoja) && r.destino === 'pdf')
      .map((r) => ({ ...r, instancia: null, indiceInstancia: null }));
    const esG = marcarGruposDeOpciones(soloBloque);
    const grupos: GrupoOpciones[] = [];
    for (let i = 0; i < soloBloque.length; ) {
      if (!esG[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < soloBloque.length && esG[j + 1] && norm(soloBloque[j + 1].label) === norm(soloBloque[i].label)) j++;
      grupos.push({ label: soloBloque[i].label, valores: soloBloque.slice(i, j + 1).map((x) => x.valor) });
      i = j + 1;
    }

    const siembra = sembrarRegiones(pdf.leaves, txt, inst, grupos);
    siembra.regiones.forEach((r) =>
      console.log(
        `  ${r.codigo}: #${r.desdeLeaf + 1}..#${r.hastaLeaf + 1} (${r.hastaLeaf - r.desdeLeaf + 1} campos) ` +
          `p${pdf.leaves[r.desdeLeaf].page + 1} «${pdf.leaves[r.desdeLeaf].name}» -> p${pdf.leaves[r.hastaLeaf].page + 1} «${pdf.leaves[r.hastaLeaf].name}»`,
      ),
    );
    ok(siembra.regiones.length === 3, `CSC: 3 regiones sembradas (got ${siembra.regiones.length})`);
    const [rA, rP, rR] = siembra.regiones;
    ok(rA.codigo === 'ASG' && rP.codigo === 'PJR' && rR.codigo === 'RPL', 'CSC: las regiones salen en orden ASG, PJR, RPL');
    ok(
      pdf.leaves[rA.desdeLeaf].name === 'primer_apellido_asegurado',
      `CSC: la región ASG arranca en primer_apellido_asegurado (got ${pdf.leaves[rA.desdeLeaf].name})`,
    );
    ok(pdf.leaves[rA.hastaLeaf].page === 0 && pdf.leaves[rP.desdeLeaf].page === 0, 'CSC: ASG y PJR viven en la página 1');
    ok(pdf.leaves[rR.desdeLeaf].page === 1, 'CSC: la región RPL arranca en la página 2');
    ok(
      Math.round(pdf.leaves[rP.desdeLeaf].rect.y) === 339,
      `CSC: el borde ASG|PJR cae en y=339 por el salto de 27pt (got ${Math.round(pdf.leaves[rP.desdeLeaf].rect.y)})`,
    );

    // segmentos y alineación
    const porCodigo = new Map<string, number[]>();
    filasPdf.forEach((n, k) => {
      const c = n.fila.instancia?.codigo ?? 'libre';
      if (!porCodigo.has(c)) porCodigo.set(c, []);
      porCodigo.get(c)!.push(k);
    });
    const usados = new Set<number>();
    const segsReal: Segmento[] = siembra.regiones.map((r) => {
      const leafIdxs: number[] = [];
      for (let j = r.desdeLeaf; j <= r.hastaLeaf; j++) {
        leafIdxs.push(j);
        usados.add(j);
      }
      return { etiqueta: r.codigo, filaIdxs: porCodigo.get(r.codigo) ?? [], leafIdxs };
    });
    const libres = pdf.leaves.map((_, j) => j).filter((j) => !usados.has(j));
    if (libres.length) segsReal.push({ etiqueta: 'libre', filaIdxs: porCodigo.get('libre') ?? [], leafIdxs: libres });

    const alineables = filasPdf.map((n) => ({
      nombrePdf: n.fila.nombrePdf,
      valor: n.fila.valor,
      tipo: n.fila.tipo,
      nombrePropuesto: n.nombre,
    }));
    const global = alinear(alineables, pdf.leaves);
    const porRegion = alinearPorSegmentos(alineables, pdf.leaves, segsReal);
    console.log('  global   :', JSON.stringify(global.stats));
    console.log('  regiones :', JSON.stringify(porRegion.stats));

    const finales = (res: typeof global) => {
      const ed: Record<number, string> = {};
      for (const a of res.asignaciones) {
        const prop = filasPdf[a.filaIdx]?.nombre ?? '';
        a.leafIdx.forEach((li, parte) => {
          ed[li] = prop && a.leafIdx.length > 1 ? `${prop}_${parte + 1}` : prop;
        });
      }
      return pdf.leaves.map((l, j) => ({ leaf: l, name: ed[j]?.trim() || l.name }));
    };

    const fG = finales(global);
    const fR = finales(porRegion);
    const enP1 = (f: typeof fR, px: string) => f.filter((x) => x.name.startsWith(px) && x.leaf.page === 0).length;
    console.log(`  rpl_ en p1: global=${enP1(fG, 'rpl_')} regiones=${enP1(fR, 'rpl_')}`);

    // §6 — criterios de éxito de v1.4.1
    ok(enP1(fR, 'rpl_') === 0, `CSC §6: 0 campos rpl_* en la página 1 (got ${enP1(fR, 'rpl_')}; el pase global daba ${enP1(fG, 'rpl_')})`);
    ok(
      fR.filter((x) => x.name.startsWith('asg_')).every((x) => x.leaf.page === 0),
      'CSC §6: ningún asg_* fuera de la página de PERSONA FÍSICA',
    );
    const dentroDeRegion = (px: string, r: (typeof siembra.regiones)[number]) =>
      fR.every((x, j) => !x.name.startsWith(px) || (j >= r.desdeLeaf && j <= r.hastaLeaf));
    ok(dentroDeRegion('asg_', rA), 'CSC §6: todos los asg_* caen dentro de la región ASG');
    ok(dentroDeRegion('pjr_', rP), 'CSC §6: todos los pjr_* caen dentro de la región PJR');
    ok(dentroDeRegion('rpl_', rR), 'CSC §6: todos los rpl_* caen dentro de la región RPL');
    ok(porRegion.stats.pctAlta >= 70, `CSC §6: >=70% en confianza alta (got ${porRegion.stats.pctAlta}%)`);

    const cuenta = new Map<string, number>();
    fR.forEach((x) => cuenta.set(x.name, (cuenta.get(x.name) ?? 0) + 1));
    const dups = [...cuenta.entries()].filter(([, c]) => c > 1);
    ok(dups.length === 0, `CSC §6: 0 colisiones en los nombres finales (got ${dups.length}: ${JSON.stringify(dups)})`);

    // provincia/cantón/distrito de cada instancia, cada uno en su región
    for (const [px, r] of [
      ['asg_', rA],
      ['pjr_', rP],
      ['rpl_', rR],
    ] as const) {
      const pcd = fR.filter((x, j) => /provincia|canton|distrito/.test(x.name) && j >= r.desdeLeaf && j <= r.hastaLeaf);
      console.log(`  ${px} provincia/canton/distrito: ${pcd.map((x) => x.name).join(', ') || '(ninguno)'}`);
      ok(pcd.length >= 2, `CSC: la región de ${px} tiene su propio cantón/distrito (got ${pcd.length})`);
    }
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
