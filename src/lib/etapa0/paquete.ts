// ---------------------------------------------------------------------------
// Etapa 0 — Paquete de campos (v2.0.0).
//
// EL CAMBIO DE FOCO. Hasta v1.4.5 la app intentaba resolver el mapeo ficha↔PDF
// con heurísticas (regiones, DP, anclas, umbrales). El techo no era de
// calibración: la ficha y el PDF NO comparten ninguna clave —la col N, que era
// la clave, viene vacía en 163 de 177 filas— y hay decisiones que solo salen de
// entender el formulario, no de un score:
//   - un campo que cubre «País y lugar de nacimiento» Y «Nacionalidad»,
//   - la ficha dice «Física» donde el PDF imprime «Cédula»,
//   - un grupo de 8 opciones que el PDF parte 5 / 4,
//   - dos campos rotulados «Detalle:» por región contra UNA fila de ficha.
//
// Así que la app deja de adivinar y hace lo que una máquina hace mejor que una
// persona: leer el AcroForm, medir la geometría y extraer el texto impreso. El
// resultado es este paquete, y el mapeo se resuelve afuera, con juicio.
//
// EL PAQUETE TIENE QUE SER AUTOSUFICIENTE: quien lo lea resuelve el mapeo con
// esto, la ficha y el PDF impreso, sin abrir la app. De ahí que las columnas más
// valiosas no sean las del AcroForm sino las del texto: `etiqueta_impresa`,
// `etiquetas_candidatas` y `texto_zona`.
//
// Una fila por WIDGET, en orden de lectura. Un campo con dos widgets aparece en
// dos filas con el mismo `#` y el mismo `nombre_actual`: eso es exactamente lo
// que hay que ver —un solo nombre pintando en dos lugares—.
// ---------------------------------------------------------------------------

import type { PdfLeaf, Rect } from './pdfFields';
import { compareReadingOrder } from './pdfFields';
import { etiquetaPreferida, etiquetasDeLeaf, type TextItem } from './textoPdf';

/** Distancia horizontal máxima para considerar un texto como rótulo del campo. */
export const MAX_DIST_CANDIDATA = 260;
/** Media altura de la banda de `texto_zona`, en puntos PDF. */
export const ALTO_ZONA = 14;
/** Tope de largo de `texto_zona`: es contexto, no el documento entero. */
export const MAX_ZONA = 400;

export interface FilaPaquete {
  '#': number;
  nombre_actual: string;
  nombre_nuevo: string;
  tipo: string;
  pagina: number | '';
  x: number | '';
  y: number | '';
  w: number | '';
  h: number | '';
  etiqueta_impresa: string;
  etiquetas_candidatas: string;
  texto_zona: string;
  multi_widget: string;
  origen: string;
  notas: string;
  /**
   * Lo que vino completado desde afuera, por nombre de columna. Se arrastra tal
   * cual: la app no lo interpreta ni lo pisa.
   */
  externas?: Record<string, string>;
}

/**
 * Columnas que completa la SKILL, afuera. La app no las toca nunca: las escribe
 * vacías la primera vez, las conserva cuando el paquete vuelve, y las vuelve a
 * escribir al reexportar. El archivo tiene que poder dar vueltas sin perder
 * información, porque es la única memoria del mapeo.
 *
 * `notas` es de la app (multi-widget, avisos de la col M), no de afuera.
 */
export const COLUMNAS_EXTERNAS = [
  'seccion',
  'subseccion',
  'label',
  'ruta_json',
  'required',
  'validaciones',
  'grupo',
  'valor',
  'instancia',
] as const;

export type ColumnaExterna = (typeof COLUMNAS_EXTERNAS)[number];

/** Lo que la app escribe, en orden. */
export const HEADERS_APP: (keyof FilaPaquete)[] = [
  '#',
  'nombre_actual',
  'nombre_nuevo',
  'tipo',
  'pagina',
  'x',
  'y',
  'w',
  'h',
  'etiqueta_impresa',
  'etiquetas_candidatas',
  'texto_zona',
  'multi_widget',
  'origen',
  'notas',
];

