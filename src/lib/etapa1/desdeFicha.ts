// ---------------------------------------------------------------------------
// Etapa 1 — Generar el formulario desde la ficha (v3.0.0).
//
// Etapa 1 deja de ser un armador manual (pool + canvas + drag&drop) y pasa a ser
// un GENERADOR: con la ficha (col N llena) y el JSON main de Signframe sale casi
// todo, y lo que salió mal se ajusta al costado.
//
// NO SE DUPLICA NADA. Este módulo es un adaptador:
//   - el lector de la ficha es `fichaRaw.ts`, el mismo de Etapa 0. Reemplaza a
//     `parseTable`, que es single-sheet y se quedaba con la hoja de más filas:
//     la ficha del INS tiene 10 hojas de nodo, así que agarraba solo `personas`
//     y tiraba las otras nueve;
//   - la estructura (secciones, subsecciones, radios desdoblados, condicionales,
//     required) la arma `materializeMatrix`, que ya está testeado;
//   - las instancias del bloque repetible las expande `acroName.ts`.
//
// Lo que agrega: el cruce con el main (tipos y ANCHOS reales), las validaciones
// y las reglas en prosa de las columnas G y K, las rutas JSON con el índice de
// instancia, y la detección de los huecos de la última milla.
// ---------------------------------------------------------------------------

import type { AcroField, Field, FieldType, FormDefinition, IdConvention, SourceField } from '../../types';
import type { FichaRawResult, FichaRow, RoutingEntry } from '../etapa0/fichaRaw';
import { norm } from '../etapa0/fichaRaw';
import {
  detectarBloquesInstanciables,
  expandirInstancias,
  instanciasPorDefecto,
  slug,
  type FilaExpandida,
  type Instancia,
} from '../etapa0/acroName';
import { mapType, materializeMatrix, parseRule, type MatrixEntry } from '../matrix';
import { flattenFields, renameFieldId } from '../matching';
import { anchoDeCampo, anchoUtil, rectDeAcro } from './anchos';
import { derivarValidacion, type ValidacionDerivada } from './validaciones';
import { codigosAplicables, pideConcatenar, revelaCampos } from './reglas';

export interface HuecoUltimaMilla {
  ruta: string;
  motivo: string;
  /** campos del PDF involucrados */
  sourceNames: string[];
}

export interface EntradaGeneracion {
  ficha: FichaRawResult;
  /** campos del main de Signframe (`extractAcroFromForm`); sin él no hay sourceMeta */
  main?: AcroField[];
  convention?: IdConvention;
}

export interface ResultadoGeneracion {
  form: FormDefinition;
  sourceFields: SourceField[];
  /** nombres de col N que no están en el main */
  sinVincular: string[];
  /** nombres del main que la ficha no menciona */
  mainSinUsar: string[];
  huecos: HuecoUltimaMilla[];
  /** celdas de col G/K con texto que no se pudo interpretar */
  reglasSinInterpretar: { hoja: string; fila: number; crudo: string }[];
  instancias: Instancia[];
  stats: {
    secciones: number;
    subsecciones: number;
    campos: number;
    conSourceMeta: number;
    sinRuta: number;
    soloJson: number;
    excluidas: number;
    porInstanciaNoAplica: number;
    radios: number;
    idsAdoptados: number;
    anchoUtil: number;
    filasConColN: number;
    hojas: number;
  };
  avisos: string[];
}

/** Tokens de la col N («No aplica» es vacío). */
export function tokensColN(v: string): string[] {
  return String(v ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(no aplica|n\/a|na)$/i.test(s));
}

/**
 * Cuál de los nombres de la col N le toca a esta instancia.
 * El nombre lo generó Etapa 0 con el prefijo de la instancia (`asg_`, `pjr_`) y
 * los códigos salen de la propia ficha, así que el prefijo no es un caso
 * especial de ningún formulario. Si el prefijo no aparece, se cae al orden
 * posicional, que es el orden en que la ficha declara los códigos.
 */
