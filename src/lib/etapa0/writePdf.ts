// ---------------------------------------------------------------------------
// Etapa 0 — Escritura del PDF renombrado.
//
// Igual que la lectura, se trabaja sobre el diccionario CRUDO. La API de alto
// nivel de `pdf-lib` (`form.getField(...)`) indexa por nombre y se rompe con
// los campos jerárquicos del INS.
//
// Qué hace:
//  1. Recorre /AcroForm/Fields y junta los nodos TERMINALES (los mismos que
//     devuelve `readPdfFields`), con los atributos heredables ya resueltos.
//  2. A cada terminal le pone /T = nombre final y lo desengancha de la
//     jerarquía (borra /Parent), dejando /AcroForm/Fields PLANO. Signframe
//     necesita nombres planos: si quedara la jerarquía, el full name volvería a
//     ser `padre.hijo` y el `sourceMeta` no coincidiría.
//  3. Limpia /V, /DV, /TU, /TM y /RV: el PDF plantilla no debe viajar con datos
//     ni con tooltips que contradigan el nombre nuevo.
//  4. Opcional: tope de tamaño de fuente en el /DA (por defecto 10pt), para que
//     el texto autoajustable no se vea gigante al rellenar.
//
// Sobre los "renombrados circulares" (A→B y B→A, frecuente cuando parte del PDF
// ya viene renombrado): acá NO son un problema y no hace falta un nombre
// intermedio. El renombre se aplica sobre la IDENTIDAD del objeto (el dict
// terminal), no sobre una tabla indexada por nombre; dos objetos distintos
// pueden intercambiar sus /T sin pisarse. Lo que sí se valida antes de llegar
// acá es que los nombres FINALES no colisionen entre sí.
// ---------------------------------------------------------------------------

import type { PDFDict as TPDFDict, PDFRef as TPDFRef } from 'pdf-lib';
import { readPdfFields } from './pdfFields';
import type { CampoCreado } from './camposManuales';

/** Nombre actual (full name leído) -> nombre final que hay que escribir. */
export type MapaRenombres = Map<string, string>;

export interface WritePdfOpts {
  /** Aplica un tope de tamaño de fuente al /DA de cada campo. */
  limitarFuente?: boolean;
  /** Tope en puntos (default 10). También reemplaza el auto-size (0 Tf). */
  tamanoFuente?: number;
  /** Campos dibujados a mano que hay que agregar al PDF (v1.4.4). */
  creados?: CampoCreado[];
  /** Nombres ACTUALES de los campos detectados que hay que quitar. */
  borrados?: string[];
}

export interface WritePdfResult {
  bytes: Uint8Array;
  /** campos cuyo /T efectivamente cambió */
  renombrados: number;
  /** campos agregados a mano */
  creados: number;
  /** campos detectados que se quitaron */
  borrados: number;
  /** campos tocados en total (todos se limpian, aunque no cambien de nombre) */
  campos: number;
  /** campos a los que se les borró algún valor (/V o /DV) */
  limpiados: number;
  warnings: string[];
}

/** Ajusta `/Helv 0 Tf` -> `/Helv 10 Tf` cuando el tamaño es 0 (auto) o > tope. */
export function capDA(da: string, tope: number): string {
  return da.replace(/(\/[^\s/]+)\s+([\d.]+)\s+Tf/g, (m, font: string, size: string) => {
    const n = Number(size);
    if (Number.isFinite(n) && n > 0 && n <= tope) return m;
    return `${font} ${tope} Tf`;
  });
}

/** Claves que un campo hereda del padre y que hay que bajar antes de aplanar. */
const HEREDABLES = ['FT', 'Ff', 'DA', 'Q', 'MaxLen', 'Opt'] as const;

interface Terminal {
  full: string;
  dict: TPDFDict;
  ref: TPDFRef | null;
  /** valores heredados de ancestros, ya resueltos */
  heredado: Record<string, unknown>;
  widgets: TPDFDict[];
  /** refs de los widgets, para poder sacarlos del /Annots al borrar */
  widgetRefs: TPDFRef[];
}

