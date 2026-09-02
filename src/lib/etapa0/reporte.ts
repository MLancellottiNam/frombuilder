// ---------------------------------------------------------------------------
// Etapa 0 — Reporte de alineación (CSV).
//
// Es el papel que queda del renombrado: qué campo del PDF terminó llamándose
// cómo, contra qué fila de la ficha, con qué confianza y por qué. Todo lo que
// NO se resolvió automáticamente sale también: huérfanos de los dos lados,
// colisiones, avisos de la col M y la ausencia de campos /Sig.
//
// El reporte no corrige nada. Es la evidencia para revisar el formulario 37 de
// 100 sin tener que volver a abrir el PDF.
// ---------------------------------------------------------------------------

import Papa from 'papaparse';
import type { PdfLeaf } from './pdfFields';
import type { NombrePropuesto } from './acroName';
import type { Confianza } from './align';
import { etiquetaAviso, type AvisoColM } from './writeFicha';

export type SeccionReporte =
  | 'asignado'
  | 'huerfano-pdf'
  | 'huerfano-ficha'
  | 'colision'
  | 'aviso-col-m'
  | 'nota';

export interface FilaReporte {
  seccion: SeccionReporte;
  nombre_actual: string;
  nombre_nuevo: string;
  tipo: string;
  confianza: string;
  motivos: string;
  hoja: string;
  fila: string;
  instancia: string;
  campo_json: string;
  pagina: string;
  posicion: string;
  detalle: string;
}

const HEADERS: (keyof FilaReporte)[] = [
  'seccion',
  'nombre_actual',
  'nombre_nuevo',
  'tipo',
  'confianza',
  'motivos',
  'hoja',
  'fila',
  'instancia',
  'campo_json',
  'pagina',
  'posicion',
  'detalle',
];

function vacia(seccion: SeccionReporte): FilaReporte {
  return {
    seccion,
    nombre_actual: '',
    nombre_nuevo: '',
    tipo: '',
    confianza: '',
    motivos: '',
    hoja: '',
    fila: '',
    instancia: '',
    campo_json: '',
    pagina: '',
    posicion: '',
    detalle: '',
  };
}

export interface EntradaReporte {
  leaves: PdfLeaf[];
  /** índice de leaf -> nombre final que se va a escribir */
  nombreFinal: (i: number) => string;
  /** índice de leaf -> fila de ficha asignada (o null) */
  filaDeLeaf: (i: number) => NombrePropuesto | null;
  /** índice de leaf -> confianza de la pre-alineación */
  confianzaDeLeaf: (i: number) => Confianza | undefined;
  /** índice de leaf -> motivos de la pre-alineación */
  motivosDeLeaf: (i: number) => string[];
  /** filas que iban al PDF y quedaron sin campo */
  huerfanosFicha: NombrePropuesto[];
  /** nombres finales duplicados */
  colisiones: Set<string>;
  avisosColM: AvisoColM[];
}

export interface Reporte {
  filas: FilaReporte[];
  csv: string;
  resumen: {
    asignados: number;
    huerfanosPdf: number;
    huerfanosFicha: number;
    colisiones: number;
    avisos: number;
  };
}

export function construirReporte(e: EntradaReporte): Reporte {
  const filas: FilaReporte[] = [];
  let asignados = 0;
  let huerfanosPdf = 0;

  e.leaves.forEach((leaf, i) => {
    const np = e.filaDeLeaf(i);
    const final = e.nombreFinal(i);
    const f = vacia(np ? 'asignado' : 'huerfano-pdf');
    f.nombre_actual = leaf.name;
    f.nombre_nuevo = final;
    f.tipo = leaf.ft;
    f.confianza = e.confianzaDeLeaf(i) ?? '';
    f.motivos = e.motivosDeLeaf(i).join(' · ');
    f.pagina = String(leaf.page + 1);
    f.posicion = `${Math.round(leaf.rect.x)},${Math.round(leaf.rect.y)} ${Math.round(leaf.rect.w)}×${Math.round(leaf.rect.h)}`;
    if (np) {
      asignados++;
      f.hoja = np.fila.hoja;
      f.fila = String(np.fila.fila);
      f.instancia = np.fila.instancia ? `${np.fila.instancia.codigo}[${np.fila.indiceInstancia}]` : '';
      f.campo_json = np.fila.campoJson;
    } else {
      huerfanosPdf++;
      f.detalle = 'campo del PDF sin fila de ficha: revisar si sobra en el PDF o falta en la ficha';
    }
    if (leaf.multiWidgetSospechoso) {
      f.detalle = [f.detalle, `/Tx con ${leaf.widgets.length} widgets (páginas ${leaf.paginas.map((p) => p + 1).join(', ')})`]
        .filter(Boolean)
        .join(' · ');
    }
    if (e.colisiones.has(final)) {
      f.detalle = [f.detalle, 'COLISIÓN de nombre final'].filter(Boolean).join(' · ');
    }
    filas.push(f);
  });

  for (const np of e.huerfanosFicha) {
    const f = vacia('huerfano-ficha');
    f.nombre_nuevo = np.nombre;
    f.tipo = np.fila.tipo;
    f.hoja = np.fila.hoja;
    f.fila = String(np.fila.fila);
    f.instancia = np.fila.instancia ? `${np.fila.instancia.codigo}[${np.fila.indiceInstancia}]` : '';
    f.campo_json = np.fila.campoJson;
    f.detalle = `fila de ficha sin campo en el PDF (col C: «${np.fila.nombrePdf}»)`;
    filas.push(f);
  }

  for (const nombre of e.colisiones) {
    const f = vacia('colision');
    f.nombre_nuevo = nombre;
    f.detalle = 'dos o más campos del PDF terminarían con este mismo nombre';
    filas.push(f);
  }

  for (const a of e.avisosColM) {
    const f = vacia('aviso-col-m');
    f.hoja = a.hoja;
    f.fila = String(a.fila);
    f.campo_json = a.campoJson;
    f.detalle = `${etiquetaAviso(a.tipo)}: ${a.detalle}`;
    filas.push(f);
  }

  const sinSig = e.leaves.every((l) => l.ft !== '/Sig');
  if (sinSig) {
    const f = vacia('nota');
    f.detalle = 'El PDF no tiene campos /Sig: las firmas son líneas dibujadas, no campos de formulario.';
    filas.push(f);
  }

  const csv = Papa.unparse({
    fields: HEADERS as string[],
    data: filas.map((f) => HEADERS.map((h) => f[h])),
  });

  return {
    filas,
    csv,
    resumen: {
      asignados,
      huerfanosPdf,
      huerfanosFicha: e.huerfanosFicha.length,
      colisiones: e.colisiones.size,
      avisos: e.avisosColM.length,
    },
  };
}
