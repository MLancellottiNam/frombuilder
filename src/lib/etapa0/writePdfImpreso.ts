// ---------------------------------------------------------------------------
// Etapa 0 — PDF con los nombres impresos encima (v2.0.0).
//
// PARA QUÉ. Una vez que el mapeo se resuelve afuera, hay que poder revisarlo sin
// la app: en papel, en pantalla, o mandándoselo al cliente para discutir un
// campo puntual. Este PDF dibuja el borde de cada widget y su nombre final al
// lado, chico, en un color que no se confunda con el formulario.
//
// ES UNA COPIA VISUAL: los nombres están DIBUJADOS en el contenido de la página,
// no son campos. NO se sube a Signframe —el que se sube es el renombrado limpio—
// y el botón de la UI tiene que decirlo.
//
// Acá sí se usa la API de alto nivel de `pdf-lib`, y es correcto: la regla es no
// usarla para CAMPOS (indexa por nombre y se rompe con la jerarquía del INS).
// Esto es dibujo sobre bytes ya escritos, no toca el AcroForm. Se guarda con
// `updateFieldAppearances: false` justamente para que no intente regenerar las
// apariencias de los campos que acabamos de escribir a mano.
// ---------------------------------------------------------------------------

import type { Rect } from './pdfFields';

export interface CampoImpreso {
  /** nombre FINAL, el que se va a escribir en el PDF renombrado */
  nombre: string;
  /** orden de lectura, para cruzar con la columna `#` del paquete */
  indice?: number;
  /** 0-based */
  page: number;
  rect: Rect;
  tipo?: string;
}

export interface OpcionesImpresion {
  /** tamaño de fuente del rótulo (default 5pt) */
  tamano?: number;
  /** prefija el `#` del paquete (default true) */
  conIndice?: boolean;
  /** color del rótulo y del borde, 0..1 (default rojo) */
  color?: [number, number, number];
}

export interface ResultadoImpresion {
  bytes: Uint8Array;
  /** widgets rotulados */
  dibujados: number;
  warnings: string[];
}

/**
 * Helvetica codifica WinAnsi. Un carácter fuera de ese set —una viñeta, un
 * cuadradito de casilla que se colara en un nombre— hace explotar `drawText`, y
 * perder el PDF entero por un carácter sería absurdo: se reemplaza y se avisa.
 */
export function sanearWinAnsi(s: string): { texto: string; cambiado: boolean } {
  let cambiado = false;
  const texto = s.replace(/[^\x20-\x7e\xa0-\xff]/g, () => {
    cambiado = true;
    return '?';
  });
  return { texto, cambiado };
}

export async function escribirPdfConNombresImpresos(
  data: ArrayBuffer | Uint8Array,
  campos: CampoImpreso[],
  opts: OpcionesImpresion = {},
): Promise<ResultadoImpresion> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const warnings: string[] = [];
  const size = opts.tamano ?? 5;
  const [r, g, b] = opts.color ?? [0.85, 0.1, 0.1];
  const color = rgb(r, g, b);

  const doc = await PDFDocument.load(data, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  let dibujados = 0;
  let saneados = 0;

  for (const c of campos) {
    const page = pages[c.page];
    if (!page) {
      warnings.push(`«${c.nombre}»: la página ${c.page + 1} no existe en el PDF.`);
      continue;
    }
    const alto = page.getSize().height;

    page.drawRectangle({
      x: c.rect.x,
      y: c.rect.y,
      width: c.rect.w,
      height: c.rect.h,
      borderColor: color,
      borderWidth: 0.4,
      opacity: 0,
    });

    const etiqueta = (opts.conIndice ?? true) && c.indice ? `${c.indice}. ${c.nombre}` : c.nombre;
    const { texto, cambiado } = sanearWinAnsi(etiqueta);
    if (cambiado) saneados++;

    // El rótulo va ARRIBA del campo, que es donde menos tapa el formulario (el
    // rótulo impreso del INS está a la izquierda o adentro). Si el campo está
    // pegado al borde superior de la página, se pone abajo.
    const arriba = c.rect.y + c.rect.h + 1;
    const cabe = arriba + size <= alto - 1;
    page.drawText(texto, {
      x: c.rect.x,
      y: cabe ? arriba : Math.max(1, c.rect.y - size - 1),
      size,
      font,
      color,
    });
    dibujados++;
  }

  if (saneados > 0) {
    warnings.push(`${saneados} rótulo(s) tenían caracteres que Helvetica no puede escribir: se reemplazaron por «?».`);
  }

  // `updateFieldAppearances: false`: los campos vienen ya escritos por
  // `escribirPdfRenombrado` (con /NeedAppearances), y dejar que pdf-lib los
  // regenere acá desharía ese trabajo.
  const bytes = await doc.save({ updateFieldAppearances: false });
  return { bytes, dibujados, warnings };
}
