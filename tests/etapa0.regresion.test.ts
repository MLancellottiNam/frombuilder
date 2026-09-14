// ---------------------------------------------------------------------------
// Anti-regresión sobre PDFs reales: el renombrado sólo puede tocar /T.
//
// La regla de fondo del fix de las casillas: /AP, /AS, /DA, /MK, /FT y /Ff
// tienen que salir byte por byte como entraron. Acá se verifica widget por
// widget sobre los PDFs que estén en `fixtures/`, comparando la entrada contra
// la salida del renombrado.
//
// `fixtures/` está gitignoreada (no entran documentos del cliente al repo), así
// que si no hay PDFs el test se SALTEA diciendo qué le falta, no se rompe ni se
// da por bueno. Los 4 de Equipo Electrónico —D0714 entre ellos, que es donde
// apareció el bug— se declaran abajo para que el salteo diga cuáles faltan.
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { readPdfFields } from '../src/lib/etapa0/pdfFields';
import { escribirPdfRenombrado } from '../src/lib/etapa0/writePdf';
import { pdfConCasilla } from './helpers/pdfCasilla';

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error('FAIL: ' + m);
    fail++;
  } else console.log('PASS: ' + m);
};

const DIR = path.join(__dirname, '..', 'fixtures');
/** Los que interesan especialmente; si faltan, el salteo los nombra. */
const ESPERADOS = ['D0714', 'D0715', 'D0716', 'D0717'];

/** Claves que el renombrado NO puede tocar. */
const NO_TOCABLES = ['AP', 'AS', 'DA', 'MK', 'FT', 'Ff'] as const;

interface Widget {
  clave: string;
  /** huella de cada clave no tocable, como se escribe en el archivo */
  huella: Record<string, string>;
}

/** Serializa un objeto del PDF a su forma escrita, resolviendo referencias. */
function escrito(doc: PDFDocument, v: unknown, prof = 0): string {
  if (v === undefined) return '—';
  if (prof > 4) return '…';
  const obj = v instanceof PDFRef ? doc.context.lookup(v) : v;
  if (obj instanceof PDFDict) {
    return (
      '<<' +
      obj
        .keys()
        .map((k) => `${k.asString()} ${escrito(doc, obj.get(k), prof + 1)}`)
        .sort()
        .join(' ') +
      '>>'
    );
  }
  if (obj instanceof PDFArray) {
    const partes: string[] = [];
    for (let i = 0; i < obj.size(); i++) partes.push(escrito(doc, obj.get(i), prof + 1));
    return '[' + partes.join(' ') + ']';
  }
  // Un stream de apariencia: lo que importa es que siga estando y con la misma
  // clave, no su contenido (que el visor regenera por /NeedAppearances).
  return obj ? obj.toString().slice(0, 200) : '—';
}

/** Todos los widgets del PDF, indexados por página + rect. */
async function inventario(data: Uint8Array): Promise<Map<string, Widget>> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, throwOnInvalidObject: false });
  const out = new Map<string, Widget>();
  doc.getPages().forEach((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const e = annots.get(k);
      const d = e instanceof PDFRef ? doc.context.lookup(e) : e;
      if (!(d instanceof PDFDict)) continue;
      const rect = d.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (!rect) continue;
      const clave = `${i}|${escrito(doc, rect)}`;
      const huella: Record<string, string> = {};
      for (const c of NO_TOCABLES) huella[c] = escrito(doc, d.get(PDFName.of(c)));
      out.set(clave, { clave, huella });
    }
  });
  return out;
}

async function revisar(nombre: string, data: Uint8Array) {
  const leido = await readPdfFields(data);
  if (leido.leaves.length === 0) {
    console.log(`SKIP: ${nombre} no tiene campos de AcroForm`);
    return;
  }

  // Renombrado agresivo: TODOS los campos cambian de nombre. Lo único que puede
  // cambiar en el archivo es /T.
  const renombres = new Map(leido.leaves.map((l, i) => [l.name, `campo_${String(i + 1).padStart(3, '0')}`]));
  const antes = await inventario(data);
  const res = await escribirPdfRenombrado(data, renombres, {});
  const despues = await inventario(res.bytes);

  ok(res.renombrados === leido.leaves.length, `${nombre}: se renombraron los ${leido.leaves.length} campos`);
  ok(despues.size === antes.size, `${nombre}: mismos ${antes.size} widgets antes y después (got ${despues.size})`);

  const distintas: string[] = [];
  let comparadas = 0;
  for (const [clave, w] of antes) {
    const d = despues.get(clave);
    if (!d) {
      distintas.push(`${clave}: el widget no está en la salida`);
      continue;
    }
    for (const c of NO_TOCABLES) {
      comparadas++;
      // /AS es la excepción declarada: los botones salen sin estado marcado.
      if (c === 'AS' && w.huella.AS !== '—' && d.huella.AS === '/Off') continue;
      if (w.huella[c] !== d.huella[c]) distintas.push(`${clave} /${c}: «${w.huella[c]}» -> «${d.huella[c]}»`);
    }
  }
  ok(
    distintas.length === 0,
    `${nombre}: ${comparadas} claves no tocables intactas` +
      (distintas.length ? `; ${distintas.length} cambiaron:\n    ` + distintas.slice(0, 6).join('\n    ') : ''),
  );

  // Y el detalle que motivó todo: ningún estado de exportación con `#23`.
  // Hace falta aparte porque la comparación de arriba lee las dos puntas con el
  // mismo lente: si la corrupción pasara en la lectura, entrada y salida se
  // verían igual de rotas y la huella coincidiría.
  const sucios = [...despues.values()].filter((w) => w.huella.AP.includes('#23'));
  ok(sucios.length === 0, `${nombre}: ningún /AP con el escape roto #23 (got ${sucios.length})`);
}

(async () => {
  const pdfs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  const faltan = ESPERADOS.filter((e) => !pdfs.some((p) => p.includes(e)));
  if (faltan.length > 0) {
    console.log(
      `SKIP: no están en fixtures/ los PDFs de Equipo Electrónico ${faltan.join(', ')} ` +
        `(la carpeta está gitignoreada: son documentos del cliente). El fixture sintético del ` +
        `estado acentuado sí corre, en test:names.`,
    );
  }
  // El sintético corre SIEMPRE: es el único documento del repo que tiene un
  // estado de exportación acentuado, así que sin él la anti-regresión pasaría
  // sola en cualquier máquina sin los PDFs del cliente.
  await revisar('casilla-sintetica.pdf', await pdfConCasilla('minuscula'));
  if (pdfs.length === 0) {
    console.log('SKIP: no hay ningún PDF del cliente en fixtures/; sólo corrió el sintético.');
  }
  for (const f of pdfs) await revisar(f, new Uint8Array(fs.readFileSync(path.join(DIR, f))));

  console.log(fail === 0 ? '\nOK' : `\n${fail} fallo(s)`);
  process.exit(fail === 0 ? 0 : 1);
})();
