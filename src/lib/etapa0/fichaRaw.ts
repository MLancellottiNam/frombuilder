// ---------------------------------------------------------------------------
// Etapa 0 — Lectura de la ficha CRUDA del INS (multi-hoja, columna N vacía).
//
// La ficha cruda trae 1 hoja índice + N hojas de nodo (14 columnas A–N) + hojas
// de salida de ejemplo. Este módulo la aplana, detecta las 4 exclusiones y
// clasifica cada fila en: va-al-PDF / solo-JSON / excluida.
//
// La detección de exclusiones es por TEXTO (SheetJS CE no expone estilos de
// celda de forma confiable); el color queda como refuerzo opcional si algún día
// se dispone de él.
// ---------------------------------------------------------------------------

/** Celdas de una hoja como matriz de strings ya normalizada a texto. */
export interface RawSheet {
  name: string;
  aoa: string[][];
}

export type FichaColKey =
  | 'pasos' // A
  | 'seccion' // B
  | 'nombrePdf' // C
  | 'label' // D
  | 'tipo' // E
  | 'valor' // F
  | 'regla' // G
  | 'obligatorio' // H
  | 'formulario' // I
  | 'visualizacion' // J
  | 'observaciones' // K
  | 'seccionJson' // L
  | 'campoJson' // M
  | 'campoPdfInterno'; // N

/**
 * Candidatos por columna, en orden de especificidad. Se asignan de más
 * específico a más genérico para que "Sección" (B) no se robe
 * "Nombre de la sección del JSON" (L), ni "Nombre en PDF" (C) se confunda con
 * "Nombre interno del campo en PDF" (N).
 */
const HEADER_CANDIDATES: [FichaColKey, string[]][] = [
  ['seccionJson', ['nombre de la seccion del json', 'seccion del json']],
  ['campoJson', ['nombre del campo en el json', 'campo en el json']],
  ['campoPdfInterno', ['nombre interno del campo en pdf', 'nombre interno', 'campo interno', 'campo en el pdf']],
  ['nombrePdf', ['nombre en pdf']],
  ['label', ['nombre del campo en formulario', 'campo en formulario']],
  ['formulario', ['formulario a visualizar']],
  ['visualizacion', ['visualizacion en formularios', 'visualizacion']],
  ['tipo', ['tipo de dato', 'tipo']],
  ['valor', ['valor']],
  ['regla', ['regla']],
  ['obligatorio', ['obligatorio']],
  ['observaciones', ['observaciones']],
  ['pasos', ['pasos formulario', 'paso']],
  ['seccion', ['seccion']],
];

/** minúsculas, sin acentos, espacios colapsados. */
export function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** MAYÚSCULAS, sin acentos, espacios colapsados — para los marcadores. */
export function normUpper(s: string): string {
  return norm(s).toUpperCase();
}

export type RowDestino = 'pdf' | 'solo-json' | 'excluida';
export type RowMotivo = 'hoja-no-aplica' | 'bloque-no-aplica' | 'contrato-json' | 'sin-campo-pdf';

export interface FichaRow {
  hoja: string;
  nodo: string;
  /** fila 1-based dentro de la hoja (como la ve el usuario en Excel) */
  fila: number;
  pasos: string;
  seccion: string;
  nombrePdf: string;
  label: string;
  tipo: string;
  valor: string;
  regla: string;
  obligatorio: string;
  formulario: string;
  visualizacion: string;
  observaciones: string;
  seccionJson: string;
  campoJson: string;
  campoPdfInterno: string;
  destino: RowDestino;
  motivo?: RowMotivo;
}

export interface SheetInfo {
  name: string;
  /** true si es una hoja de nodo (tiene el header de 14 columnas) */
  esNodo: boolean;
  aplica: boolean;
  /** texto del marcador que la excluyó, si aplica */
  marcador?: string;
  filasDatos: number;
}

export interface BloqueExcluido {
  hoja: string;
  desdeFila: number;
  hastaFila: number;
  texto: string;
}

export interface RoutingEntry {
  nodo: string;
  paso: string;
  secciones: string;
}

export interface FichaRawResult {
  rows: FichaRow[];
  sheets: SheetInfo[];
  routing: RoutingEntry[];
  bloquesExcluidos: BloqueExcluido[];
  warnings: string[];
  stats: {
    filasDatos: number;
    hojasNodo: number;
    hojasNoAplica: number;
    bloquesExcluidos: number;
    pdf: number;
    soloJson: number;
    excluidas: number;
  };
}

// --- detección de marcadores ------------------------------------------------

/**
 * Un marcador "NO APLICA" puede estar en CUALQUIER celda de la hoja (columna y
 * fila varían por hoja). Se busca por substring sobre el texto normalizado.
 */
export interface Marcador {
  fila: number; // 1-based
  col: number; // 0-based
  texto: string;
  alcance: 'hoja' | 'bloque';
}