/** El header completo: primero lo de la app, después lo de afuera. */
export const HEADERS_PAQUETE: string[] = [...(HEADERS_APP as string[]), ...COLUMNAS_EXTERNAS];

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Todos los textos que podrían ser el rótulo de un widget, ordenados por
 * cercanía. La preferida (§`etiquetaPreferida`: izquierda para `/Tx`, derecha
 * para `/Btn`) sale aparte; el resto va a `etiquetas_candidatas`, porque cuando
 * la preferida está equivocada la correcta casi siempre es una de estas y quien
 * resuelve el mapeo no tiene por qué volver a abrir el PDF para verla.
 */
export function candidatasDeWidget(
  page: number,
  rect: Rect,
  texto: TextItem[],
  tolerancia = 9,
): string[] {
  const cy = rect.y + rect.h / 2;
  const enLinea = texto.filter(
    (t) =>
      !t.rotado &&
      t.page === page &&
      Math.abs(t.y + 3 - cy) <= tolerancia &&
      // Un texto de solo guiones o puntos es el placeholder de la línea a
      // completar, no un rótulo.
      /[a-z0-9]/i.test(t.str),
  );
  const conDistancia = enLinea
    .map((t) => {
      const derecha = t.x >= rect.x - 4;
      const dist = derecha ? t.x - rect.x : rect.x - (t.x + t.w);
      return { str: t.str.trim(), dist };
    })
    .filter((c) => c.str && c.dist <= MAX_DIST_CANDIDATA)
    .sort((a, b) => a.dist - b.dist);

  const vistos = new Set<string>();
  const out: string[] = [];
  for (const c of conDistancia) {
    if (vistos.has(c.str)) continue;
    vistos.add(c.str);
    out.push(c.str);
  }
  return out;
}

/**
 * El texto impreso de la banda donde cae el widget: la franja horizontal de la
 * página a su altura. Es el contexto que desambigua un rótulo repetido
 * («Detalle:» aparece dos veces por región).
 */
