// Test de v1.2.0 — instancias + nombre propuesto + colisiones.

import {
  slug,
  parseCodigosInstancia,
  instanciasPorDefecto,
  detectarBloquesInstanciables,
  expandirInstancias,
  marcarGruposDeOpciones,
  generarNombres,
  contarColisiones,
  type FilaExpandida,
} from '../src/lib/etapa0/acroName';
import type { FichaRow } from '../src/lib/etapa0/fichaRaw';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const mk = (o: Partial<FichaRow>): FichaRow => ({
  hoja: 'personas', nodo: 'personas', fila: 1, pasos: '', seccion: '', nombrePdf: '', label: '',
  tipo: '', valor: '', regla: '', obligatorio: '', formulario: '', visualizacion: '',
  observaciones: '', seccionJson: '', campoJson: '', campoPdfInterno: '',
  destino: 'pdf', hojaAplica: true, ...o,
});

// --- slug ---
ok(slug('Tipo de Identificación') === 'tipo_de_identificacion', 'slug: minúsculas, sin acentos, espacios -> _');
ok(slug('Sí, y quiero sustituirlo') === 'si_y_quiero_sustituirlo', 'slug: saca puntuación');
ok(slug('  País/Provincia  ') === 'pais_provincia', 'slug: trim y separadores');

// --- B.1 códigos de instancia ---
ok(
  JSON.stringify(parseCodigosInstancia('"ASG","PJR","RPL" (ver catálogo)')) === JSON.stringify(['ASG', 'PJR', 'RPL']),
  'parsea códigos entrecomillados ignorando "(ver catálogo)"',
);
ok(
  JSON.stringify(parseCodigosInstancia('ASG, PJR, RPL')) === JSON.stringify(['ASG', 'PJR', 'RPL']),
  'parsea códigos sin comillas',
);
ok(parseCodigosInstancia('').length === 0, 'celda vacía -> sin códigos');
ok(parseCodigosInstancia('Colones').length === 1, 'un solo valor -> un código');

const inst = instanciasPorDefecto(['ASG', 'PJR', 'RPL']);
ok(inst.length === 3 && inst[0].prefijo === 'asg' && inst[0].indice === 0, 'instancias por defecto: prefijo slug + índice incremental');
ok(inst.every((i) => i.activa), 'todas activas por defecto');

// --- detección del bloque instanciable ---
const filas: FichaRow[] = [
  mk({ fila: 2, nombrePdf: 'Tipo Persona', label: 'Tipo Persona', valor: '"ASG","PJR","RPL" (ver catálogo)', campoJson: 'personas.codigoTipo' }),
  mk({ fila: 3, nombrePdf: 'Tipo de Identificación', label: 'Tipo de Identificación', valor: 'Física', campoJson: 'personas.tipoId' }),
  mk({ fila: 4, nombrePdf: 'Tipo de Identificación', label: 'Tipo de Identificación', valor: 'DIMEX', campoJson: 'personas.tipoId' }),
  mk({ fila: 5, nombrePdf: 'Nombre completo', label: 'Nombre', campoJson: 'personas.nombre' }),
];
const bloques = detectarBloquesInstanciables(filas);
ok(bloques.length === 1 && bloques[0].codigos.length === 3, 'detecta el bloque instanciable por la fila codigoTipo');

// --- expansión ---
const expandidas = expandirInstancias(filas, 'personas', inst);
ok(expandidas.length === filas.length * 3, `cada fila se clona 1 vez por instancia (${expandidas.length})`);
ok(expandidas.filter((r) => r.instancia?.codigo === 'PJR').length === filas.length, 'la instancia PJR tiene todas las filas');
ok(expandidas[0].indiceInstancia === 0, 'la fila arrastra el índice de personas[]');

// descartar una instancia
const sinPjr = inst.map((i) => (i.codigo === 'PJR' ? { ...i, activa: false } : i));
ok(expandirInstancias(filas, 'personas', sinPjr).length === filas.length * 2, 'una instancia desactivada no se clona');

// índice editable, no inventado
const idxCustom = [
  { codigo: 'ASG', prefijo: 'asg', indice: 0, activa: true },
  { codigo: 'PJR', prefijo: 'pjr', indice: 10, activa: true },
  { codigo: 'RPL', prefijo: 'rpl', indice: 11, activa: true },
];
const conIdx = expandirInstancias(filas, 'personas', idxCustom);
ok(
  conIdx.filter((r) => r.instancia?.codigo === 'RPL').every((r) => r.indiceInstancia === 11),
  'respeta el índice personas[] que pone el usuario (11), no lo inventa',
);

// --- B.2 grupos de opciones ---
const soloAsg = expandirInstancias(filas, 'personas', [idxCustom[0]]);
const grupos = marcarGruposDeOpciones(soloAsg);
ok(grupos[1] && grupos[2], 'las 2 filas consecutivas con el mismo label son grupo de opciones');
ok(!grupos[0] && !grupos[3], 'las filas sueltas NO son grupo');

// --- nombres propuestos ---
const nombres = generarNombres(soloAsg);
const byLabel = (v: string) => nombres.find((n) => n.fila.valor === v)!;
ok(byLabel('Física').nombre === 'asg_tipo_de_identificacion_fisica', 'grupo -> lleva sufijo del valor (col F)');
ok(byLabel('DIMEX').nombre === 'asg_tipo_de_identificacion_dimex', 'segunda opción del grupo');
const simple = nombres.find((n) => n.fila.campoJson === 'personas.nombre')!;
ok(simple.nombre === 'asg_nombre_completo', 'campo simple -> SIN sufijo, usa col C');
ok(nombres.every((n) => !n.colision), 'sin colisiones en el caso feliz');

// --- colisiones: se marcan, no se desambiguan ---
const chocan: FilaExpandida[] = [
  { ...mk({ fila: 1, nombrePdf: 'Nombre', label: 'A' }), instancia: null, indiceInstancia: null },
  { ...mk({ fila: 2, nombrePdf: 'Nombre', label: 'B' }), instancia: null, indiceInstancia: null },
];
const nc = generarNombres(chocan);
ok(nc[0].nombre === 'nombre' && nc[1].nombre === 'nombre', 'NO se desambigua con contador ciego (_1/_2)');
ok(nc[0].colision && nc[1].colision, 'ambas quedan marcadas como colisión');
ok(contarColisiones(nc)['nombre'] === 2, 'contarColisiones reporta el nombre y cuántas veces');

// --- filas que no van al PDF no compiten ---
const mixto: FilaExpandida[] = [
  { ...mk({ nombrePdf: 'X', destino: 'solo-json' }), instancia: null, indiceInstancia: null },
  { ...mk({ nombrePdf: 'X', destino: 'excluida' }), instancia: null, indiceInstancia: null },
  { ...mk({ nombrePdf: 'X', destino: 'pdf' }), instancia: null, indiceInstancia: null },
];
const nm = generarNombres(mixto);
ok(nm[0].nombre === '' && nm[1].nombre === '', 'solo-json y excluida quedan sin nombre propuesto');
ok(nm[2].nombre === 'x' && !nm[2].colision, 'la fila que va al PDF no colisiona con las que no van');

// --- las instancias no chocan entre sí ---
const tresInst = generarNombres(expandirInstancias(filas, 'personas', idxCustom));
ok(tresInst.filter((n) => n.colision).length === 0, 'el prefijo de instancia evita colisiones entre ASG/PJR/RPL');
ok(
  tresInst.some((n) => n.nombre === 'rpl_nombre_completo') && tresInst.some((n) => n.nombre === 'pjr_nombre_completo'),
  'cada instancia genera su propio nombre',
);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