export function findMarcadores(aoa: string[][]): Marcador[] {
  const out: Marcador[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const raw = String(row[c] ?? '');
      if (!raw.trim()) continue;
      const up = normUpper(raw);
      if (!up.includes('NO APLICA')) continue;
      // HOJA -> toda la hoja; SECCION -> bloque desde esa fila.
      const alcance: 'hoja' | 'bloque' = up.includes('HOJA') ? 'hoja' : 'bloque';
      out.push({ fila: r + 1, col: c, texto: raw.trim(), alcance });
    }
  }
  return out;
}

/** true si la col M de esa fila apunta a un `codigoTipo` (inicio de instancia). */
function esFilaCodigoTipo(campoJson: string): boolean {
  const n = norm(campoJson);
  return n === 'codigotipo' || n.endsWith('.codigotipo');
}

// --- header / columnas ------------------------------------------------------

interface HeaderMap {
  headerRow: number; // 0-based
  cols: Partial<Record<FichaColKey, number>>;
  matches: number;
}

function detectHeader(aoa: string[][]): HeaderMap | null {
  let best: HeaderMap | null = null;
  const limit = Math.min(aoa.length, 25);
  for (let r = 0; r < limit; r++) {
    const row = (aoa[r] ?? []).map((c) => norm(String(c ?? '')));
    if (row.every((c) => !c)) continue;
    const used = new Set<number>();
    const cols: Partial<Record<FichaColKey, number>> = {};
    let matches = 0;
    for (const [key, cands] of HEADER_CANDIDATES) {
      let found = -1;
      for (const cand of cands) {
        const idx = row.findIndex((h, i) => !used.has(i) && h.includes(cand));
        if (idx >= 0) {
          found = idx;
          break;
        }
      }
      if (found >= 0) {
        cols[key] = found;
        used.add(found);
        matches++;
      }
    }
    if (!best || matches > best.matches) best = { headerRow: r, cols, matches };
  }
  // Una hoja de nodo tiene la mayoría de las 14 columnas.
  return best && best.matches >= 6 ? best : null;
}

// --- índice (Estructura base JSON) -----------------------------------------

function parseRouting(sheet: RawSheet, warnings: string[]): RoutingEntry[] {
  const aoa = sheet.aoa;
  let headerRow = -1;
  let cNodo = -1;
  let cPaso = -1;
  let cSecc = -1;
  for (let r = 0; r < Math.min(aoa.length, 15); r++) {
    const row = (aoa[r] ?? []).map((c) => norm(String(c ?? '')));
    const nodo = row.findIndex((h) => h.includes('nodo') || h.includes('estructura'));
    const paso = row.findIndex((h) => h.includes('paso'));
    const secc = row.findIndex((h) => h.includes('seccion'));
    if (nodo >= 0 && paso >= 0) {
      headerRow = r;
      cNodo = nodo;
      cPaso = paso;
      cSecc = secc;
      break;
    }
  }
  if (headerRow < 0) {
    warnings.push(`Índice "${sheet.name}": no reconocí las columnas (nodo/paso); ruteo vacío.`);
    return [];
  }
  const out: RoutingEntry[] = [];
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const nodo = String(row[cNodo] ?? '').trim();
    if (!nodo) continue;
    out.push({
      nodo,
      paso: String(row[cPaso] ?? '').trim(),
      secciones: cSecc >= 0 ? String(row[cSecc] ?? '').trim() : '',
    });
  }
  return out;
}

// --- núcleo -----------------------------------------------------------------

const MARCADOR_SOLO_JSON = 'no se llena en pdf';

/**
 * Aplana la ficha cruda y clasifica cada fila.
 * Función PURA: recibe las hojas ya convertidas a matriz de strings.
 */