export function textoDeZona(page: number, rect: Rect, texto: TextItem[], alto = ALTO_ZONA): string {
  const cy = rect.y + rect.h / 2;
  const s = texto
    .filter((t) => !t.rotado && t.page === page && Math.abs(t.y + 3 - cy) <= alto)
    .sort((a, b) => a.x - b.x)
    .map((t) => t.str.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > MAX_ZONA ? s.slice(0, MAX_ZONA - 1) + '…' : s;
}

export interface EntradaPaquete {
  /** lista EFECTIVA de campos (detectados − borrados + creados) */
  leaves: PdfLeaf[];
  /** nombre final de cada campo, por índice en `leaves` */
  nombreFinal: (i: number) => string;
  /** texto impreso del PDF; si viene vacío las columnas de texto quedan vacías */
  texto: TextItem[];
  /** campos detectados que el usuario borró (van al paquete, marcados) */
  borrados?: PdfLeaf[];
  /** nota extra por campo (avisos de col M cuando hubo ficha importada, etc.) */
  notaDeLeaf?: (i: number) => string | undefined;
}

/** Una fila por widget, ordenadas por el orden de lectura del widget. */
export function construirPaquete(e: EntradaPaquete): FilaPaquete[] {
  interface Pendiente {
    fila: FilaPaquete;
    page: number;
    rect: Rect;
  }
  const pendientes: Pendiente[] = [];

  e.leaves.forEach((leaf, i) => {
    const final = e.nombreFinal(i);
    const notas: string[] = [];
    if (leaf.multiWidgetSospechoso) {
      notas.push(`/Tx con ${leaf.widgets.length} widgets: suele ser una colisión del PDF original`);
    }
    if (!leaf.name) notas.push('el campo no tiene /T en el PDF');
    const extra = e.notaDeLeaf?.(i);
    if (extra) notas.push(extra);

    leaf.widgets.forEach((wid, k) => {
      const candidatas = e.texto.length ? candidatasDeWidget(wid.page, wid.rect, e.texto) : [];
      const preferida = e.texto.length
        ? etiquetaPreferida({ ...leaf, page: wid.page, rect: wid.rect }, etiquetasDeLeaf({ ...leaf, page: wid.page, rect: wid.rect }, e.texto))[0] ?? ''
        : '';
      pendientes.push({
        page: wid.page,
        rect: wid.rect,
        fila: {
          '#': leaf.readingIndex,
          nombre_actual: leaf.name,
          nombre_nuevo: final === leaf.name ? '' : final,
          tipo: leaf.ft,
          pagina: wid.page + 1,
          x: r1(wid.rect.x),
          y: r1(wid.rect.y),
          w: r1(wid.rect.w),
          h: r1(wid.rect.h),
          etiqueta_impresa: preferida,
          etiquetas_candidatas: candidatas.filter((c) => c !== preferida).slice(0, 6).join(' | '),
          texto_zona: e.texto.length ? textoDeZona(wid.page, wid.rect, e.texto) : '',
          multi_widget:
            leaf.widgets.length > 1
              ? `${k + 1} de ${leaf.widgets.length} (págs ${leaf.paginas.map((p) => p + 1).join(',')})`
              : '',
          origen: leaf.origen === 'creado' ? 'creado' : 'detectado',
          notas: notas.join(' · '),
        },
      });
    });
  });

  pendientes.sort((a, b) => compareReadingOrder(a, b));
  const filas = pendientes.map((p) => p.fila);

  // Los borrados van al final: no tienen lugar en el orden de lectura de la
  // salida, pero quien resuelve el mapeo tiene que saber que existían.
  for (const leaf of e.borrados ?? []) {
    filas.push({
      '#': leaf.readingIndex,
      nombre_actual: leaf.name,
      nombre_nuevo: '',
      tipo: leaf.ft,
      pagina: leaf.page + 1,
      x: r1(leaf.rect.x),
      y: r1(leaf.rect.y),
      w: r1(leaf.rect.w),
      h: r1(leaf.rect.h),
      etiqueta_impresa: e.texto.length ? etiquetaPreferida(leaf, etiquetasDeLeaf(leaf, e.texto))[0] ?? '' : '',
      etiquetas_candidatas: '',
      texto_zona: '',
      multi_widget: '',
      origen: 'borrado',
      notas: 'el usuario lo quitó del PDF de salida',
    });
  }

  return filas;
}

/**
 * El aoa que se escribe al xlsx. Las columnas de afuera se vuelven a escribir
 * tal como vinieron: si el paquete dio una vuelta por la skill y volvió, al
 * reexportarlo tiene que seguir teniendo todo. Y si el archivo trajo columnas
 * que no conocemos, también viajan.
 */
export function paqueteAAoa(filas: FilaPaquete[]): (string | number)[][] {
  const extrasVistas: string[] = [];
  for (const f of filas) {
    for (const k of Object.keys(f.externas ?? {})) {
      if (!extrasVistas.includes(k) && !(COLUMNAS_EXTERNAS as readonly string[]).includes(k)) extrasVistas.push(k);
    }
  }
  const header = [...HEADERS_PAQUETE, ...extrasVistas];
  const valor = (f: FilaPaquete, h: string): string | number => {
    if ((HEADERS_APP as string[]).includes(h)) return (f as unknown as Record<string, string | number>)[h] ?? '';
    return f.externas?.[h] ?? '';
  };
  return [header, ...filas.map((f) => header.map((h) => valor(f, h)))];
}

export interface PaqueteLeido {
  filas: FilaPaquete[];
  /** columnas del archivo que no escribe la app */
  columnasExternas: string[];
  avisos: string[];
}

/**
 * Lee un paquete (aoa del xlsx). Todo lo que no sea columna de la app se guarda
 * en `externas` sin interpretarlo: es lo que resolvió la skill y la app no tiene
 * derecho a tocarlo.
 */
export function leerPaqueteAoa(aoa: (string | number)[][]): PaqueteLeido {
  const avisos: string[] = [];
  const idx = aoa.findIndex((fila) => {
    const c = (fila ?? []).map((x) => String(x ?? '').trim().toLowerCase());
    return c.includes('nombre_actual') && c.includes('nombre_nuevo');
  });
  if (idx < 0) {
    return { filas: [], columnasExternas: [], avisos: ['El archivo no tiene los encabezados del paquete de campos.'] };
  }
  const header = (aoa[idx] ?? []).map((x) => String(x ?? '').trim());
  const propias = new Set(HEADERS_APP as string[]);
  const columnasExternas = header.filter((h) => h && !propias.has(h));

  const filas: FilaPaquete[] = [];
  for (let i = idx + 1; i < aoa.length; i++) {
    const celdas = aoa[i] ?? [];
    if (celdas.every((c) => String(c ?? '').trim() === '')) continue;
    const get = (h: string) => String(celdas[header.indexOf(h)] ?? '').trim();
    const num = (h: string) => {
      const v = Number(get(h));
      return Number.isFinite(v) ? v : '';
    };
    const externas: Record<string, string> = {};
    for (const h of columnasExternas) {
      const v = get(h);
      if (v) externas[h] = v;
    }
    filas.push({
      '#': Number(get('#')) || 0,
      nombre_actual: get('nombre_actual'),
      nombre_nuevo: get('nombre_nuevo'),
      tipo: get('tipo'),
      pagina: num('pagina'),
      x: num('x'),
      y: num('y'),
      w: num('w'),
      h: num('h'),
      etiqueta_impresa: get('etiqueta_impresa'),
      etiquetas_candidatas: get('etiquetas_candidatas'),
      texto_zona: get('texto_zona'),
      multi_widget: get('multi_widget'),
      origen: get('origen'),
      notas: get('notas'),
      externas,
    });
  }
  const conExternas = filas.filter((f) => Object.keys(f.externas ?? {}).length > 0).length;
  if (columnasExternas.length > 0) {
    avisos.push(
      `El paquete trae ${columnasExternas.length} columna(s) completadas afuera (${columnasExternas.join(', ')}) en ${conExternas} fila(s): se conservan tal cual.`,
    );
  }
  return { filas, columnasExternas, avisos };
}

/** `nombre_actual` -> lo que vino de afuera, para arrastrarlo al reexportar. */
export function externasPorCampo(filas: FilaPaquete[]): Map<string, Record<string, string>> {
  const m = new Map<string, Record<string, string>>();
  for (const f of filas) {
    if (!f.nombre_actual) continue;
    const e = f.externas ?? {};
    if (Object.keys(e).length === 0) continue;
    // Un campo con varios widgets tiene varias filas: la primera manda.
    if (!m.has(f.nombre_actual)) m.set(f.nombre_actual, { ...e });
  }
  return m;
}

/** Cuántos widgets tienen etiqueta impresa (el número que mide si sirve). */
export function cobertura(filas: FilaPaquete[]): { total: number; conEtiqueta: number; conZona: number } {
  return {
    total: filas.length,
    conEtiqueta: filas.filter((f) => f.etiqueta_impresa.trim() !== '').length,
    conZona: filas.filter((f) => f.texto_zona.trim() !== '').length,
  };
}

/** xlsx de una hoja (`xlsx` lazy: solo se carga en Etapa 0). */
export async function paqueteAXlsx(filas: FilaPaquete[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(paqueteAAoa(filas));
  const anchos = [
    { wch: 5 },
    { wch: 30 },
    { wch: 30 },
    { wch: 6 },
    { wch: 7 },
    { wch: 8 },
    { wch: 8 },
    { wch: 7 },
    { wch: 7 },
    { wch: 34 },
    { wch: 44 },
    { wch: 60 },
    { wch: 20 },
    { wch: 11 },
    { wch: 40 },
  ];
  // una columna por cada externa, con ancho cómodo para leerlas
  const aoa = paqueteAAoa(filas);
  ws['!cols'] = aoa[0].map((_, i) => anchos[i] ?? { wch: 24 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'campos');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

// --- presembrado desde la ficha -------------------------------------------

export interface FilaFichaParaPaquete {
  hoja: string;
  fila: number;
  /** col N: nombres del PDF que le corresponden */
  campoPdfInterno: string;
  /** col M */
  campoJson: string;
  /** col H */
  obligatorio: string;
  /** col K */
  observaciones: string;
  /** col G */
  regla: string;
  /** col D */
  label: string;
  /** col F */
  valor: string;
}

/**
 * Presiembra las columnas de afuera con lo que la ficha ya declara: la ruta
 * (col M), la obligatoriedad (col H) y las validaciones (cols K y G).
 *
 * Es una SUGERENCIA y se dice: cada fila tocada lo anota en `notas`. Y **no pisa
 * nada**: si el paquete volvió de la skill con esas columnas llenas, se dejan
 * como están. Quien resolvió el mapeo con el formulario a la vista sabe más que
 * la ficha.
 */
export function presembrarDesdeFicha(
  filas: FilaPaquete[],
  filasFicha: FilaFichaParaPaquete[],
  derivarValidacion: (crudo: string) => { senales: string[]; reconocido: boolean },
): { tocadas: number; avisos: string[] } {
  const porNombre = new Map<string, FilaPaquete[]>();
  for (const f of filas) {
    if (!f.nombre_actual) continue;
    if (!porNombre.has(f.nombre_actual)) porNombre.set(f.nombre_actual, []);
    porNombre.get(f.nombre_actual)!.push(f);
  }

  let tocadas = 0;
  const sinCampo: string[] = [];
  for (const fila of filasFicha) {
    const tokens = String(fila.campoPdfInterno ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s && !/^(no aplica|n\/a|na)$/i.test(s));
    if (tokens.length === 0) continue;

    // Las validaciones pueden estar en la col K o en la col G: en la ficha real
    // conviven «50 caracteres alfanumericos» y «Alfanumérico (50)».
    const vK = derivarValidacion(fila.observaciones);
    const vG = derivarValidacion(fila.regla);
    const senales = vK.senales.length ? vK.senales : vG.senales;

    for (const token of tokens) {
      const destinos = porNombre.get(token);
      if (!destinos) {
        sinCampo.push(token);
        continue;
      }
      for (const f of destinos) {
        const ext = (f.externas ??= {});
        const antes = JSON.stringify(ext);
        if (!ext.ruta_json && fila.campoJson.trim()) ext.ruta_json = fila.campoJson.trim();
        if (!ext.required && fila.obligatorio.trim()) ext.required = fila.obligatorio.trim();
        if (!ext.validaciones && senales.length) ext.validaciones = senales.join(' · ');
        if (!ext.label && fila.label.trim()) ext.label = fila.label.trim();
        if (!ext.valor && fila.valor.trim()) ext.valor = fila.valor.trim();
        if (JSON.stringify(ext) === antes) continue;
        tocadas++;
        const nota = `presembrado desde la ficha ${fila.hoja}·${fila.fila} (sugerencia, revisar)`;
        f.notas = f.notas ? (f.notas.includes('presembrado') ? f.notas : `${f.notas} · ${nota}`) : nota;
      }
    }
  }

  const avisos: string[] = [];
  if (tocadas > 0) {
    avisos.push(`${tocadas} fila(s) del paquete presembradas desde la ficha. Van marcadas como sugerencia en «notas».`);
  }
  if (sinCampo.length > 0) {
    avisos.push(
      `${new Set(sinCampo).size} nombre(s) de la col N de la ficha no existen en el PDF: ${[...new Set(sinCampo)].slice(0, 5).join(', ')}${sinCampo.length > 5 ? '…' : ''}.`,
    );
  }
  return { tocadas, avisos };
}
