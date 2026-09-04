// Test de v3.0.0 — generador de Etapa 1 y payload en vivo.
// Los números salen del CSC real: la ficha con la col N que produce Etapa 0 y un
// main con sourceName + page + rect.

import fs from 'fs';
import path from 'path';
import { buildFichaRaw, readFichaSheets } from '../src/lib/etapa0/fichaRaw';
import { extractAcroFromForm, flattenFields } from '../src/lib/matching';
import {
  aplicaAInstancia,
  esObligatorio,
  estructuraDeFila,
  generarDesdeFicha,
  hojasSinPaso,
  nombreParaInstancia,
  rutaConInstancia,
  tokensColN,
} from '../src/lib/etapa1/desdeFicha';
import { codigosAplicables, entreComillas, pideConcatenar, revelaCampos } from '../src/lib/etapa1/reglas';
import {
  construirPayload,
  escribirEnRuta,
  grafiaSospechosa,
  partirRuta,
  valoresDeEjemplo,
  valorDeCampo,
} from '../src/lib/etapa1/payload';
import { runValidations, errorCount } from '../src/lib/validation';
import type { Field, FormDefinition, Project } from '../src/types';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const campoBase = (p: Partial<Field> & { id: string }): Field =>
  ({
    type: 'text',
    label: p.id,
    required: false,
    readOnly: false,
    hidden: null,
    order: 1,
    width: 'full',
    options: null,
    optionsLayout: 'vertical',
    sourceMeta: null,
    prefillMode: 'optional',
    prefillKey: null,
    salidaJSON: null,
    jsonOutputPath: null,
    salidaJSONSecundaria: null,
    jsonValueSecundario: null,
    excludeFromJson: false,
    conditionalVisibility: null,
    conditionalRequired: null,
    autoFillConcat: null,
    checkedPdfValue: null,
    checkedJsonValue: null,
    jsonNumberFormat: null,
    jsonDateFormat: null,
    defaultValue: null,
    validationPattern: null,
    repeaterConfig: null,
    radioGroupLabel: null,
    radioGroupFields: null,
    sharedValue: null,
    jsonValue: null,
    ...p,
  }) as Field;

const formCon = (campos: Field[]): FormDefinition => ({
  sections: [
    {
      id: 's1',
      title: 'S',
      description: null,
      instructions: null,
      conditionalVisibility: null,
      order: 1,
      hidden: null,
      fields: [],
      subsections: [
        {
          id: 'sub1',
          title: 'Sub',
          description: null,
          instructions: null,
          conditionalVisibility: null,
          hidden: null,
          order: 1,
          fields: campos,
        },
      ],
      childrenOrder: [{ kind: 'subsection', id: 'sub1' }],
    },
  ],
  validationRules: [],
  prefillMappings: [],
  generatedDocuments: [],
  version: 1,
});

