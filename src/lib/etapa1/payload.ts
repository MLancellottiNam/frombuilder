// ---------------------------------------------------------------------------
// Etapa 1 — El JSON de salida y sus diagnósticos (v3.0.0).
//
// Es la pregunta que hoy no se puede contestar sin probar en Signframe: ¿QUÉ
// JSON escribe este formulario? Acá se arma el payload con la estructura real de
// nodos (`datosFormulario.personas[0].primerApellido`) a partir de los valores
// que se van tipeando, y se marcan los problemas que solo aparecen cuando el
// INS los rebota:
//
//   - campo con `sourceMeta` pero sin ruta -> no escribe nada;
//   - radios del mismo grupo compartiendo ruta sin `excludeFromJson` -> al
//     marcar uno se sincronizan todos;
//   - grafía sospechosa en la ruta (mayúscula inicial, tilde, espacio);
//   - dos campos distintos escribiendo la misma ruta;
//   - la cobertura del contrato: la ficha declara N rutas, el formulario
//     escribe M.
// ---------------------------------------------------------------------------

import type { Field, FormDefinition } from '../../types';
import { flattenFields } from '../matching';

export type Valores = Record<string, unknown>;

/** Un segmento de ruta: nombre y, si es un arreglo, su índice. */
export interface Segmento {
  clave: string;
  indice: number | null;
}

export function partirRuta(ruta: string): Segmento[] {
  return ruta
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.+?)\[(\d+)\]$/);
      return m ? { clave: m[1], indice: Number(m[2]) } : { clave: s, indice: null };
    });
}

/** Escribe `valor` en `ruta` creando objetos y arreglos según haga falta. */
export function escribirEnRuta(destino: Record<string, unknown>, ruta: string, valor: unknown): void {
  const segs = partirRuta(ruta);
  if (segs.length === 0) return;
  let actual: any = destino;
  segs.forEach((seg, i) => {
    const ultimo = i === segs.length - 1;
    if (seg.indice == null) {
      if (ultimo) {
        actual[seg.clave] = valor;
      } else {
        if (typeof actual[seg.clave] !== 'object' || actual[seg.clave] === null) actual[seg.clave] = {};
        actual = actual[seg.clave];
      }
      return;
    }
    if (!Array.isArray(actual[seg.clave])) actual[seg.clave] = [];
    const arr = actual[seg.clave] as unknown[];
    while (arr.length <= seg.indice) arr.push({});
    if (ultimo) {
      arr[seg.indice] = valor;
    } else {
      if (typeof arr[seg.indice] !== 'object' || arr[seg.indice] === null) arr[seg.indice] = {};
      actual = arr[seg.indice];
    }
  });
}

/** El valor que un campo escribe, según su tipo. */
export function valorDeCampo(campo: Field, crudo: unknown): unknown {
  if (campo.type === 'checkbox') {
    const marcado = crudo === true || crudo === 'true' || crudo === 'on';
    if (!marcado) return undefined;
    return campo.checkedJsonValue !== undefined && campo.checkedJsonValue !== null
      ? campo.checkedJsonValue
      : true;
  }
  if (campo.type === 'radio') {
    const marcado = crudo === true || crudo === 'true' || crudo === campo.jsonValue;
    if (!marcado) return undefined;
    return campo.jsonValue ?? campo.sharedValue ?? true;
  }
  if (crudo === '' || crudo == null) return undefined;
  if (campo.type === 'number') {
    const n = Number(crudo);
    return Number.isFinite(n) ? n : crudo;
  }
  return crudo;
}

export type Severidad = 'error' | 'aviso';

export interface Diagnostico {
  tipo:
    | 'sin-ruta'
    | 'radios-se-pisan'
    | 'grafia-sospechosa'
    | 'colision-de-ruta'
    | 'indice-repetido'
    | 'ruta-contenedora'
    | 'hueco';
  severidad: Severidad;
  mensaje: string;
  /** ids de los campos involucrados */
  campos: string[];
  ruta?: string;
}

const RE_SOSPECHOSA = {
  mayuscula: /(^|\.)[A-Z]/,
  tilde: /[áéíóúÁÉÍÓÚñÑüÜ]/,
  espacio: /\s/,
};

/** Grafía sospechosa de una ruta: no se corrige, se marca. */
export function grafiaSospechosa(ruta: string): string[] {
  const motivos: string[] = [];
  const segs = ruta.split('.');
  if (segs.some((s) => /^[A-Z]/.test(s))) motivos.push('un segmento arranca en mayúscula');
  if (RE_SOSPECHOSA.tilde.test(ruta)) motivos.push('tiene tilde o ñ');
  if (RE_SOSPECHOSA.espacio.test(ruta)) motivos.push('tiene espacios');
  if (/__|\.\./.test(ruta)) motivos.push('separadores repetidos');
  return motivos;
}

