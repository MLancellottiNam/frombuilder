// Test de v1.0.0 — lectura de ficha cruda multi-hoja.
// Corre con: npm run test:etapa0
// El fixture real del cliente (fixtures/) es opcional: si no está, se saltea.

import * as fs from 'fs';
import * as path from 'path';
import { buildFichaRaw, findMarcadores, norm, puntuarFilaNota, UMBRAL_NOTA, type RawSheet } from '../src/lib/etapa0/fichaRaw';

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
    // Reproduce el bug real: en el CSC esta hoja tiene 28 celdas "No aplica"
    // en col J y col N (valor de enum), y CERO exclusiones de bloque.
    name: 'encabezado',
    aoa: [
      HEADER,
      row({ A: 'JSON', B: 'JSON', C: 'No se llena en PDF', D: 'Tipo Tramite', J: 'No Aplica', N: 'No aplica', M: 'encabezado.codigoTipoTramite' }),
      row({ A: 'JSON', B: 'JSON', C: 'No se llena en PDF', D: 'Correo', J: 'No Aplica', N: 'No aplica', M: 'encabezado.correo' }),
      row({ A: 'Datos Generales', B: 'Solicitud', C: 'Nombre del asegurado', D: 'Nombre', E: 'Texto', J: 'editable', M: 'encabezado.nombre' }),
      row({ A: 'Datos Generales', B: 'Solicitud', C: '', D: 'Segundo Nombre', E: 'Texto', J: 'No Aplica', M: 'encabezado.segundoNombre' }),
      // fila con contenido SOLO en una columna mapeada distinta de las 4 "clásicas"
      row({ F: 'Colones' }),
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
      // fila de CONTRATO dentro de una hoja que NO aplica (precedencia JSON-first)
      row({ A: 'JSON', B: 'JSON', C: 'No se llena en PDF', D: 'Cod poliza', M: 'polizaMadre.codigo' }),
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

// --- bloques (BUG FIX: encabezado no debe generar ninguno) ---
ok(res.stats.bloquesExcluidos === 2, `2 bloques excluidos en total (got ${res.stats.bloquesExcluidos})`);
ok(
  res.bloquesExcluidos.every((b) => b.hoja === 'personas'),
  'los bloques excluidos son SOLO de personas (encabezado: 0 falsos positivos)',
);
ok(
  res.rows.filter((r) => r.hoja === 'encabezado' && r.motivo === 'bloque-no-aplica').length === 0,
  'ninguna fila de encabezado quedó excluida por bloque',
);
// una fila con contenido solo en col F igual cuenta como dato (conteo total)
ok(
  res.rows.some((r) => r.hoja === 'encabezado' && r.valor === 'Colones'),
  'fila con contenido solo en col F se cuenta como dato',
);
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
ok(enHojaExcluida?.destino === 'excluida' && enHojaExcluida.motivo === 'hoja-no-aplica', 'fila NO-JSON de hoja excluida sigue excluida');

// --- columnas C y L presentes ---
ok(nombre.nombrePdf === 'Nombre del asegurado', 'col C (Nombre en PDF) mapeada');
ok(res.rows.some((r) => r.campoJson.startsWith('personas.')), 'col M mapeada');

// --- invariante: ninguna fila sin clasificar ---
ok(
  res.rows.every((r) => r.destino === 'pdf' || r.destino === 'solo-json' || r.destino === 'excluida'),
  'no quedan filas sin clasificar',
);
ok(res.stats.pdf + res.stats.soloJson + res.stats.excluidas === res.stats.filasDatos, 'la partición suma el total');

// --- A.1: reconciliación auditable -----------------------------------------
ok(res.stats.filasMarcadorHoja === 2, `2 filas-marcador de HOJA (got ${res.stats.filasMarcadorHoja})`);
ok(res.stats.filasMarcadorBloque === 2, `2 filas-marcador de BLOQUE (got ${res.stats.filasMarcadorBloque})`);
ok(res.stats.filasMarcador === 4, `4 anotaciones en total (got ${res.stats.filasMarcador})`);
ok(
  res.stats.filasConContenido === res.stats.filasMarcador + res.stats.pdf + res.stats.soloJson + res.stats.excluidas,
  'reconciliación: filasConContenido === marcador + pdf + soloJSON + excluidas',
);
ok(
  res.stats.filasConContenido === res.stats.filasMarcador + res.stats.filasDatos,
  'filasConContenido === filasMarcador + filasDatos',
);
// breakdown por hoja suma el total
const sumaHojas = res.sheets.reduce((n, s2) => n + s2.pdf + s2.soloJson + s2.excluidas, 0);
ok(sumaHojas === res.stats.filasDatos, 'el breakdown por hoja suma las filas de datos');

// --- precedencia JSON-first + hojaAplica ------------------------------------
const contratoEnHojaMuerta = res.rows.find((r) => r.hoja === 'polizaMadre' && r.label === 'Cod poliza')!;
ok(contratoEnHojaMuerta?.destino === 'solo-json' && contratoEnHojaMuerta.motivo === 'contrato-json',
  'JSON-first: contrato gana sobre la exclusión de hoja');
ok(contratoEnHojaMuerta?.hojaAplica === false,
  'pero queda marcado hojaAplica=false (no se pierde el matiz)');
const contratoNormal = res.rows.find((r) => r.hoja === 'encabezado' && r.label === 'Tipo Tramite')!;
ok(contratoNormal?.hojaAplica === true, 'un contrato en hoja que sí aplica lleva hojaAplica=true');

// --- marcadores: normalización y alcance ---
const m = findMarcadores([['', 'sección   no   aplica para este formulario']]);
ok(m.length === 1 && m[0].alcance === 'bloque', 'marcador normalizado (acentos/espacios) -> bloque');
const m2 = findMarcadores([['ESTA HOJA NO APLICA PARA EL FORMULARIO'], ['x']]);
ok(m2[0]?.alcance === 'hoja', 'texto con HOJA -> alcance hoja');

// --- BUG FIX: "No aplica" como enum en col J / N NO es marcador -------------
ok(findMarcadores([['No aplica']]).length === 0, 'enum "No aplica" solo NO es marcador (falta HOJA/SECCIÓN y FORMULARIO)');
ok(findMarcadores([['No Aplica', 'No aplica']]).length === 0, 'varias celdas "No aplica" no generan marcadores');
ok(
  findMarcadores([['SECCIÓN NO APLICA']]).length === 0,
  'sin la palabra FORMULARIO no es marcador',
);
// col J (idx 9) y col N (idx 13) nunca se escanean, aunque tuvieran el texto completo
const filaJN: string[][] = [[]];
filaJN[0][9] = 'SECCIÓN NO APLICA PARA ESTE FORMULARIO';
filaJN[0][13] = 'ESTA HOJA NO APLICA PARA EL FORMULARIO';
ok(
  findMarcadores(filaJN, { regla: 6, visualizacion: 9, campoPdfInterno: 13 }).length === 0,
  'J y N nunca se escanean',
);
// el marcador de bloque solo vale en col G (idx 6)
const bloqueFueraDeG: string[][] = [[]];
bloqueFueraDeG[0][2] = 'SECCIÓN NO APLICA PARA ESTE FORMULARIO';
ok(
  findMarcadores(bloqueFueraDeG, { regla: 6 }).length === 0,
  'marcador de bloque fuera de col G se ignora',
);
const bloqueEnG: string[][] = [[]];
bloqueEnG[0][6] = 'SECCIÓN NO APLICA PARA ESTE FORMULARIO';
ok(findMarcadores(bloqueEnG, { regla: 6 })[0]?.alcance === 'bloque', 'marcador de bloque en col G sí vale');
// el marcador de HOJA sí puede estar en cualquier columna (menos J/N)
const hojaEnC: string[][] = [[]];
hojaEnC[0][2] = 'ESTA HOJA NO APLICA PARA EL FORMULARIO';
ok(findMarcadores(hojaEnC, { regla: 6 })[0]?.alcance === 'hoja', 'marcador de HOJA vale fuera de col G');

// --------------------------------------------------------------------------
// Fixture REAL (opcional, gitignoreado).
// --------------------------------------------------------------------------
// --- Fix A: puntaje de fila-nota (unidad, sin fixture) ---
// La señal decisiva es estructural (sin D, sin E, sin M). El largo del texto es
// una señal débil a propósito: si decidiera sola, se comería las preguntas PEP.
{
  const nota = { nombrePdf: 'Esta sección es obligatoria e invariable en cada Producto / Formulario / JSON', label: '', tipo: '', campoJson: '' };
  const notaCorta = { nombrePdf: 'Dentro de datosFormulario', label: '', tipo: '', campoJson: '' };
  const campoLargo = {
    nombrePdf: '¿Desempeña o ha desempeñado algún cargo político destacado (PEP1), en territorio nacional o en el extranjero?',
    label: 'PEP', tipo: 'Casilla de verificación', campoJson: 'datosFormulario.personas.pep1',
  };
  const campoSinM = { nombrePdf: 'Lugar', label: 'Lugar', tipo: 'Texto', campoJson: '' };

  ok(puntuarFilaNota(nota).score >= UMBRAL_NOTA, `nota larga supera el umbral (${puntuarFilaNota(nota).score} >= ${UMBRAL_NOTA})`);
  ok(puntuarFilaNota(notaCorta).score >= UMBRAL_NOTA, `nota de 3 palabras también (${puntuarFilaNota(notaCorta).score})`);
  ok(puntuarFilaNota(campoLargo).score < UMBRAL_NOTA, `campo de 16 palabras NO es nota (${puntuarFilaNota(campoLargo).score})`);
  ok(puntuarFilaNota(campoSinM).score < UMBRAL_NOTA, `campo real sin col M NO es nota (${puntuarFilaNota(campoSinM).score})`);
  ok(puntuarFilaNota({ nombrePdf: '', label: '', tipo: '', campoJson: '' }).score === 0, 'sin col C no es candidata a nota');
  ok(puntuarFilaNota(nota).señales.length >= 4, 'la nota expone sus señales para mostrarlas en la UI');
}

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
  // A.1 cerrado: 177 filas CON CONTENIDO = 4 marcador + 173 datos.
  // El reparto de las 173 depende de dos decisiones ya tomadas:
  //  - precedencia JSON-first: una fila con A === 'JSON' en hoja NO APLICA cuenta
  //    como solo-JSON (con hojaAplica=false), no como excluida.
  //  - v1.4.1 Fix A: las 3 filas-nota salen del bucket `pdf` (64 -> 61) y pasan a
  //    excluidas con motivo 'fila-nota'.
  ok(r.stats.filasConContenido === 177, `CSC: 177 filas con contenido (got ${r.stats.filasConContenido})`);
  ok(r.stats.filasMarcadorHoja === 4, `CSC: 4 filas-marcador de hoja (got ${r.stats.filasMarcadorHoja})`);
  ok(r.stats.filasDatos === 173, `CSC: 173 filas de datos (got ${r.stats.filasDatos})`);
  ok(r.stats.pdf === 61, `CSC: 61 van al PDF tras Fix A (got ${r.stats.pdf})`);
  ok(r.stats.soloJson === 46, `CSC: 46 solo-JSON = 33 contrato + 13 sin-campo-pdf (got ${r.stats.soloJson})`);
  ok(r.stats.excluidas === 66, `CSC: 66 excluidas = 15 hoja + 48 bloque + 3 nota (got ${r.stats.excluidas})`);
  ok(
    r.stats.filasConContenido === r.stats.filasMarcador + r.stats.pdf + r.stats.soloJson + r.stats.excluidas,
    'CSC: 177 === 4 + 61 + 46 + 66',
  );

  // --- Fix A: filas-nota fuera del bucket pdf ---
  ok(r.stats.filasNota === 3, `CSC: 3 filas-nota detectadas (got ${r.stats.filasNota})`);
  const notas = r.rows.filter((x) => x.motivo === 'fila-nota').map((x) => `${x.hoja}-${x.fila}`);
  ok(
    JSON.stringify(notas.sort()) === JSON.stringify(['datosFormulario-15', 'datosGenerales-15', 'encabezado-22']),
    'CSC: las filas-nota son exactamente encabezado-22, datosFormulario-15 y datosGenerales-15: ' + notas.join(', '),
  );
  ok(
    r.rows.filter((x) => x.motivo === 'fila-nota').every((x) => (x.notaSeñales ?? []).length >= 3),
    'CSC: cada fila-nota expone al menos 3 señales del puntaje',
  );
  // Lo que NO se debe tocar: las preguntas PEP son largas pero son campos reales.
  const pep = r.rows.filter((x) => /cargo politico destacado/.test(norm(x.nombrePdf)));
  ok(pep.length >= 6, `CSC: hay ${pep.length} filas PEP de texto largo`);
  ok(
    pep.every((x) => x.destino === 'pdf'),
    'CSC: ninguna pregunta PEP (16-23 palabras) cae como fila-nota',
  );
  const largas = r.rows.filter((x) => x.destino === 'pdf' && x.nombrePdf.trim().split(/\s+/).length > 8);
  ok(largas.length >= 8, `CSC: ${largas.length} campos PDF legítimos con col C de más de 8 palabras sobreviven`);
  // breakdown por hoja (col "datos" de la tabla del cliente incluye la fila-marcador)
  const esperado: Record<string, number> = {
    encabezado: 19, datosFormulario: 1, datosGenerales: 5, intermediario: 5, polizaMadre: 11,
    datosAdicionales: 1, personas: 117, riesgo: 2, direccion: 10, mediosNotificacion: 6,
  };
  for (const [hoja, n] of Object.entries(esperado)) {
    const si = r.sheets.find((x) => x.name === hoja);
    const got = si ? si.filasDatos + si.filasMarcador : -1;
    ok(got === n, `CSC ${hoja}: ${n} filas con contenido (got ${got})`);
  }
  ok(r.stats.hojasNodo === 10, `CSC: 10 hojas de nodo (got ${r.stats.hojasNodo})`);
  ok(r.stats.hojasNoAplica === 4, `CSC: 4 hojas no-aplica (got ${r.stats.hojasNoAplica})`);
  ok(r.stats.bloquesExcluidos === 2, `CSC: 2 bloques excluidos (got ${r.stats.bloquesExcluidos})`);
  ok(r.rows.every((x) => !!x.destino), 'CSC: sin filas sin clasificar');
} else {
  console.log(`\n(SKIP) fixture real no encontrado: ${FIXTURE}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