(async () => {
  // --- reglas en prosa de las cols G y K ----------------------------------
  {
    ok(JSON.stringify(entreComillas('es "ASG" y "RPL"')) === '["ASG","RPL"]', 'saca el texto entre comillas');
    ok(
      JSON.stringify(codigosAplicables('Solo aplica cuando código de persona es "ASG" y "RPL"')) === '["ASG","RPL"]',
      'lee los códigos de instancia de la col G',
    );
    ok(codigosAplicables('Alfanumérico (50)') === null, 'una regla de formato no es una restricción de instancia');
    // el caso real: dos frases en la misma celda
    const mixta = 'Si se escoge "SI" se debe mostrar el campo "Detalle el Cargo" / Solo aplica cuando código de persona es "PJR"';
    ok(JSON.stringify(codigosAplicables(mixta)) === '["PJR"]', `dos frases en una celda: los códigos son solo los del «solo aplica» (got ${JSON.stringify(codigosAplicables(mixta))})`);
    const rev = revelaCampos(mixta);
    ok(
      rev?.valor === 'SI' && JSON.stringify(rev?.campos) === '["Detalle el Cargo"]',
      `y la revelación no se lleva el código de instancia (got ${JSON.stringify(rev)})`,
    );
    ok(pideConcatenar('Concatenar automatico'), 'detecta el autoFillConcat declarado');
    ok(!pideConcatenar('Solo informativo'), 'y no lo ve donde no está');
  }

  // --- helpers del generador ----------------------------------------------
  {
    ok(JSON.stringify(tokensColN('a, b')) === '["a","b"]', 'parte la col N por coma');
    ok(tokensColN('No aplica').length === 0, '«No aplica» es vacío');

    const asg = { codigo: 'ASG', prefijo: 'asg', indice: 0, activa: true };
    const pjr = { codigo: 'PJR', prefijo: 'pjr', indice: 1, activa: true };
    const tokens = ['asg_nombre', 'pjr_nombre', 'rpl_nombre'];
    const todas = [asg, pjr, { codigo: 'RPL', prefijo: 'rpl', indice: 2, activa: true }];
    ok(nombreParaInstancia(tokens, asg, 0, todas) === 'asg_nombre', 'a cada instancia le toca su nombre por prefijo');
    ok(nombreParaInstancia(tokens, pjr, 1, todas) === 'pjr_nombre', 'y no el de la de al lado');
    ok(nombreParaInstancia(['uno', 'dos', 'tres'], pjr, 1, todas) === 'dos', 'sin prefijo, cae al orden posicional');
    ok(
      nombreParaInstancia(['pjr_razon_social'], asg, 0, todas) === null,
      'si los nombres son de OTRA instancia, la fila no es de esta (no se roba el campo ajeno)',
    );
    ok(nombreParaInstancia([], asg, 0) === null, 'sin col N no hay nombre');

    const fila = { hoja: 'personas', instancia: asg, indiceInstancia: 0 } as any;
    ok(
      rutaConInstancia('datosFormulario.personas.primerApellido', fila, new Set(['personas'])) ===
        'datosFormulario.personas[0].primerApellido',
      'la ruta lleva el índice de la instancia',
    );
    ok(
      rutaConInstancia('datosFormulario.personas.direccion.provincia', fila, new Set(['personas', 'direccion'])) ===
        'datosFormulario.personas[0].direccion.provincia',
      'y se indexa el nodo RAÍZ del bloque, no la hoja hija',
    );
    ok(
      rutaConInstancia('encabezado.correo', { ...fila, instancia: null, indiceInstancia: null }, new Set(['personas'])) ===
        'encabezado.correo',
      'una fila sin instancia no se indexa',
    );

    ok(esObligatorio('Both') && esObligatorio('JSON') && !esObligatorio('None') && !esObligatorio(''), 'col H: Both/JSON sí, None/vacío no');

    const filaPJR = { regla: 'Solo aplica cuando código de persona es "PJR"', observaciones: '' } as any;
    ok(!aplicaAInstancia(filaPJR, asg) && aplicaAInstancia(filaPJR, pjr), 'una fila de PJR no se genera para ASG');
    ok(aplicaAInstancia({ regla: '', observaciones: '' } as any, asg), 'sin restricción, aplica a todas');

    ok(
      hojasSinPaso([{ nodo: 'encabezado', paso: 'No aplica', secciones: 'No aplica' }]).has('encabezado'),
      'una hoja con paso «No aplica» no es una pantalla del formulario',
    );
    const est = estructuraDeFila(
      { pasos: 'JSON', seccion: '', hoja: 'encabezado' } as any,
      [{ nodo: 'encabezado', paso: 'No aplica', secciones: '' }],
      { seccion: '', subseccion: '' },
    );
    ok(est.seccion === 'encabezado', `«JSON» en la col A no es un paso (got «${est.seccion}»)`);
  }

  // --- payload -------------------------------------------------------------
  {
    ok(JSON.stringify(partirRuta('a.b[2].c')) === '[{"clave":"a","indice":null},{"clave":"b","indice":2},{"clave":"c","indice":null}]', 'parte la ruta con índices');
    const d: Record<string, unknown> = {};
    escribirEnRuta(d, 'datosFormulario.personas[1].nombre', 'Ana');
    ok((d as any).datosFormulario.personas[1].nombre === 'Ana', 'escribe creando el arreglo');
    ok(Array.isArray((d as any).datosFormulario.personas) && (d as any).datosFormulario.personas.length === 2, 'y rellena los índices previos');

    ok(valorDeCampo(campoBase({ id: 'a', type: 'checkbox', checkedJsonValue: 'X' }), true) === 'X', 'una casilla marcada escribe su checkedJsonValue');
    ok(valorDeCampo(campoBase({ id: 'a', type: 'checkbox' }), false) === undefined, 'y sin marcar no escribe');
    ok(valorDeCampo(campoBase({ id: 'a', type: 'number' }), '42') === 42, 'un número viaja como número');
  }

  // --- diagnósticos --------------------------------------------------------
  {
    const form = formCon([
      campoBase({ id: 'f1', label: 'Sin ruta', sourceMeta: { sourceName: 'x' } }),
      campoBase({ id: 'r1', type: 'radio', salidaJSON: 'a.tipo', jsonValue: 'A', radioGroupFields: ['r2'] }),
      campoBase({ id: 'r2', type: 'radio', salidaJSON: 'a.tipo', jsonValue: 'B', radioGroupFields: ['r1'] }),
      campoBase({ id: 'c1', salidaJSON: 'a.Nombre' }),
      campoBase({ id: 'd1', salidaJSON: 'a.dup' }),
      campoBase({ id: 'd2', salidaJSON: 'a.dup' }),
    ]);
    const r = construirPayload({ form, valores: {}, rutasDeclaradas: ['a.tipo', 'a.dup', 'a.faltante'] });
    const t = (tipo: string) => r.diagnosticos.filter((x) => x.tipo === tipo);
    ok(t('sin-ruta').length === 1, 'marca el campo con sourceMeta y sin ruta');
    ok(t('radios-se-pisan').length === 1, 'marca los radios que comparten ruta sin excludeFromJson');
    ok(t('grafia-sospechosa').length === 1 && /mayúscula/.test(t('grafia-sospechosa')[0].mensaje), 'marca la ruta con mayúscula inicial');
    ok(t('colision-de-ruta').length === 1, 'marca dos campos distintos escribiendo la misma ruta');
    ok(r.cobertura.declaradas === 3 && r.cobertura.faltantes.includes('a.faltante'), `cobertura: 3 declaradas, falta a.faltante (got ${JSON.stringify(r.cobertura)})`);
    ok(JSON.stringify(grafiaSospechosa('a.fechaConstitución')).includes('tilde'), 'la tilde en la ruta se marca');
    ok(grafiaSospechosa('datosFormulario.personas[0].primerApellido').length === 0, 'una ruta correcta no molesta');
  }

  // --- CSC real ------------------------------------------------------------
  const F_FICHA = path.resolve('fixtures/csc-ficha-col-n.xlsx');
  const F_MAIN = path.resolve('fixtures/csc-main-derivado.json');
  if (!fs.existsSync(F_FICHA) || !fs.existsSync(F_MAIN)) {
    console.log('\n(SKIP) fixtures de Etapa 1 no encontrados (se generan con .tmp/genfix.ts)');
  } else {
    const ficha = buildFichaRaw(await readFichaSheets(fs.readFileSync(F_FICHA)));
    const main = extractAcroFromForm(JSON.parse(fs.readFileSync(F_MAIN, 'utf8')));
    const g = generarDesdeFicha({ ficha, main });

    console.log(
      `\n--- CSC: ${g.stats.hojas} hojas · ${g.stats.secciones} secciones · ${g.stats.subsecciones} subsecciones · ` +
        `${g.stats.campos} campos (${g.stats.conSourceMeta} con sourceMeta, ${g.stats.radios} radios) · ` +
        `col N en ${g.stats.filasConColN} filas · sin vincular ${g.sinVincular.length} ---`,
    );

    // §9 — se leen TODAS las hojas, no solo la de más filas
    ok(g.stats.hojas >= 9, `lee las ${g.stats.hojas} hojas de la ficha, no solo la de más filas`);
    ok(g.stats.secciones >= 5, `arma ${g.stats.secciones} secciones`);
    ok(g.sinVincular.length === 0, `0 campos sin vincular (got ${g.sinVincular.length}: ${g.sinVincular.slice(0, 4).join(', ')})`);
    ok(g.stats.conSourceMeta > 80, `${g.stats.conSourceMeta} campos con sourceMeta del main`);

    // las 3 instancias, cada una con su sección y su índice
    const titulos = g.form.sections.map((s) => s.title);
    for (const cod of ['ASG', 'PJR', 'RPL']) {
      ok(titulos.some((t) => t.includes(cod)), `hay sección de la instancia ${cod}`);
    }
    const campos = flattenFields(g.form);
    for (const [cod, idx] of [['asg', 0], ['pjr', 1], ['rpl', 2]] as const) {
      const c = campos.find((x) => {
        const sm = x.sourceMeta as any;
        return typeof sm?.sourceName === 'string' && sm.sourceName.startsWith(cod + '_') && x.salidaJSON;
      });
      ok(
        !!c && (c.salidaJSON ?? '').includes(`[${idx}]`),
        `${cod} escribe en personas[${idx}] (got ${c?.salidaJSON})`,
      );
    }

    // sourceMeta verbatim
    const conMeta = campos.filter((c) => c.sourceMeta);
    const unoDelMain = main.find((a) => a.name === (conMeta[0].sourceMeta as any).sourceName)!;
    ok(
      JSON.stringify(conMeta[0].sourceMeta) === JSON.stringify(unoDelMain.sourceMeta),
      'el sourceMeta se copia verbatim del main',
    );
    // Regla de Oro en los ids de los campos bindeados
    const malId = conMeta.filter((c) => {
      const n = ((c.sourceMeta as any).sourceName as string).toLowerCase().replace(/\[(\d+)\]/g, '_$1');
      return c.id !== 'field_' + n;
    });
    ok(malId.length === 0, `los ids cumplen la Regla de Oro (got ${malId.length} fuera de regla: ${malId.slice(0, 3).map((c) => c.id).join(', ')})`);

    // anchos derivados del rect
    const anchos: Record<string, number> = {};
    for (const c of campos) anchos[c.width] = (anchos[c.width] ?? 0) + 1;
    console.log('    anchos:', JSON.stringify(anchos), '· ancho útil', g.stats.anchoUtil.toFixed(1));
    ok((anchos.quarter ?? 0) + (anchos.third ?? 0) + (anchos.half ?? 0) >= 30, 'los anchos salen del rect, no todos en full');

    // huecos de la última milla
    console.log('    huecos:', g.huecos.map((h) => `${h.ruta} (${h.motivo})`).join(' · ') || 'ninguno');
    ok(g.huecos.length >= 1, `detecta ${g.huecos.length} hueco(s) de última milla`);

    // payload + cobertura
    const rutasDeclaradas = ficha.rows.filter((r) => r.campoJson.trim()).map((r) => r.campoJson.trim());
    const valores = valoresDeEjemplo(g.form);
    const p = construirPayload({ form: g.form, valores, rutasDeclaradas, huecos: g.huecos });
    console.log(
      `    payload: ${p.json.split('\n').length} líneas · cobertura ${p.cobertura.escritas} escritas de ${p.cobertura.declaradas} declaradas · ` +
        `${p.diagnosticos.length} diagnósticos`,
    );
    const porTipo: Record<string, number> = {};
    for (const d of p.diagnosticos) porTipo[d.tipo] = (porTipo[d.tipo] ?? 0) + 1;
    console.log('    diagnósticos:', JSON.stringify(porTipo));
    ok(p.json.length > 1000, 'el payload de ejemplo no está vacío');
    ok(/"personas"/.test(p.json) && /\[/.test(p.json), 'y trae el arreglo de personas');
    ok(p.cobertura.declaradas >= 70, `la ficha declara ${p.cobertura.declaradas} rutas distintas`);
    ok(
      p.cobertura.escritas <= p.cobertura.declaradas,
      `las escritas (${p.cobertura.escritas}) se comparan contra las declaradas (${p.cobertura.declaradas}) en la misma unidad`,
    );
    ok((porTipo['radios-se-pisan'] ?? 0) === 0, `ningún grupo de radios se pisa (got ${porTipo['radios-se-pisan'] ?? 0})`);

    // el validador del proyecto, en 0 ERROR
    const proyecto: Project = {
      name: 'csc',
      sourceFields: g.sourceFields,
      idConvention: 'lower',
      form: g.form,
      pool: [],
      acroForms: main,
    };
    const reglas = runValidations(proyecto);
    const errores = errorCount(reglas);
    const detalle = reglas.filter((r) => r.level === 'error').slice(0, 5).map((r) => r.message);
    console.log('    validador:', errores, 'errores', detalle.length ? '· ' + detalle.join(' | ') : '');
    ok(errores === 0, `el validador queda en 0 ERROR (got ${errores})`);
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
  if (fail) process.exit(1);
})();