export async function escribirPdfRenombrado(
  data: ArrayBuffer | Uint8Array,
  renombres: MapaRenombres,
  opts: WritePdfOpts = {},
): Promise<WritePdfResult> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRef } = await import('pdf-lib');
  const warnings: string[] = [];
  const tope = opts.tamanoFuente ?? 10;

  const doc = await PDFDocument.load(data, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const ctx = doc.context;
  const pages = doc.getPages();

  const decodeText = (v: unknown): string => {
    if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
    return '';
  };
  /**
   * ASCII (incluidos tab/CR/LF) -> string literal; con acentos -> hex UTF-16BE.
   * Los saltos de línea importan: el /DA que escribe pdf-lib es multilínea y si
   * se codificara en hex con BOM, el visor no lo podría interpretar como
   * operadores PostScript.
   */
  // eslint-disable-next-line no-control-regex
  const textoPdf = (s: string) => (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s));

  const terminales: Terminal[] = [];
  const seen = new Set<string>();

  const walk = (entry: unknown, parentName: string, heredado: Record<string, unknown>, depth: number): void => {
    if (depth > 30) {
      warnings.push('Profundidad de campos > 30: se cortó la recursión.');
      return;
    }
    let ref: TPDFRef | null = null;
    let dict: TPDFDict | null = null;
    if (entry instanceof PDFRef) {
      ref = entry;
      const key = ref.toString();
      if (seen.has(key)) return;
      seen.add(key);
      const looked = ctx.lookup(ref);
      dict = looked instanceof PDFDict ? looked : null;
    } else if (entry instanceof PDFDict) {
      dict = entry;
    }
    if (!dict) return;

    const partial = decodeText(dict.lookup(PDFName.of('T')));
    const full = partial ? (parentName ? `${parentName}.${partial}` : partial) : parentName;

    // acumular heredables para los hijos
    const propio: Record<string, unknown> = { ...heredado };
    for (const k of HEREDABLES) {
      const v = dict.get(PDFName.of(k));
      if (v !== undefined) propio[k] = v;
    }

    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids && kids.size() > 0) {
      const kidEntries: unknown[] = [];
      let kidsConT = 0;
      for (let i = 0; i < kids.size(); i++) {
        const k = kids.get(i);
        kidEntries.push(k);
        const kd = ctx.lookup(k as never);
        if (kd instanceof PDFDict && decodeText(kd.lookup(PDFName.of('T')))) kidsConT++;
      }
      if (kidsConT === 0) {
        const widgets: TPDFDict[] = [];
        const widgetRefs: TPDFRef[] = [];
        for (const k of kidEntries) {
          const kd = ctx.lookup(k as never);
          if (kd instanceof PDFDict) widgets.push(kd);
          if (k instanceof PDFRef) widgetRefs.push(k);
        }
        terminales.push({ full, dict, ref, heredado: propio, widgets, widgetRefs });
        return;
      }
      for (const k of kidEntries) walk(k, full, propio, depth + 1);
      return;
    }

    // terminal merged campo+widget
    terminales.push({ full, dict, ref, heredado: propio, widgets: [dict], widgetRefs: ref ? [ref] : [] });
  };

  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acro) {
    throw new Error('El PDF no tiene /AcroForm: no hay campos para renombrar.');
  }
  const fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields || fields.size() === 0) {
    throw new Error('El PDF no tiene /AcroForm/Fields: no hay campos para renombrar.');
  }
  for (let i = 0; i < fields.size(); i++) walk(fields.get(i), '', {}, 0);

  // XFA dinámico: el visor ignora el AcroForm y el renombrado no se vería.
  if (acro.get(PDFName.of('XFA')) !== undefined) {
    acro.delete(PDFName.of('XFA'));
    warnings.push('El PDF traía /XFA (formulario dinámico): se eliminó para que valga el AcroForm renombrado.');
  }

  let renombrados = 0;
  let limpiados = 0;
  const nuevosRefs: TPDFRef[] = [];

  // --- borrados: fuera de /AcroForm/Fields y del /Annots de su página -------
  const aBorrar = new Set(opts.borrados ?? []);
  const refsBorradas = new Set<string>();
  let borrados = 0;
  for (const t of terminales) {
    if (!aBorrar.has(t.full)) continue;
    borrados++;
    for (const r of t.widgetRefs) refsBorradas.add(r.toString());
    if (t.ref) refsBorradas.add(t.ref.toString());
  }
  const pedidosSinCampo = [...aBorrar].filter((n) => !terminales.some((t) => t.full === n));
  if (pedidosSinCampo.length > 0) {
    warnings.push(`Se pidió borrar ${pedidosSinCampo.length} campo(s) que no están en el PDF: ${pedidosSinCampo.join(', ')}.`);
  }

  for (const t of terminales) {
    if (aBorrar.has(t.full)) continue; // borrado: no entra a /Fields
    // 1) bajar heredables que el terminal no declara (al aplanar pierde al padre)
    for (const k of HEREDABLES) {
      if (t.dict.get(PDFName.of(k)) === undefined && t.heredado[k] !== undefined) {
        t.dict.set(PDFName.of(k), t.heredado[k] as never);
      }
    }

    // 2) nombre final
    const final = renombres.get(t.full) ?? t.full;
    if (final !== t.full) renombrados++;
    t.dict.set(PDFName.of('T'), textoPdf(final));

    // 3) limpiar datos y textos que contradigan el nombre nuevo
    if (t.dict.get(PDFName.of('V')) !== undefined || t.dict.get(PDFName.of('DV')) !== undefined) limpiados++;
    for (const k of ['V', 'DV', 'TU', 'TM', 'RV']) t.dict.delete(PDFName.of(k));

    // 4) desenganchar de la jerarquía: /AcroForm/Fields queda plano
    t.dict.delete(PDFName.of('Parent'));

    // 5) botones: sin estado seleccionado
    const ft = t.dict.get(PDFName.of('FT'));
    if (ft && ft.toString() === '/Btn') {
      for (const w of t.widgets) w.set(PDFName.of('AS'), PDFName.of('Off'));
    }

    // 6) tope de fuente
    if (opts.limitarFuente) {
      const da = t.dict.lookup(PDFName.of('DA'));
      const texto = decodeText(da);
      if (texto) t.dict.set(PDFName.of('DA'), textoPdf(capDA(texto, tope)));
      for (const w of t.widgets) {
        if (w === t.dict) continue;
        const wda = decodeText(w.lookup(PDFName.of('DA')));
        if (wda) w.set(PDFName.of('DA'), textoPdf(capDA(wda, tope)));
      }
    }

    nuevosRefs.push(t.ref ?? ctx.register(t.dict));
  }

  if (opts.limitarFuente) {
    const daDoc = decodeText(acro.lookup(PDFName.of('DA')));
    if (daDoc) acro.set(PDFName.of('DA'), textoPdf(capDA(daDoc, tope)));
  }

  // --- creados: un widget nuevo por campo dibujado a mano -------------------
  const creados = opts.creados ?? [];
  const nuevosPorPagina = new Map<number, TPDFRef[]>();
  let conFirma = false;
  for (const c of creados) {
    const pagina = pages[c.page];
    if (!pagina) {
      warnings.push(`El campo creado «${c.nombre}» apunta a la página ${c.page + 1}, que no existe: se omite.`);
      continue;
    }
    const dict: Record<string, unknown> = {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of(c.tipo.replace(/^\//, '')),
      T: textoPdf(c.nombre),
      Rect: ctx.obj([c.rect.x, c.rect.y, c.rect.x + c.rect.w, c.rect.y + c.rect.h]),
      // /F 4 = Print: sin esto el campo existe pero no se imprime ni exporta.
      F: ctx.obj(4),
      P: pagina.ref,
      DA: textoPdf(`/Helv ${opts.limitarFuente ? tope : 10} Tf 0 g`),
    };
    if (c.tipo === '/Btn') {
      // Una casilla necesita estado y apariencias on/off para ser válida. El
      // contenido lo regenera el visor por /NeedAppearances; lo que importa es
      // que la estructura esté completa.
      dict.AS = PDFName.of('Off');
      dict.MK = ctx.obj({ BC: ctx.obj([0, 0, 0]), BG: ctx.obj([1, 1, 1]) });
      const vacio = () =>
        ctx.register(
          ctx.stream('', {
            Type: PDFName.of('XObject'),
            Subtype: PDFName.of('Form'),
            BBox: ctx.obj([0, 0, c.rect.w, c.rect.h]),
          }),
        );
      dict.AP = ctx.obj({ N: ctx.obj({ Off: vacio(), On: vacio() }) });
    }
    if (c.tipo === '/Sig') conFirma = true;
    const ref = ctx.register(ctx.obj(dict as never));
    nuevosRefs.push(ref);
    if (!nuevosPorPagina.has(c.page)) nuevosPorPagina.set(c.page, []);
    nuevosPorPagina.get(c.page)!.push(ref);
  }
  // Un AcroForm con campos de firma tiene que declararlo.
  if (conFirma) acro.set(PDFName.of('SigFlags'), ctx.obj(3));

  // --- /Annots de cada página: sacar los borrados, sumar los creados --------
  pages.forEach((pagina, i) => {
    const annots = pagina.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const quedan: unknown[] = [];
    if (annots) {
      for (let k = 0; k < annots.size(); k++) {
        const entry = annots.get(k);
        if (entry instanceof PDFRef && refsBorradas.has(entry.toString())) continue;
        quedan.push(entry);
      }
    }
    const sumar = nuevosPorPagina.get(i) ?? [];
    if (!annots && sumar.length === 0) return;
    pagina.node.set(PDFName.of('Annots'), ctx.obj([...quedan, ...sumar] as never));
  });

  // /AcroForm/Fields plano + regenerar apariencias al abrir.
  acro.set(PDFName.of('Fields'), ctx.obj(nuevosRefs));
  acro.set(PDFName.of('NeedAppearances'), ctx.obj(true));

  // `updateFieldAppearances: false` es obligatorio: la API de alto nivel que
  // usa pdf-lib para regenerarlas se rompe con estos campos.
  const bytes = await doc.save({ updateFieldAppearances: false });

  // Assert de post-escritura: se relee lo que se acaba de generar y se exige
  // que la cantidad de nombres ÚNICOS coincida con la de campos. Un PDF con
  // nombres duplicados es inservible para Signframe, así que es ERROR, no
  // warning. El bloqueo de la UI es defensa en profundidad, no la única línea:
  // acá se cubre cualquier camino (ediciones a mano, otro llamador, un bug
  // futuro en la siembra).
  const releido = await readPdfFields(bytes);
  const unicos = new Set(releido.leaves.map((l) => l.name));
  const dup = Object.entries(releido.duplicados);
  if (unicos.size !== releido.leaves.length || dup.length > 0) {
    throw new Error(
      `El PDF renombrado quedó con nombres duplicados (${releido.leaves.length} campos, ` +
        `${unicos.size} nombres únicos) y no sirve para Signframe. Resolvé las colisiones antes de escribir: ` +
        dup
          .slice(0, 10)
          .map(([n, c]) => `"${n}" ×${c}`)
          .join(' · ') +
        (dup.length > 10 ? ' …' : ''),
    );
  }
  const esperados = terminales.length - borrados + creados.length;
  if (releido.leaves.length !== esperados) {
    throw new Error(
      `El PDF renombrado no tiene la cantidad de campos esperada: ${terminales.length} detectados ` +
        `- ${borrados} borrados + ${creados.length} creados = ${esperados}, y salieron ${releido.leaves.length}.`,
    );
  }

  return {
    bytes,
    renombrados,
    creados: creados.length,
    borrados,
    campos: esperados,
    limpiados,
    warnings,
  };
}
