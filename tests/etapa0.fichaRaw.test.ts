// Test de v1.0.0 — lectura de ficha cruda multi-hoja.
// Corre con: npm run test:etapa0
// El fixture real del cliente (fixtures/) es opcional: si no está, se saltea.

import * as fs from 'fs';
import * as path from 'path';
import { buildFichaRaw, findMarcadores, type RawSheet } from '../src/lib/etapa0/fichaRaw';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const HEADER = [
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
/** fila de nodo: [A,B,C,D,E,F,G,H,I,J,K,L,M,N] */
const row = (o: Partial<Record<string, string>>): string[] =>
  [o.A, o.B, o.C, o.D, o.E, o.F, o.G, o.H, o.I, o.J, o.K, o.L, o.M, o.N].map((v) => v ?? '');

// --------------------------------------------------------------------------
// Fixture sintético que replica la forma del CSC.
// --------------------------------------------------------------------------
const sheets: RawSheet[] = [
  {
    name: 'Estructura base JSON',
    aoa: [
      ['Nodo JSON', 'Paso del formulario WEB', 'Secciones'],
      ['encabezado', 'Datos Generales', 'Información de la Solicitud'],
      ['personas', 'Datos del Cliente', 'Identificación'],
    ],
  },
  {
    name: 'encabezado',
    aoa: [
      HEADER,
      row({ A: 'JSON', B: 'JSON', C: 'No se llena en PDF', D: 'Tipo Tramite', M: 'encabezado.codigoTipoTramite' }),
      row({ A: 'Datos Generales', B: 'Solicitud', C: 'Nombre del asegurado', D: 'Nombre', E: 'Texto', M: 'encabezado.nombre' }),
      row({ A: 'Datos Generales', B: 'Solicitud', C: '', D: 'Segundo Nombre', E: 'Texto', M: 'encabezado.segundoNombre' }),
    ],
  },
  {
    name: 'personas',
    aoa: [
      HEADER,
      row({ A: 'Cliente', B: 'Id', C: 'Tipo Persona', D: 'Tipo Persona', F: '"ASG","PJR","RPL" (ver catálogo)', M: 'personas.codigoTipo' }),
      row({ A: 'Cliente', B: 'Id', C: 'Tipo de Identificación', D: 'Tipo de Identificación', F: 'Física', M: 'personas.tipoId' }),
      row({ A: 'Cliente', B: 'Id', C: 'Tipo de Identificación', D: 'Tipo de Identificación', F: 'DIMEX', M: 'personas.tipoId' }),
      // Bloque excluido: marcador en col G, termina en el próximo codigoTipo.
      row({ G: 'SECCIÓN NO APLICA PARA ESTE FORMULARIO' }),
      row({ A: 'TOM', B: 'Tomador', C: 'Nombre tomador', D: 'Nombre tomador', M: 'personas.nombreTomador' }),
      row({ A: 'TOM', B: 'Tomador', C: 'Cedula tomador', D: 'Cedula tomador', M: 'personas.cedulaTomador' }),
      // Reinicia instancia -> fin del bloque anterior.
      row({ A: 'RPL', B: 'Representante', C: 'Tipo Persona RPL', D: 'Tipo Persona', F: 'RPL', M: 'personas.codigoTipo' }),
      row({ A: 'RPL', B: 'Representante', C: 'Nombre representante', D: 'Nombre', M: 'personas.nombreRpl' }),
      // Segundo bloque excluido, hasta fin de hoja.
      row({ G: 'SECCIÓN NO APLICA PARA ESTE FORMULARIO' }),
      row({ A: 'BNF', B: 'Beneficiario', C: 'Nombre beneficiario', D: 'Nombre', M: 'personas.nombreBnf' }),
    ],
  },
  {
    name: 'polizaMadre',
    // Marcador de HOJA en col C, en la última fila (no la primera).
    aoa: [
      HEADER,
      row({ A: 'Póliza', B: 'Madre', C: 'Numero poliza', D: 'Numero', M: 'polizaMadre.numero' }),
      row({ C: 'ESTA HOJA NO APLICA PARA EL FORMULARIO CONOZCA A SU CLIENTE' }),
    ],
  },
  {
    name: 'riesgo',
    // Marcador de HOJA en col D (columna distinta a la de arriba).
    aoa: [
      HEADER,
      row({ A: 'Riesgo', B: 'Riesgo', C: 'Detalle riesgo', D: 'Detalle', M: 'riesgo.detalle' }),
      row({ D: 'Esta hoja no aplica para el formulario' }),
    ],
  },
  { name: 'JSON Generado', aoa: [['{'], ['  "encabezado": {}'], ['}']] },
];

const res = buildFichaRaw(sheets);

// --- hojas ---
ok(res.stats.hojasNodo === 4, `4 hojas de nodo detectadas (got ${res.stats.hojasNodo})`);
ok(res.stats.hojasNoAplica === 2, `2 hojas marcadas no-aplica (got ${res.stats.hojasNoAplica})`);
ok(
  res.sheets.find((s) => s.name === 'JSON Generado')?.esNodo === false,
  'la hoja de salida NO se toma como nodo',
);
ok(res.sheets.find((s) => s.name === 'polizaMadre')?.aplica === false, 'polizaMadre excluida (marcador en col C)');
ok(res.sheets.find((s) => s.name === 'riesgo')?.aplica === false, 'riesgo excluida (marcador en col D, minúsculas)');

// --- índice ---
ok(res.routing.length === 2 && res.routing[0].nodo === 'encabezado', 'índice parseado (nodo -> paso -> secciones)');

// --- bloques ---
ok(res.stats.bloquesExcluidos === 2, `2 bloques excluidos en personas (got ${res.stats.bloquesExcluidos})`);
const tomador = res.rows.find((r) => r.label === 'Nombre tomador')!;
ok(tomador?.destino === 'excluida' && tomador.motivo === 'bloque-no-aplica', 'fila del bloque TOM excluida');
const rpl = res.rows.find((r) => r.label === 'Nombre' && r.hoja === 'personas' && r.pasos === 'RPL')!;
ok(rpl?.destino === 'pdf', 'el bloque termina en el próximo codigoTipo: RPL vuelve a contar');
const bnf = res.rows.find((r) => r.campoJson === 'personas.nombreBnf')!;
ok(bnf?.destino === 'excluida' && bnf.motivo === 'bloque-no-aplica', 'segundo bloque excluye hasta fin de hoja');

// --- clasificación de filas ---
const tramite = res.rows.find((r) => r.label === 'Tipo Tramite')!;
ok(tramite?.destino === 'solo-json' && tramite.motivo === 'contrato-json', "fila con A='JSON' -> contrato");
const segundo = res.rows.find((r) => r.label === 'Segundo Nombre')!;
ok(segundo?.destino === 'solo-json' && segundo.motivo === 'sin-campo-pdf', 'col C vacía -> no va al PDF');
const nombre = res.rows.find((r) => r.label === 'Nombre' && r.hoja === 'encabezado')!;
ok(nombre?.destino === 'pdf', 'fila con col C -> va al PDF');
const enHojaExcluida = res.rows.find((r) => r.hoja === 'polizaMadre' && r.label === 'Numero')!;
ok(enHojaExcluida?.destino === 'excluida' && enHojaExcluida.motivo === 'hoja-no-aplica', 'fila de hoja excluida');

// --- columnas C y L presentes ---
ok(nombre.nombrePdf === 'Nombre del asegurado', 'col C (Nombre en PDF) mapeada');
ok(res.rows.some((r) => r.campoJson.startsWith('personas.')), 'col M mapeada');

// --- invariante: ninguna fila sin clasificar ---
ok(
  res.rows.every((r) => r.destino === 'pdf' || r.destino === 'solo-json' || r.destino === 'excluida'),
  'no quedan filas sin clasificar',
);
ok(res.stats.pdf + res.stats.soloJson + res.stats.excluidas === res.stats.filasDatos, 'la partición suma el total');

// --- marcadores: normalización y alcance ---
const m = findMarcadores([['', 'sección   no   aplica para este formulario']]);
ok(m.length === 1 && m[0].alcance === 'bloque', 'marcador normalizado (acentos/espacios) -> bloque');
const m2 = findMarcadores([['ESTA HOJA NO APLICA'], ['x']]);
ok(m2[0]?.alcance === 'hoja', 'texto con HOJA -> alcance hoja');

// --------------------------------------------------------------------------
// Fixture REAL (opcional, gitignoreado).
// --------------------------------------------------------------------------
const FIXTURE = path.resolve('fixtures/Ficha_de_configuración_-_Conozca_a_su_cliente.xlsx');
if (fs.existsSync(FIXTURE)) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(fs.readFileSync(FIXTURE), { type: 'buffer' });
  const real: RawSheet[] = wb.SheetNames.map((name: string) => ({
    name,
    aoa: XLSX.utils
      .sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false })
      .map((r: any[]) => (r ?? []).map((c) => String(c ?? ''))),
  }));
  const r = buildFichaRaw(real);
  console.log('\n--- CSC real ---');
  console.log('stats:', JSON.stringify(r.stats));
  console.log('hojas:', r.sheets.map((s) => `${s.name}${s.esNodo ? '' : '*'}${s.aplica ? '' : ' (NO APLICA)'}`).join(' | '));
  ok(r.stats.filasDatos === 177, `CSC: 177 filas de datos (got ${r.stats.filasDatos})`);
  ok(r.stats.hojasNodo === 10, `CSC: 10 hojas de nodo (got ${r.stats.hojasNodo})`);
  ok(r.stats.hojasNoAplica === 4, `CSC: 4 hojas no-aplica (got ${r.stats.hojasNoAplica})`);
  ok(r.stats.bloquesExcluidos === 2, `CSC: 2 bloques excluidos (got ${r.stats.bloquesExcluidos})`);
  ok(r.rows.every((x) => !!x.destino), 'CSC: sin filas sin clasificar');
} else {
  console.log(`\n(SKIP) fixture real no encontrado: ${FIXTURE}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
