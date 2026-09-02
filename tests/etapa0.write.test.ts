// Test de v1.5.0 — escritura del PDF renombrado, ficha con col N y reporte.
// Todo sobre fixtures sintéticos: no hace falta el material del cliente.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { readPdfFields } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado, capDA } from '../src/lib/etapa0/writePdf';
import { detectarAvisosColM, escribirFichaConColN } from '../src/lib/etapa0/writeFicha';
import { construirReporte } from '../src/lib/etapa0/reporte';
import { buildFichaRaw, type FichaRow } from '../src/lib/etapa0/fichaRaw';
import type { NombrePropuesto } from '../src/lib/etapa0/acroName';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

/** PDF con jerarquía, valores cargados, tooltip y /DA gigante. */
async function buildPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const form = doc.getForm();

  const a = form.createTextField('Profesión');
  a.setText('dato viejo');
  a.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });

  const b = form.createTextField('padre.hijo');
  b.setText('otro dato');
  b.addToPage(p1, { x: 50, y: 650, width: 200, height: 20 });

  const c = form.createCheckBox('acepta');
  c.check();
  c.addToPage(p1, { x: 50, y: 600, width: 12, height: 12 });

  // tooltip + /DA con auto-size en el campo "Profesión"
  const dict = a.acroField.dict;
  dict.set(PDFName.of('TU'), PDFString.of('tooltip que miente'));
  dict.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));

  return doc.save();
}

/** Hoja de ficha mínima con el header de 14 columnas. */
function hojaFicha(): string[][] {
  const header = [
    'Pasos Formulario', 'Sección', 'Nombre en PDF', 'Nombre del campo en formulario', 'Tipo de dato',
    'Valor', 'Regla', 'Obligatorio', 'Formulario a visualizar', 'Visualización en Formularios',
    'Observaciones', 'Nombre de la sección del JSON', 'Nombre del campo en el JSON',
    'Nombre interno del campo en PDF',
  ];
  const fila = (nombrePdf: string, campoJson: string) =>
    ['1', 'Datos', nombrePdf, nombrePdf, 'Texto', '', '', 'Si', 'CSC', '', '', 'personas', campoJson, ''];
  return [
    header,
    fila('Nombre completo', 'personas.nombreCompleto'),
    fila('Tipo de identificación', 'personas.TipoIdentificacion'),
    fila('Fecha de constitución', 'personas.fechaConstitución'),
    fila('Otro nombre', 'personas.nombrecompleto'),
  ];
}