export function nombreParaInstancia(
  tokens: string[],
  inst: Instancia | null,
  idx: number,
  todas: Instancia[] = [],
): string | null {
  if (tokens.length === 0) return null;
  if (!inst) return tokens[0];
  const pref = norm(slug(inst.prefijo || inst.codigo));
  const porPrefijo = tokens.find((t) => norm(t).startsWith(pref + '_'));
  if (porPrefijo) return porPrefijo;
  // Si los nombres llevan el prefijo de OTRAS instancias pero no el de esta, la
  // fila no es de esta instancia: es el mismo subset que declara la col G, dicho
  // por los nombres. Sin esto, ASG se quedaba con un campo `pjr_*` y su ruta
  // apuntaba a `personas[0]` — que es justo lo que el diagnóstico de índice
  // repetido cazó en el CSC.
  const prefijosAjenos = todas
    .filter((x) => x.codigo !== inst.codigo)
    .map((x) => norm(slug(x.prefijo || x.codigo)));
  const hayAjeno = tokens.some((t) => prefijosAjenos.some((p) => norm(t).startsWith(p + '_')));
  if (hayAjeno) return null;
  return tokens[idx] ?? null;
}

/**
 * Sección y subsección de una fila. Las columnas A y B mandan; cuando vienen
 * vacías se arrastra la última (la ficha nombra el grupo solo en su primera
 * fila) y, si tampoco hay, se resuelve por la hoja «Estructura base JSON».
 */
export function estructuraDeFila(
  fila: FichaRow,
  routing: RoutingEntry[],
  ultimo: { seccion: string; subseccion: string },
): { seccion: string; subseccion: string } {
  const rutaDeHoja = routing.find((r) => (r.nodo.split('.').filter(Boolean).pop() ?? '') === fila.hoja);
  // «JSON» en la col A no es el nombre de un paso: es la marca de que la fila
  // NO va al PDF (contrato JSON). Sin esta línea el formulario salía con cuatro
  // secciones llamadas «JSON» y los campos sacados de su sección real.
  const pasos = /^json$/.test(norm(fila.pasos)) ? '' : fila.pasos.trim();
  // El índice del INS puede declarar que una hoja NO es un paso del formulario
  // («encabezado» tiene paso «No aplica»): es el sobre del contrato JSON, no
  // algo que el usuario llene. Esos campos existen —escriben el JSON— pero su
  // sección va oculta, y el nombre de la hoja es mejor rótulo que «No aplica».
  const pasoRouting = rutaDeHoja && !/^no aplica$/.test(norm(rutaDeHoja.paso)) ? rutaDeHoja.paso.trim() : '';
  const seccion = pasos || ultimo.seccion || pasoRouting || fila.hoja;
  const subseccion =
    fila.seccion.trim() || ultimo.subseccion || rutaDeHoja?.secciones.split(/[,/]/)[0]?.trim() || 'General';
  return { seccion, subseccion };
}

/** Ruta JSON con el índice de instancia inyectado. */
export function rutaConInstancia(path: string, fila: FilaExpandida, hojasBloque: Set<string>): string {
  const p = (path ?? '').trim();
  if (!p || !fila.instancia || fila.indiceInstancia == null) return p;
  // La ficha escribe `datosFormulario.personas.primerApellido`; el contrato pide
  // `datosFormulario.personas[0].primerApellido`. El nodo a indexar es la hoja
  // RAÍZ del bloque, no la hija: `personas.direccion.provincia` indexa en
  // `personas[i].direccion.provincia`.
  for (const hoja of hojasBloque) {
    const re = new RegExp(`(^|\\.)${hoja}(\\.|$)`);
    if (re.test(p) && !p.includes(`${hoja}[`)) {
      return p.replace(re, (_m, a: string, b: string) => `${a}${hoja}[${fila.indiceInstancia}]${b}`);
    }
  }
  return p;
}

