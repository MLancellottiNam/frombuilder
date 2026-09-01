// ---------------------------------------------------------------------------
// Etapa 0 — Lectura CRUDA del AcroForm del PDF.
//
// Se recorre /AcroForm/Fields a mano (raw dict walk) en vez de usar la API de
// alto nivel de pdf-lib, porque esa se rompe con campos jerárquicos tipo
// `Casilla de verificación1.0.7.1.2.3`.
//
// Reglas:
//  - el full name se arma concatenando el /T de cada nivel con '.'
//  - un nodo cuyos /Kids son todos widgets (sin /T propio) es UN campo con
//    varios widgets, no varios campos
//  - /FT se hereda del padre si el nodo no lo declara
//  - el orden de lectura es (page, -Y, X): el orden nativo del diccionario NO
//    sirve (en el CSC provincia sale #35, distrito #37 y cantón #85)
// ---------------------------------------------------------------------------

// Type-only: TypeScript los borra al compilar, así que pdf-lib sigue siendo lazy.
import type { PDFDict as TPDFDict, PDFRef as TPDFRef } from 'pdf-lib';

export interface Rect {
  /** esquina inferior izquierda (coordenadas PDF, origen abajo-izquierda) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfWidget {
  page: number; // 0-based
  rect: Rect;
}

export type FieldType = '/Tx' | '/Btn' | '/Ch' | '/Sig' | string;

export interface PdfLeaf {
  /** full name concatenando los /T de cada nivel */
  name: string;
  ft: FieldType;
  /** página y rect del widget primario (el primero en orden de lectura) */
  page: number;
  rect: Rect;
  /** todos los widgets del campo (>1 cuando el campo se pinta en varios lugares) */
  widgets: PdfWidget[];
  /** 1-based, tras ordenar por (page, -Y, X) */
  readingIndex: number;
  /**
   * Un /Btn con varios widgets es normal (grupo de radios/checkboxes). Un /Tx
   * con más de un widget es sospechoso: suele ser una colisión real del PDF
   * (dos campos distintos que pintan el mismo valor). No se resuelve solo.
   */
  multiWidgetSospechoso: boolean;
  /** páginas donde aparece (útil cuando el campo cruza páginas) */
  paginas: number[];
}

export interface PdfFieldsResult {
  leaves: PdfLeaf[];
  pageCount: number;
  pageSizes: { width: number; height: number }[];
  /** nombres repetidos en el propio PDF (colisiones preexistentes) */
  duplicados: Record<string, number>;
  /** campos /Tx con más de un widget (colisiones sospechosas, §11.1) */
  sospechosos: PdfLeaf[];
  totalWidgets: number;
  warnings: string[];
}

/** Ordena por (page, -Y, X): arriba→abajo, izquierda→derecha. */
export function compareReadingOrder(a: { page: number; rect: Rect }, b: { page: number; rect: Rect }): number {
  if (a.page !== b.page) return a.page - b.page;
  // Y mayor = más arriba en la página (origen abajo-izquierda).
  const ay = a.rect.y + a.rect.h;
  const by = b.rect.y + b.rect.h;
  if (Math.abs(ay - by) > 1.5) return by - ay;
  return a.rect.x - b.rect.x;
}

/**
 * Lee los campos del AcroForm. `pdf-lib` se importa lazy: Etapa 1 y 2 no pagan
 * este bundle si el usuario nunca abre el renombrador.
 */
