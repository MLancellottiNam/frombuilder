// ---------------------------------------------------------------------------
// Etapa 0 — Escritura de la ficha con la columna N completada.
//
// Se reescribe el MISMO archivo: misma cantidad de hojas, mismo header, mismas
// filas. Lo único que cambia es la celda de la col N (Nombre interno del campo
// en PDF) de las filas que van al PDF. Las filas solo-JSON y las excluidas
// quedan con N vacía: si el campo no existe en el PDF, no hay nombre interno
// que poner, y llenarlo sería inventar.
// ---------------------------------------------------------------------------

import { norm, type FichaRow } from './fichaRaw';

/** hoja -> (fila 1-based -> valor para la col N) */
export type ValoresColN = Map<string, Map<number, string>>;

export interface EscrituraFichaOpts {
  /** hoja -> índice 0-based de la col N. Si falta, se usa 13 (columna N). */
  colPorHoja: Map<string, number | undefined>;
}

export interface EscrituraFichaResult {
  bytes: Uint8Array;
  celdasEscritas: number;
  hojasTocadas: number;
  warnings: string[];
}

const COL_N_POR_DEFECTO = 13; // A=0 ... N=13

/**
 * Reescribe el .xlsx original poniendo `valores` en la col N.
 * `xlsx` se importa lazy (solo Etapa 0 lo usa).
 */
export async function escribirFichaConColN(
  data: ArrayBuffer | Uint8Array,
  valores: ValoresColN,
  opts: EscrituraFichaOpts,
): Promise<EscrituraFichaResult> {
  const XLSX = await import('xlsx');
  const warnings: string[] = [];
  const wb = XLSX.read(data, { type: 'array', cellStyles: true });

  let celdasEscritas = 0;
  let hojasTocadas = 0;

  for (const [hoja, filas] of valores) {
    const ws = wb.Sheets[hoja];
    if (!ws) {
      warnings.push(`La hoja "${hoja}" no está en el archivo original: se omite.`);
      continue;
    }
    const col = opts.colPorHoja.get(hoja) ?? COL_N_POR_DEFECTO;
    if (opts.colPorHoja.get(hoja) == null) {
      warnings.push(`No se detectó la col N en "${hoja}": se escribe en la columna N (índice ${COL_N_POR_DEFECTO}).`);
    }
    const rango = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    let tocada = false;

    for (const [fila, valor] of filas) {
      const r = fila - 1; // 1-based (como Excel) -> 0-based
      const addr = XLSX.utils.encode_cell({ r, c: col });
      const previo = ws[addr];
      // Conservar el formato de la celda si ya existía.
      ws[addr] = { ...(previo ?? {}), t: 's', v: valor, w: valor };
      delete ws[addr].f; // si tenía fórmula, el valor literal manda
      celdasEscritas++;
      tocada = true;
      if (r > rango.e.r) rango.e.r = r;
      if (col > rango.e.c) rango.e.c = col;
      if (r < rango.s.r) rango.s.r = r;
      if (col < rango.s.c) rango.s.c = col;
    }

    ws['!ref'] = XLSX.utils.encode_range(rango);
    if (tocada) hojasTocadas++;
  }

  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer;
  return { bytes: new Uint8Array(bytes), celdasEscritas, hojasTocadas, warnings };
}

// --- avisos de la col M (se reportan, NO se corrigen) -----------------------

export type TipoAviso = 'grafia-inconsistente' | 'no-ascii' | 'mayuscula-inicial' | 'espacios' | 'punto-doble';

export interface AvisoColM {
  hoja: string;
  fila: number;
  campoJson: string;
  tipo: TipoAviso;
  detalle: string;
}

const ETIQUETA_AVISO: Record<TipoAviso, string> = {
  'grafia-inconsistente': 'el mismo segmento aparece escrito de dos formas',
  'no-ascii': 'segmento con acento o carácter no ASCII',
  'mayuscula-inicial': 'segmento en mayúscula inicial (el resto de la ficha usa minúscula)',
  espacios: 'espacios sobrantes',
  'punto-doble': 'punto duplicado o path incompleto',
};

export function etiquetaAviso(t: TipoAviso): string {
  return ETIQUETA_AVISO[t];
}

/**
 * Revisa los paths de la col M buscando erratas de tipeo. Es GENÉRICO: no
 * conoce ningún campo del INS, solo compara los segmentos entre sí. Si el mismo
 * segmento aparece con dos grafías distintas, una de las dos está mal — pero
 * cuál, lo decide la persona. Acá solo se avisa.
 */
export function detectarAvisosColM(rows: FichaRow[]): AvisoColM[] {
  const avisos: AvisoColM[] = [];

  // 1) grafías por segmento normalizado
  const grafias = new Map<string, Set<string>>();
  let conMinuscula = 0;
  let conMayuscula = 0;
  for (const r of rows) {
    if (!r.campoJson) continue;
    for (const seg of r.campoJson.split('.')) {
      const s = seg.trim();
      if (!s) continue;
      const key = norm(s);
      if (!grafias.has(key)) grafias.set(key, new Set());
      grafias.get(key)!.add(s);
      if (/^[a-z]/.test(s)) conMinuscula++;
      else if (/^[A-ZÁÉÍÓÚÑ]/.test(s)) conMayuscula++;
    }
  }
  const mayoriaMinuscula = conMinuscula > conMayuscula;

  const push = (r: FichaRow, tipo: TipoAviso, detalle: string) =>
    avisos.push({ hoja: r.hoja, fila: r.fila, campoJson: r.campoJson, tipo, detalle });

  for (const r of rows) {
    const path = r.campoJson;
    if (!path) continue;
    if (path !== path.trim() || /\s/.test(path)) push(r, 'espacios', `«${path}»`);
    if (/\.\./.test(path) || path.startsWith('.') || path.endsWith('.')) push(r, 'punto-doble', `«${path}»`);

    for (const seg of path.split('.')) {
      const s = seg.trim();
      if (!s) continue;
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(s)) push(r, 'no-ascii', `«${s}»`);
      if (mayoriaMinuscula && /^[A-ZÁÉÍÓÚÑ]/.test(s)) push(r, 'mayuscula-inicial', `«${s}»`);
      const variantes = grafias.get(norm(s));
      if (variantes && variantes.size > 1) {
        push(r, 'grafia-inconsistente', `«${s}» vs ${[...variantes].filter((v) => v !== s).map((v) => `«${v}»`).join(', ')}`);
      }
    }
  }

  // deduplicar (hoja+fila+tipo+detalle)
  const vistos = new Set<string>();
  return avisos.filter((a) => {
    const k = `${a.hoja}|${a.fila}|${a.tipo}|${a.detalle}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