/** Tipo del campo: la col E manda y el main desempata. */
export function tipoDeFila(fila: FichaRow, acro: AcroField | undefined): FieldType {
  const porFicha = mapType(fila.tipo);
  const sm = acro?.sourceMeta as Record<string, unknown> | undefined;
  const tipoMain = String((sm?.type as string) ?? acro?.type ?? '');
  // El main sabe lo que el PDF tiene de verdad: una casilla es una casilla.
  if (/check|btn/i.test(tipoMain)) return porFicha === 'radio' ? 'radio' : 'checkbox';
  if (/sig/i.test(tipoMain)) return 'signature';
  return porFicha ?? 'text';
}

/** Hojas que el índice del INS marca como «No aplica»: no son pasos del form. */
export function hojasSinPaso(routing: RoutingEntry[]): Set<string> {
  const out = new Set<string>();
  for (const r of routing) {
    if (/^no aplica$/.test(norm(r.paso))) {
      const hoja = r.nodo.split('.').filter(Boolean).pop() ?? '';
      if (hoja) out.add(hoja);
    }
  }
  return out;
}

/** ¿La fila aplica a esta instancia, según la col G? */
export function aplicaAInstancia(fila: FichaRow, inst: Instancia | null): boolean {
  if (!inst) return true;
  const codigos = codigosAplicables(fila.regla) ?? codigosAplicables(fila.observaciones);
  if (!codigos) return true;
  return codigos.some((c) => norm(c) === norm(inst.codigo));
}