/** Quita los índices de arreglo de una ruta: `personas[0].x` -> `personas.x`. */
export function sinIndices(ruta: string): string {
  return String(ruta ?? '').replace(/\[\d+\]/g, '').trim();
}

export interface ResultadoPayload {
  payload: Record<string, unknown>;
  json: string;
  diagnosticos: Diagnostico[];
  /** ruta -> ids de los campos que la escriben */
  porRuta: Map<string, string[]>;
  cobertura: {
    /** rutas declaradas en la ficha (col M) */
    declaradas: number;
    /** rutas que el formulario efectivamente escribe */
    escritas: number;
    faltantes: string[];
  };
}

export interface EntradaPayload {
  form: FormDefinition;
  /** id de campo -> valor tipeado */
  valores: Valores;
  /** rutas declaradas por la ficha, para medir la cobertura del contrato */
  rutasDeclaradas?: string[];
  /** huecos de la última milla detectados al generar */
  huecos?: { ruta: string; motivo: string; sourceNames: string[] }[];
}

export function construirPayload(e: EntradaPayload): ResultadoPayload {
  const campos = flattenFields(e.form);
  const payload: Record<string, unknown> = {};
  const diagnosticos: Diagnostico[] = [];
  const porRuta = new Map<string, string[]>();
  const escritas = new Set<string>();

  /**
   * Rutas que son el NODO PADRE de otra ruta. Escribir un valor ahí reemplaza el
   * objeto entero y se lleva puesto todo el subárbol: en el CSC eran tres filas
   * apuntando a `datosFormulario.personas[i]` (el nodo de la persona, sin hoja),
   * y borraban los ~35 campos de cada persona. En el payload no se ve el
   * problema, se ve el resultado: 25 hojas escritas en vez de 115.
   */
  const todasLasRutas = new Set(
    campos
      .filter((c) => (c.salidaJSON || c.jsonOutputPath) && !c.excludeFromJson)
      .map((c) => (c.salidaJSON ?? c.jsonOutputPath)!),
  );
  const contenedoras = new Set(
    [...todasLasRutas].filter((a) => [...todasLasRutas].some((b) => b !== a && b.startsWith(a + '.'))),
  );

  for (const campo of campos) {
    const ruta = campo.salidaJSON ?? campo.jsonOutputPath ?? null;

    if (!ruta) {
      if (campo.sourceMeta) {
        diagnosticos.push({
          tipo: 'sin-ruta',
          severidad: 'aviso',
          mensaje: `«${campo.label}» pinta el PDF pero no tiene ruta JSON: no escribe nada en el payload.`,
          campos: [campo.id],
        });
      }
      continue;
    }

    if (!porRuta.has(ruta)) porRuta.set(ruta, []);
    porRuta.get(ruta)!.push(campo.id);

    if (campo.excludeFromJson) continue;
    // No se escribe en un nodo contenedor: se reporta.
    if (contenedoras.has(ruta)) continue;

    const valor = valorDeCampo(campo, e.valores[campo.id]);
    if (valor === undefined) continue;
    escribirEnRuta(payload, ruta, valor);
    escritas.add(ruta);
  }

  // --- diagnósticos por ruta ---------------------------------------------
  const porId = new Map(campos.map((c) => [c.id, c]));
  for (const [ruta, ids] of porRuta) {
    const motivos = grafiaSospechosa(ruta);
    if (motivos.length > 0) {
      diagnosticos.push({
        tipo: 'grafia-sospechosa',
        severidad: 'aviso',
        mensaje: `La ruta «${ruta}» ${motivos.join(' y ')}. Suele ser un tipeo de la ficha: el contrato del INS usa camelCase sin acentos.`,
        campos: ids,
        ruta,
      });
    }
    if (ids.length < 2) continue;

    const cs = ids.map((id) => porId.get(id)!).filter(Boolean);
    const queEscriben = cs.filter((c) => !c.excludeFromJson);
    const radios = cs.filter((c) => c.type === 'radio');

    if (radios.length === cs.length && queEscriben.length > 1) {
      diagnosticos.push({
        tipo: 'radios-se-pisan',
        severidad: 'error',
        mensaje: `${queEscriben.length} radios del mismo grupo escriben «${ruta}» sin \`excludeFromJson\`: al marcar uno se sincronizan todos. Solo uno lleva la ruta.`,
        campos: queEscriben.map((c) => c.id),
        ruta,
      });
    } else if (queEscriben.length > 1) {
      diagnosticos.push({
        tipo: 'colision-de-ruta',
        severidad: 'error',
        mensaje: `${queEscriben.length} campos distintos escriben «${ruta}»: el último gana y el dato del otro se pierde.`,
        campos: queEscriben.map((c) => c.id),
        ruta,
      });
    }
  }

  for (const ruta of contenedoras) {
    const hijas = [...todasLasRutas].filter((b) => b !== ruta && b.startsWith(ruta + '.')).length;
    diagnosticos.push({
      tipo: 'ruta-contenedora',
      severidad: 'error',
      mensaje: `«${ruta}» es el nodo padre de ${hijas} rutas: escribir un valor ahí reemplazaría el objeto entero y borraría esos ${hijas} datos. El campo necesita su propia hoja en la ruta.`,
      campos: porRuta.get(ruta) ?? [],
      ruta,
    });
  }

  // --- índices de instancia repetidos ------------------------------------
  // Dos instancias escribiendo el MISMO índice es un error de configuración que
  // en el payload no se ve: una sobreescribe a la otra.
  const porNodoIndice = new Map<string, Set<string>>();
  for (const [ruta, ids] of porRuta) {
    for (const seg of partirRuta(ruta)) {
      if (seg.indice == null) continue;
      const k = `${seg.clave}[${seg.indice}]`;
      if (!porNodoIndice.has(k)) porNodoIndice.set(k, new Set());
      for (const id of ids) {
        const c = porId.get(id);
        const sm = c?.sourceMeta as Record<string, unknown> | null;
        const nombre = typeof sm?.sourceName === 'string' ? (sm.sourceName as string) : '';
        // El prefijo del sourceName identifica la instancia (`asg_`, `pjr_`).
        const pref = nombre.includes('_') ? nombre.split('_')[0] : '';
        if (pref) porNodoIndice.get(k)!.add(pref);
      }
    }
  }
  for (const [k, prefijos] of porNodoIndice) {
    if (prefijos.size > 1) {
      diagnosticos.push({
        tipo: 'indice-repetido',
        severidad: 'error',
        mensaje: `«${k}» recibe campos de ${prefijos.size} instancias distintas (${[...prefijos].join(', ')}): una sobreescribe a la otra.`,
        campos: [],
      });
    }
  }

  for (const h of e.huecos ?? []) {
    diagnosticos.push({
      tipo: 'hueco',
      severidad: 'aviso',
      mensaje: `${h.ruta} ← ${h.motivo} (falta)`,
      campos: [],
      ruta: h.ruta,
    });
  }

  // --- cobertura del contrato -------------------------------------------
  // La ficha declara las rutas SIN índice (`personas.primerApellido`) y el
  // formulario las escribe CON índice (`personas[0].primerApellido`), así que la
  // comparación se hace sin índices o mediría cualquier cosa.
  const declaradas = [...new Set((e.rutasDeclaradas ?? []).map(sinIndices).filter(Boolean))];
  const escribibles = new Set(
    campos
      .filter((c) => (c.salidaJSON || c.jsonOutputPath) && !c.excludeFromJson)
      .map((c) => sinIndices((c.salidaJSON ?? c.jsonOutputPath)!)),
  );
  const faltantes = declaradas.filter((r) => !escribibles.has(r));

  return {
    payload,
    json: JSON.stringify(payload, null, 2),
    diagnosticos,
    porRuta,
    cobertura: { declaradas: declaradas.length, escritas: escribibles.size, faltantes },
  };
}

