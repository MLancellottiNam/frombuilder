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

/** Nombre actual (full name leído) -> nombre final que hay que escribir. */
export type MapaRenombres = Map<string, string>;

export interface WritePdfOpts {
  /** Aplica un tope de tamaño de fuente al /DA de cada campo. */
  limitarFuente?: boolean;
  /** Tope en puntos (default 10). También reemplaza el auto-size (0 Tf). */
  tamanoFuente?: number;
}

export interface WritePdfResult {
  bytes: Uint8Array;
  /** campos cuyo /T efectivamente cambió */
  renombrados: number;
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
        for (const k of kidEntries) {
          const kd = ctx.lookup(k as never);
          if (kd instanceof PDFDict) widgets.push(kd);
        }
        terminales.push({ full, dict, ref, heredado: propio, widgets });
        return;
      }
      for (const k of kidEntries) walk(k, full, propio, depth + 1);
      return;
    }

    // terminal merged campo+widget
    terminales.push({ full, dict, ref, heredado: propio, widgets: [dict] });
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

  for (const t of terminales) {
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

  // /AcroForm/Fields plano + regenerar apariencias al abrir.
  acro.set(PDFName.of('Fields'), ctx.obj(nuevosRefs));
  acro.set(PDFName.of('NeedAppearances'), ctx.obj(true));

  // `updateFieldAppearances: false` es obligatorio: la API de alto nivel que
  // usa pdf-lib para regenerarlas se rompe con estos campos.
  const bytes = await doc.save({ updateFieldAppearances: false });

  return { bytes, renombrados, campos: terminales.length, limpiados, warnings };
}