export function generarDesdeFicha(e: EntradaGeneracion): ResultadoGeneracion {
  const { ficha } = e;
  const convention: IdConvention = e.convention ?? 'lower';
  const main = e.main ?? [];
  const avisos: string[] = [];

  const porNombre = new Map(main.map((a) => [a.name, a]));
  const util = anchoUtil(main).util;

  // --- instancias del bloque repetible ------------------------------------
  const bloque = detectarBloquesInstanciables(ficha.rows, ficha.routing)[0];
  const instancias = bloque ? instanciasPorDefecto(bloque.codigos) : [];
  const hojasBloque = new Set(bloque?.hojas ?? []);
  const filas: FilaExpandida[] = bloque
    ? expandirInstancias(ficha.rows, bloque.hojas, instancias)
    : ficha.rows.map((r) => ({ ...r, instancia: null, indiceInstancia: null }));

  // --- filas -> MatrixEntry ------------------------------------------------
  const entries: MatrixEntry[] = [];
  const reglasSinInterpretar: ResultadoGeneracion['reglasSinInterpretar'] = [];
  const validacionPorEntry = new Map<number, ValidacionDerivada>();
  const huecos: HuecoUltimaMilla[] = [];
  const usados = new Set<string>();
  const sinVincular: string[] = [];
  let excluidas = 0;
  let porInstanciaNoAplica = 0;
  let soloJson = 0;
  let filasConColN = 0;
  const ultimo = { seccion: '', subseccion: '' };
  const contadorSub = new Map<string, number>();
  const vistas = new Set<string>();
  const reglasVistas = new Set<string>();

  for (const fila of filas) {
    if (fila.destino === 'excluida') {
      excluidas++;
      continue;
    }
    // La col G puede declarar a qué instancias aplica la fila. Es el subset por
    // instancia dicho en palabras, y en el CSC son 48 filas: sin esto el
    // asegurado hereda los campos de la persona jurídica.
    if (!aplicaAInstancia(fila, fila.instancia)) {
      porInstanciaNoAplica++;
      continue;
    }

    const tokens = tokensColN(fila.campoPdfInterno);
    if (tokens.length > 0) filasConColN++;

    const est = estructuraDeFila(fila, ficha.routing, ultimo);
    ultimo.seccion = est.seccion;
    ultimo.subseccion = est.subseccion;
    // Cada instancia es su propio paso: el usuario llena ASG, después PJR.
    const seccion = est.seccion + (fila.instancia ? ` · ${fila.instancia.codigo}` : '');

    const idx = fila.instancia ? Math.max(0, instancias.findIndex((i) => i.codigo === fila.instancia!.codigo)) : 0;
    const nombre = nombreParaInstancia(tokens, fila.instancia, idx, instancias);
    // Fila del bloque cuyos nombres son todos de otras instancias: no aplica.
    if (fila.instancia && tokens.length > 0 && !nombre) {
      porInstanciaNoAplica++;
      continue;
    }

    // Una fila con varios campos del PDF (1:N) se liga al PRIMERO; el reparto en
    // día/mes/año es un `autoFillConcat`, que es última milla.
    if (nombre && tokens.length > 1 && !fila.instancia) {
      huecos.push({
        ruta: fila.campoJson || '(sin ruta)',
        motivo: `requiere autoFillConcat de ${tokens.length} campos`,
        sourceNames: tokens,
      });
    }
    // Y la ficha a veces lo declara con todas las letras.
    if (pideConcatenar(fila.observaciones) || pideConcatenar(fila.regla)) {
      const ruta = rutaConInstancia(fila.campoJson, fila, hojasBloque) || '(sin ruta)';
      if (!huecos.some((h) => h.ruta === ruta && /concaten/i.test(h.motivo))) {
        huecos.push({
          ruta,
          motivo: 'la ficha pide concatenar automáticamente (autoFillConcat)',
          sourceNames: nombre ? [nombre] : [],
        });
      }
    }

    if (nombre) {
      usados.add(nombre);
      if (!porNombre.has(nombre) && main.length > 0) sinVincular.push(nombre);
    } else {
      soloJson++;
    }
    const acro = nombre ? porNombre.get(nombre) : undefined;

    // validaciones: la col K primero, la col G como respaldo (en el CSC las dos
    // traen reglas: «50 caracteres alfanumericos» en K, «Alfanumérico (50)» en G)
    const vK = derivarValidacion(fila.observaciones);
    const vG = derivarValidacion(fila.regla);
    const validacion = vK.reconocido && vK.senales.length ? vK : vG.reconocido && vG.senales.length ? vG : vK;
    for (const [col, v] of [
      ['K', vK],
      ['G', vG],
    ] as const) {
      if (!v.crudo.trim() || v.reconocido) continue;
      // La expansión por instancia repite la misma fila: se reporta una vez.
      const clave = `${fila.hoja}|${fila.fila}|${col}`;
      if (reglasVistas.has(clave)) continue;
      reglasVistas.add(clave);
      reglasSinInterpretar.push({ hoja: fila.hoja, fila: fila.fila, crudo: `col ${col}: ${v.crudo}` });
    }

    // condicionales: el patrón «se despliegan los campos» de `matrix.parseRule`
    // y el del CSC («Si se escoge "SI" se debe mostrar el campo "X"»).
    const rule = parseRule(fila.regla);
    const rev = revelaCampos(fila.regla) ?? revelaCampos(fila.observaciones);
    const reveals = rule.reveals.length ? rule.reveals : (rev?.campos ?? []);

    const clave = seccion + '||' + est.subseccion;
    const n = (contadorSub.get(clave) ?? 0) + 1;
    contadorSub.set(clave, n);

    // Una fila repetida (mismo campo, misma sección) no se duplica.
    const claveFila = `${seccion}|${est.subseccion}|${nombre ?? fila.campoJson}|${fila.valor}`;
    if (vistas.has(claveFila)) continue;
    vistas.add(claveFila);

    const entry: MatrixEntry = {
      index: n,
      globalIndex: entries.length + 1,
      section: seccion,
      subsection: est.subseccion,
      sourceName: nombre,
      label: fila.label || fila.nombrePdf || '(sin label)',
      value: fila.valor,
      type: tipoDeFila(fila, acro),
      typeRaw: fila.tipo,
      path: rutaConInstancia(fila.campoJson, fila, hojasBloque),
      conditionRaw: fila.regla,
      condition: rule.selfCondition,
      reveals,
      required: esObligatorio(fila.obligatorio),
      readOnly: /disabled/.test(norm(fila.visualizacion)),
      hidden: /no aplica/.test(norm(fila.visualizacion)),
      duplicateCount: 1,
    };
    entries.push(entry);
    validacionPorEntry.set(entry.globalIndex, validacion);
  }

  // --- estructura (reusa materializeMatrix) -------------------------------
  const mat = materializeMatrix(
    {
      entries,
      sourceFields: [],
      groups: [],
      duplicates: {},
      stats: {
        columns: 14,
        rows: entries.length,
        uniqueFields: entries.length,
        sections: 0,
        subsections: 0,
        withSource: entries.filter((x) => x.sourceName).length,
        duplicates: 0,
      },
    },
    convention,
  );

  const form: FormDefinition = {
    sections: mat.sections,
    validationRules: [],
    prefillMappings: [],
    generatedDocuments: [],
    version: 1,
  };

  // --- post-proceso: anchos, validaciones y las reglas de la casa ---------
  const porSourceName = new Map<string, MatrixEntry>();
  for (const x of entries) if (x.sourceName) porSourceName.set(x.sourceName, x);

  let radios = 0;
  let sinRuta = 0;
  for (const campo of flattenFields(form)) {
    const sm = campo.sourceMeta as Record<string, unknown> | null;
    const nombre = typeof sm?.sourceName === 'string' ? (sm.sourceName as string) : null;
    const entry = nombre ? porSourceName.get(nombre) : undefined;
    const acro = nombre ? porNombre.get(nombre) : undefined;
    const esOpcion = campo.type === 'radio' && !!campo.radioGroupLabel;

    campo.width = anchoDeCampo({ tipo: campo.type, esOpcion }, acro ? rectDeAcro(acro) : null, util);

    const v = entry ? validacionPorEntry.get(entry.globalIndex) : undefined;
    if (v) {
      if (v.validationPattern && !campo.validationPattern) campo.validationPattern = v.validationPattern;
      if (v.jsonDateFormat && !campo.jsonDateFormat) campo.jsonDateFormat = v.jsonDateFormat;
      // Signframe no tiene `maxLength` propio: el tope viaja como patrón.
      if (v.maxLength != null && !campo.validationPattern && (campo.type === 'text' || campo.type === 'textarea')) {
        campo.validationPattern = `^.{0,${v.maxLength}}$`;
      }
    }

    // §7 reglas de Signframe
    if (campo.type === 'checkbox' && campo.sourceMeta) campo.checkedPdfValue = true;
    if (!campo.prefillMode) campo.prefillMode = 'optional';
    if (campo.salidaJSON) campo.prefillKey = campo.salidaJSON;
    else sinRuta++;
    if (esOpcion) radios++;

    // `sourceMeta` VERBATIM del main cuando existe. Es ground truth.
    if (acro?.sourceMeta) campo.sourceMeta = acro.sourceMeta;
  }

  // Secciones que salen de una hoja sin paso: ocultas de forma permanente
  // (`hidden: true` + `conditionalVisibility: null`, nunca NEVER_EXISTS).
  const sinPaso = hojasSinPaso(ficha.routing);
  let seccionesOcultas = 0;
  for (const sec of form.sections) {
    if (sinPaso.has(sec.title)) {
      sec.hidden = true;
      sec.conditionalVisibility = null;
      seccionesOcultas++;
    }
  }
  if (seccionesOcultas > 0) {
    avisos.push(
      `${seccionesOcultas} sección(es) quedan ocultas porque el índice de la ficha las marca «No aplica» como paso: son el contrato JSON, no pantallas del formulario.`,
    );
  }

  // §8 — adoptar el `id` REAL del main y reescribir todas las referencias
  // (`conditionalVisibility`, `conditionalRequired`, `radioGroupFields`,
  // `autoFillConcat.sourceFieldIds`). Un main derivado del PDF no trae `id`
  // autoritativo; ahí el id ya salió por la Regla de Oro y no hay nada que
  // adoptar.
  let idsAdoptados = 0;
  let formConIds = form;
  for (const campo of flattenFields(formConIds)) {
    const sm = campo.sourceMeta as Record<string, unknown> | null;
    const nombre = typeof sm?.sourceName === 'string' ? (sm.sourceName as string) : null;
    const acro = nombre ? porNombre.get(nombre) : undefined;
    if (!acro?.id || acro.id === campo.id) continue;
    formConIds = renameFieldId(formConIds, campo.id, acro.id, {});
    idsAdoptados++;
  }
  form.sections = formConIds.sections;

  marcarExcludeEnGrupos(form);
  reordenar(form);

  const mainSinUsar = main.filter((a) => !usados.has(a.name)).map((a) => a.name);
  if (main.length === 0) {
    avisos.push(
      'Sin el JSON main no hay `sourceMeta`: los campos no van a pintar el PDF y los anchos quedan en «full». Se puede generar igual y cargar el main después.',
    );
  }
  if (filasConColN === 0) {
    avisos.push(
      'Ninguna fila de la ficha tiene la col N llena: sin eso no hay con qué bindear. Corré Etapa 0 y resolvé el mapeo primero.',
    );
  }

  const campos = flattenFields(form);
  return {
    form,
    sourceFields: mat.sourceFields,
    sinVincular: [...new Set(sinVincular)],
    mainSinUsar,
    huecos,
    reglasSinInterpretar,
    instancias,
    stats: {
      secciones: form.sections.length,
      subsecciones: form.sections.reduce((n, s) => n + s.subsections.length, 0),
      campos: campos.length,
      conSourceMeta: campos.filter((c) => c.sourceMeta).length,
      sinRuta,
      soloJson,
      excluidas,
      porInstanciaNoAplica,
      radios,
      idsAdoptados,
      anchoUtil: util,
      filasConColN,
      hojas: new Set(ficha.rows.map((r) => r.hoja)).size,
    },
    avisos,
  };
}