/** Valor de ejemplo coherente por tipo, para ver el payload completo. */
export function valorDeEjemplo(campo: Field, i: number): unknown {
  switch (campo.type) {
    case 'checkbox':
      return true;
    case 'radio':
      // Una sola opción por grupo —marcar todas sería un payload falso— y la
      // que se marca es la que LLEVA la ruta (`excludeFromJson: false`). Elegir
      // «la primera por order» dejaba grupos enteros sin escribir nada, porque
      // la portadora de la ruta no siempre es la primera del renglón.
      return !campo.excludeFromJson;
    case 'number':
      return 1000 + i;
    case 'date':
      return '01/01/2024';
    case 'select':
      return campo.options?.[0]?.jsonValue ?? campo.options?.[0]?.label ?? 'opción 1';
    case 'signature':
      return undefined;
    case 'textarea':
      return `Texto de ejemplo ${i + 1}`;
    default: {
      const l = (campo.label || 'dato').replace(/\s+/g, ' ').trim();
      return `${l.slice(0, 24)} ${i + 1}`;
    }
  }
}

/** Llena todos los campos con valores de ejemplo. */
export function valoresDeEjemplo(form: FormDefinition): Valores {
  const out: Valores = {};
  flattenFields(form).forEach((c, i) => {
    const v = valorDeEjemplo(c, i);
    if (v !== undefined) out[c.id] = v;
  });
  return out;
}