export async function readPdfFields(data: ArrayBuffer | Uint8Array): Promise<PdfFieldsResult> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber, PDFRef } = await import('pdf-lib');
  const warnings: string[] = [];

  const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const pageSizes = pages.map((p) => ({ width: p.getWidth(), height: p.getHeight() }));

  // Mapa: ref de anotación -> índice de página.
  const annotPage = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const entry = annots.get(k);
      if (entry instanceof PDFRef) annotPage.set(entry.toString(), i);
    }
  });

  const decodeText = (v: unknown): string => {
    if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
    return '';
  };

  const readRect = (dict: TPDFDict): Rect | null => {
    const arr = dict.lookupMaybe(PDFName.of('Rect'), PDFArray);
    if (!arr || arr.size() < 4) return null;
    const n = (i: number) => {
      const v = arr.lookup(i);
      return v instanceof PDFNumber ? v.asNumber() : 0;
    };
    const x1 = n(0);
    const y1 = n(1);
    const x2 = n(2);
    const y2 = n(3);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  };

  // campos crudos; readingIndex/paginas/multiWidgetSospechoso se calculan al final
  const leaves: Omit<PdfLeaf, 'readingIndex' | 'paginas' | 'multiWidgetSospechoso'>[] = [];
  const seen = new Set<string>(); // evita loops por refs repetidas

  const walk = (
    entry: unknown,
    parentName: string,
    inheritedFt: FieldType,
    depth: number,
  ): void => {
    if (depth > 30) {
      warnings.push('Profundidad de campos > 30: se cortó la recursión.');
      return;
    }
    let ref: TPDFRef | null = null;
    let dict: TPDFDict | null = null;
    if (entry instanceof PDFRef) {
      ref = entry;
      const key = entry.toString();
      if (seen.has(key)) return;
      seen.add(key);
      const looked = ctx.lookup(entry);
      dict = looked instanceof PDFDict ? looked : null;
    } else if (entry instanceof PDFDict) {
      dict = entry;
    }
    if (!dict) return;

    const partial = decodeText(dict.lookup(PDFName.of('T')));
    const full = partial ? (parentName ? `${parentName}.${partial}` : partial) : parentName;
    const ftRaw = dict.lookup(PDFName.of('FT'));
    const ft: FieldType = ftRaw ? ftRaw.toString() : inheritedFt;

    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids && kids.size() > 0) {
      // ¿Los kids son campos (tienen /T) o widgets del mismo campo?
      const kidEntries: unknown[] = [];
      let kidsConT = 0;
      for (let i = 0; i < kids.size(); i++) {
        const k = kids.get(i);
        kidEntries.push(k);
        const kd = k instanceof PDFRef ? ctx.lookup(k) : k;
        if (kd instanceof PDFDict && decodeText(kd.lookup(PDFName.of('T')))) kidsConT++;
      }

      if (kidsConT === 0) {
        // Todos widgets -> UN campo con varios widgets.
        const widgets: PdfWidget[] = [];
        for (const k of kidEntries) {
          const kd = k instanceof PDFRef ? ctx.lookup(k) : k;
          if (!(kd instanceof PDFDict)) continue;
          const rect = readRect(kd);
          if (!rect) continue;
          const page = k instanceof PDFRef ? annotPage.get(k.toString()) ?? 0 : 0;
          widgets.push({ page, rect });
        }
        if (widgets.length === 0) {
          warnings.push(`Campo "${full}" sin /Rect en sus widgets: se omite.`);
          return;
        }
        widgets.sort(compareReadingOrder);
        leaves.push({ name: full, ft, page: widgets[0].page, rect: widgets[0].rect, widgets });
        return;
      }

      // Nodo jerárquico -> recursión.
      for (const k of kidEntries) walk(k, full, ft, depth + 1);
      return;
    }

    // Terminal: el propio dict es campo + widget (merged).
    const rect = readRect(dict);
    if (!rect) {
      // Un nodo sin /Rect ni /Kids no pinta nada (p.ej. campo puramente lógico).
      warnings.push(`Campo "${full}" sin /Rect ni /Kids: se omite.`);
      return;
    }
    const page = ref ? annotPage.get(ref.toString()) ?? 0 : 0;
    leaves.push({ name: full, ft, page, rect, widgets: [{ page, rect }] });
  };

  const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields || fields.size() === 0) {
    warnings.push('El PDF no tiene /AcroForm/Fields (¿no es un formulario?).');
  } else {
    for (let i = 0; i < fields.size(); i++) walk(fields.get(i), '', '/Tx', 0);
  }

  // Orden de lectura (page, -Y, X).
  leaves.sort(compareReadingOrder);
  const ordered: PdfLeaf[] = leaves.map((l, i) => {
    const paginas = Array.from(new Set(l.widgets.map((w) => w.page))).sort((a, b) => a - b);
    return {
      ...l,
      readingIndex: i + 1,
      paginas,
      multiWidgetSospechoso: l.ft === '/Tx' && l.widgets.length > 1,
    };
  });

  // Colisiones de nombre preexistentes en el propio PDF.
  const counts = new Map<string, number>();
  for (const l of ordered) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  const duplicados: Record<string, number> = {};
  for (const [n, c] of counts) if (c > 1) duplicados[n] = c;

  const sospechosos = ordered.filter((l) => l.multiWidgetSospechoso);
  if (sospechosos.length > 0) {
    warnings.push(
      `${sospechosos.length} campo(s) /Tx con varios widgets (posible colisión del PDF): ` +
        sospechosos.map((l) => `${l.name} ×${l.widgets.length} [p${l.paginas.map((p) => p + 1).join(',')}]`).join(' · '),
    );
  }
  const sigs = ordered.filter((l) => l.ft === '/Sig').length;
  if (sigs === 0) warnings.push('El PDF no tiene campos de firma (/Sig): las firmas serán líneas dibujadas.');

  return {
    leaves: ordered,
    pageCount: pages.length,
    pageSizes,
    duplicados,
    sospechosos,
    totalWidgets: ordered.reduce((n, l) => n + l.widgets.length, 0),
    warnings,
  };
}