export function buildFichaRaw(sheets: RawSheet[]): FichaRawResult {
  const warnings: string[] = [];
  const rows: FichaRow[] = [];
  const sheetInfos: SheetInfo[] = [];
  const bloquesExcluidos: BloqueExcluido[] = [];
  let routing: RoutingEntry[] = [];

  for (const sheet of sheets) {
    const header = detectHeader(sheet.aoa);

    if (!header) {
      // No es hoja de nodo: puede ser el índice o una hoja de salida.
      if (norm(sheet.name).includes('estructura base')) {
        routing = parseRouting(sheet, warnings);
      }
      sheetInfos.push({ name: sheet.name, esNodo: false, aplica: true, filasDatos: 0 });
      continue;
    }

    // 1) Marcadores. La detección corre ANTES de cualquier parseo de col G.
    const marcadores = findMarcadores(sheet.aoa);
    const marcadorHoja = marcadores.find((m) => m.alcance === 'hoja');
    const marcadoresBloque = marcadores.filter((m) => m.alcance === 'bloque');

    // 2) Rango de filas excluidas por bloque: desde el marcador hasta la
    //    próxima fila con `codigoTipo` en col M (o fin de hoja).
    const colM = header.cols.campoJson;
    const excluidasPorBloque = new Set<number>(); // 1-based
    for (const m of marcadoresBloque) {
      let hasta = sheet.aoa.length; // 1-based exclusivo -> fin de hoja
      for (let r = m.fila; r < sheet.aoa.length; r++) {
        const campoJson = colM != null ? String(sheet.aoa[r]?.[colM] ?? '') : '';
        if (esFilaCodigoTipo(campoJson)) {
          hasta = r; // fila 1-based del codigoTipo es r+1 -> el bloque termina antes
          break;
        }
      }
      for (let f = m.fila; f <= hasta; f++) excluidasPorBloque.add(f);
      bloquesExcluidos.push({ hoja: sheet.name, desdeFila: m.fila, hastaFila: hasta, texto: m.texto });
    }

    // 3) Filas de datos.
    const get = (row: string[], key: FichaColKey): string => {
      const i = header.cols[key];
      return i == null ? '' : String(row[i] ?? '').trim();
    };
    let filasDatos = 0;
    for (let r = header.headerRow + 1; r < sheet.aoa.length; r++) {
      const row = sheet.aoa[r] ?? [];
      const fila = r + 1;
      // Fila vacía -> no es dato.
      if (row.every((c) => !String(c ?? '').trim())) continue;
      // El marcador en sí no es un campo.
      const esMarcador = marcadores.some((m) => m.fila === fila);

      const rec: FichaRow = {
        hoja: sheet.name,
        nodo: sheet.name,
        fila,
        pasos: get(row, 'pasos'),
        seccion: get(row, 'seccion'),
        nombrePdf: get(row, 'nombrePdf'),
        label: get(row, 'label'),
        tipo: get(row, 'tipo'),
        valor: get(row, 'valor'),
        regla: get(row, 'regla'),
        obligatorio: get(row, 'obligatorio'),
        formulario: get(row, 'formulario'),
        visualizacion: get(row, 'visualizacion'),
        observaciones: get(row, 'observaciones'),
        seccionJson: get(row, 'seccionJson'),
        campoJson: get(row, 'campoJson'),
        campoPdfInterno: get(row, 'campoPdfInterno'),
        destino: 'excluida',
      };

      // Una fila sin ningún contenido útil (solo el marcador) no cuenta.
      const tieneContenido = !!(rec.label || rec.nombrePdf || rec.campoJson || rec.pasos);
      if (!tieneContenido) continue;

      filasDatos++;

      // 4) Clasificación, en orden de precedencia.
      if (marcadorHoja) {
        rec.destino = 'excluida';
        rec.motivo = 'hoja-no-aplica';
      } else if (esMarcador || excluidasPorBloque.has(fila)) {
        rec.destino = 'excluida';
        rec.motivo = 'bloque-no-aplica';
      } else if (normUpper(rec.pasos) === 'JSON') {
        rec.destino = 'solo-json';
        rec.motivo = 'contrato-json';
      } else if (!rec.nombrePdf || norm(rec.nombrePdf).includes(MARCADOR_SOLO_JSON)) {
        rec.destino = 'solo-json';
        rec.motivo = 'sin-campo-pdf';
      } else {
        rec.destino = 'pdf';
      }

      rows.push(rec);
    }

    sheetInfos.push({
      name: sheet.name,
      esNodo: true,
      aplica: !marcadorHoja,
      marcador: marcadorHoja?.texto,
      filasDatos,
    });
  }

  const hojasNodo = sheetInfos.filter((s) => s.esNodo).length;
  const hojasNoAplica = sheetInfos.filter((s) => s.esNodo && !s.aplica).length;
  const stats = {
    filasDatos: rows.length,
    hojasNodo,
    hojasNoAplica,
    bloquesExcluidos: bloquesExcluidos.length,
    pdf: rows.filter((r) => r.destino === 'pdf').length,
    soloJson: rows.filter((r) => r.destino === 'solo-json').length,
    excluidas: rows.filter((r) => r.destino === 'excluida').length,
  };

  if (hojasNodo === 0) warnings.push('No se detectó ninguna hoja de nodo (header de 14 columnas).');

  return { rows, sheets: sheetInfos, routing, bloquesExcluidos, warnings, stats };
}

// --- carga del archivo (xlsx lazy) -----------------------------------------

/** Convierte un .xlsx a RawSheet[]. `xlsx` se carga lazy (solo en Etapa 0). */
export async function readFichaSheets(data: ArrayBuffer | Uint8Array): Promise<RawSheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
    return { name, aoa: aoa.map((r) => (r ?? []).map((c) => String(c ?? ''))) };
  });
}

/** Atajo: archivo -> resultado clasificado. */
export async function readFichaRaw(file: File): Promise<FichaRawResult> {
  const buf = await file.arrayBuffer();
  return buildFichaRaw(await readFichaSheets(buf));
}