(async () => {
  // --- capDA -------------------------------------------------------------
  ok(capDA('/Helv 0 Tf 0 g', 10) === '/Helv 10 Tf 0 g', 'capDA: auto-size (0) -> tope');
  ok(capDA('/Helv 18 Tf 0 g', 10) === '/Helv 10 Tf 0 g', 'capDA: 18pt -> tope');
  ok(capDA('/Helv 8 Tf 0 g', 10) === '/Helv 8 Tf 0 g', 'capDA: 8pt no se toca');

  // --- escritura del PDF --------------------------------------------------
  const original = await buildPdf();
  const antes = await readPdfFields(original);
  ok(antes.leaves.length === 3, `3 campos antes (got ${antes.leaves.length})`);
  ok(antes.leaves.some((l) => l.name === 'padre.hijo'), 'el nombre jerárquico se lee como padre.hijo');

  const renombres = new Map<string, string>([
    // renombrado circular: A pasa a llamarse como B y B como A
    ['Profesión', 'padre.hijo'],
    ['padre.hijo', 'detalle_domicilio_extranjero'],
    ['acepta', 'asg_acepta_terminos'],
  ]);
  const w = await escribirPdfRenombrado(original, renombres, { limitarFuente: true, tamanoFuente: 10 });
  ok(w.renombrados === 3, `3 campos renombrados (got ${w.renombrados})`);
  ok(w.limpiados >= 2, `al menos 2 campos traían valor (got ${w.limpiados})`);

  const despues = await readPdfFields(w.bytes);
  const nombres = despues.leaves.map((l) => l.name).sort();
  ok(despues.leaves.length === 3, `3 campos después (got ${despues.leaves.length})`);
  ok(
    JSON.stringify(nombres) === JSON.stringify(['asg_acepta_terminos', 'detalle_domicilio_extranjero', 'padre.hijo']),
    'los 3 nombres nuevos están, incluido el intercambio circular: ' + nombres.join(', '),
  );
  ok(
    despues.leaves.every((l) => l.ft === antes.leaves.find((x) => renombres.get(x.name) === l.name)?.ft),
    'cada campo conserva su /FT tras aplanar',
  );

  // valores / tooltip limpiados y /DA topeado
  const doc2 = await PDFDocument.load(w.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const acro = doc2.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)!;
  const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray)!;
  ok(fields.size() === 3, `/AcroForm/Fields quedó plano con 3 entradas (got ${fields.size()})`);
  let conValor = 0;
  let conTU = 0;
  let conParent = 0;
  let daOk = 0;
  for (let i = 0; i < fields.size(); i++) {
    const d = doc2.context.lookup(fields.get(i)) as InstanceType<typeof PDFDict>;
    if (d.get(PDFName.of('V')) !== undefined) conValor++;
    if (d.get(PDFName.of('TU')) !== undefined) conTU++;
    if (d.get(PDFName.of('Parent')) !== undefined) conParent++;
    const da = d.lookup(PDFName.of('DA'));
    if (da instanceof PDFString && /\s10 Tf/.test(da.decodeText())) daOk++;
  }
  ok(conValor === 0, `ningún campo conserva /V (got ${conValor})`);
  ok(conTU === 0, `ningún campo conserva /TU (got ${conTU})`);
  ok(conParent === 0, `ningún campo conserva /Parent (got ${conParent})`);
  ok(daOk >= 1, `el /DA con auto-size quedó topeado a 10pt (got ${daOk})`);
  ok(acro.get(PDFName.of('NeedAppearances')) !== undefined, '/NeedAppearances quedó seteado');

  // --- Fix D: el assert de post-escritura no deja pasar duplicados ---------
  const conColision = new Map<string, string>([
    ['Profesión', 'mismo_nombre'],
    ['padre.hijo', 'mismo_nombre'],
  ]);
  let tiro = '';
  try {
    await escribirPdfRenombrado(original, conColision, {});
  } catch (e) {
    tiro = String(e);
  }
  ok(/duplicados/.test(tiro), 'escribir con nombres duplicados tira Error, no warning: ' + tiro.slice(0, 90));
  ok(/mismo_nombre/.test(tiro), 'el error nombra la colisión concreta');

  // Colisión contra un campo que NO se renombra (queda con su nombre original).
  let tiro2 = '';
  try {
    await escribirPdfRenombrado(original, new Map([['Profesión', 'acepta']]), {});
  } catch (e) {
    tiro2 = String(e);
  }
  ok(/duplicados/.test(tiro2), 'también detecta la colisión contra un campo sin renombrar');

  // --- avisos de la col M -------------------------------------------------
  const ficha = buildFichaRaw([{ name: 'personas', aoa: hojaFicha() }]);
  ok(ficha.rows.length === 4, `4 filas de ficha (got ${ficha.rows.length})`);
  const avisos = detectarAvisosColM(ficha.rows);
  const tipos = new Set(avisos.map((a) => a.tipo));
  ok(tipos.has('mayuscula-inicial'), 'detecta TipoIdentificacion (mayúscula inicial)');
  ok(tipos.has('no-ascii'), 'detecta fechaConstitución (acento)');
  ok(tipos.has('grafia-inconsistente'), 'detecta nombreCompleto vs nombrecompleto');
  ok(
    avisos.every((a) => a.hoja === 'personas' && a.fila >= 2),
    'cada aviso apunta a hoja y fila reales',
  );

  // --- escritura de la ficha ---------------------------------------------
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaFicha()), 'personas');
  const xlsxBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

  const colN = ficha.sheets[0].colCampoPdfInterno;
  ok(colN === 13, `col N detectada en el índice 13 (got ${colN})`);
  const valores = new Map([
    ['personas', new Map([[2, 'nombre_completo'], [3, 'tipo_identificacion, tipo_identificacion_2']])],
  ]);
  const escrita = await escribirFichaConColN(xlsxBytes, valores, {
    colPorHoja: new Map([['personas', colN]]),
  });
  ok(escrita.celdasEscritas === 2, `2 celdas escritas (got ${escrita.celdasEscritas})`);

  const releida = XLSX.read(escrita.bytes, { type: 'array' });
  const aoa = XLSX.utils.sheet_to_json<string[]>(releida.Sheets['personas'], { header: 1, defval: '', raw: false });
  ok(String(aoa[1][13]) === 'nombre_completo', `fila 2 col N = nombre_completo (got "${aoa[1][13]}")`);
  ok(
    String(aoa[2][13]) === 'tipo_identificacion, tipo_identificacion_2',
    `fila 3 col N con relación 1:N (got "${aoa[2][13]}")`,
  );
  ok(String(aoa[3][13] ?? '') === '', 'la fila no asignada queda con col N vacía');
  ok(String(aoa[1][2]) === 'Nombre completo', 'el resto de la fila queda intacto');

  // --- reporte ------------------------------------------------------------
  const np = (r: FichaRow): NombrePropuesto => ({
    fila: { ...r, instancia: null, indiceInstancia: null },
    nombre: 'x',
    colision: false,
    partes: { prefijo: '', base: 'x', sufijo: '' },
  });
  const rep = construirReporte({
    leaves: despues.leaves,
    nombreFinal: (i) => despues.leaves[i].name,
    filaDeLeaf: (i) => (i === 0 ? np(ficha.rows[0]) : null),
    confianzaDeLeaf: (i) => (i === 0 ? 'alta' : undefined),
    motivosDeLeaf: () => ['posición consistente entre vecinos alineados'],
    huerfanosFicha: [np(ficha.rows[1])],
    colisiones: new Set<string>(['padre.hijo']),
    avisosColM: avisos,
  });
  ok(rep.resumen.asignados === 1, `reporte: 1 asignado (got ${rep.resumen.asignados})`);
  ok(rep.resumen.huerfanosPdf === 2, `reporte: 2 huérfanos PDF (got ${rep.resumen.huerfanosPdf})`);
  ok(rep.resumen.huerfanosFicha === 1, 'reporte: 1 huérfano ficha');
  ok(rep.resumen.colisiones === 1, 'reporte: 1 colisión');
  ok(rep.resumen.avisos === avisos.length, 'reporte: todos los avisos de col M');
  ok(rep.csv.split('\n')[0].startsWith('seccion,nombre_actual,nombre_nuevo'), 'CSV con header esperado');
  ok(rep.filas.some((f) => f.seccion === 'nota' && /\/Sig/.test(f.detalle)), 'reporte: nota de ausencia de /Sig');
  ok(
    rep.filas.some((f) => f.seccion === 'asignado' && f.detalle.includes('COLISIÓN')),
    'reporte: marca la colisión en la fila del campo',
  );

  console.log(fail === 0 ? '\nOK — todos los asserts pasaron' : `\n${fail} assert(s) fallaron`);
  process.exit(fail === 0 ? 0 : 1);
})();