/** col H: `Both` / `JSON` / `WEB` / `None`. */
export function esObligatorio(colH: string): boolean {
  const t = norm(colH);
  if (!t) return false;
  if (/^(none|no|n\/a|no aplica)$/.test(t)) return false;
  return /both|json|web|s[ií]|obligatorio|requerido/.test(t);
}

/**
 * Radios que comparten `salidaJSON`: solo uno lleva la ruta, los demás van con
 * `excludeFromJson: true`. Si todos la llevaran, al marcar uno se sincronizarían
 * todos y el JSON saldría con el valor equivocado.
 */
export function marcarExcludeEnGrupos(form: FormDefinition): number {
  let marcados = 0;
  const porRuta = new Map<string, Field[]>();
  for (const c of flattenFields(form)) {
    if (!c.salidaJSON || c.type !== 'radio') continue;
    if (!porRuta.has(c.salidaJSON)) porRuta.set(c.salidaJSON, []);
    porRuta.get(c.salidaJSON)!.push(c);
  }
  for (const grupo of porRuta.values()) {
    if (grupo.length < 2) continue;
    grupo.forEach((c, i) => {
      if (i === 0) return;
      c.excludeFromJson = true;
      marcados++;
    });
  }
  return marcados;
}

/** `order` explícito 1..n: con `order: 0` Signframe apila los radios. */
export function reordenar(form: FormDefinition): void {
  for (const s of form.sections) {
    s.fields.forEach((f, i) => (f.order = i + 1));
    s.subsections.forEach((sub, k) => {
      sub.order = k + 1;
      sub.fields.forEach((f, i) => (f.order = i + 1));
    });
  }
}
