// ---------------------------------------------------------------------------
// Etapa 1 — Las reglas escritas en prosa de las columnas G y K (v3.0.0).
//
// El prompt daba por dominante el patrón «se despliegan los campos: A / B», que
// es el de la ficha de Vida Colectiva y el que `matrix.parseRule` ya maneja. En
// la ficha del CSC ese patrón NO aparece ni una vez (0 de 173 filas). Lo que
// aparece es otro vocabulario, y dos de sus formas valen mucho más:
//
//   «Solo aplica cuando código de persona es "ASG" y "RPL"»
//        -> la fila NO aplica a todas las instancias. Es el subset por
//           instancia DECLARADO en texto, lo mismo que Etapa 0 tenía que
//           deducir de la geometría. Si se ignora, el asegurado hereda campos
//           que solo existen para la persona jurídica.
//
//   «Si se escoge "SI" se debe mostrar el campo "Detalle el Cargo"»
//        -> la fila es el disparador y revela otro campo con un valor concreto,
//           así que da `equals` en vez de `not_empty`.
//
//   «Concatenar automatico»
//        -> declara un `autoFillConcat`, que es última milla: se marca como
//           hueco, no se inventa.
//
// Cada formulario trae su propia prosa, así que estos parsers son tolerantes y
// lo que no entienden lo devuelven como `null`: la fila queda sin condición y se
// reporta, nunca se adivina.
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Texto entre comillas (rectas o tipográficas), en orden de aparición. */
export function entreComillas(texto: string): string[] {
  const out: string[] = [];
  const re = /["“”'‘’]([^"“”'‘’]+)["“”'‘’]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto ?? '')) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * Una celda puede traer DOS frases pegadas («Si se escoge "SI" se debe mostrar
 * el campo "Detalle el Cargo" / Solo aplica cuando código de persona es "PJR"»),
 * así que cada parser trabaja sobre su propia cláusula. Sin esto, los códigos de
 * instancia se llevaban «SI» y «Detalle el Cargo» de premio.
 */
function partirClausulas(texto: string): { soloAplica: string; resto: string } {
  const t = texto ?? '';
  const m = t.match(/solo aplica/i);
  if (!m || m.index == null) return { soloAplica: '', resto: t };
  const desde = t.slice(m.index);
  // La cláusula termina en el próximo punto, punto y coma o salto de línea.
  const fin = desde.search(/[.;\n]/);
  return {
    soloAplica: fin >= 0 ? desde.slice(0, fin) : desde,
    resto: t.slice(0, m.index) + (fin >= 0 ? desde.slice(fin + 1) : ''),
  };
}

/**
 * «Solo aplica cuando código de persona es "ASG" y "RPL"» -> ['ASG','RPL'].
 * `null` = aplica a todas las instancias (lo normal).
 *
 * Los códigos NO se validan contra una lista fija: se devuelven como están y
 * quien expande las instancias los compara con los que declara la propia ficha.
 */
export function codigosAplicables(texto: string): string[] | null {
  const { soloAplica } = partirClausulas(texto);
  const t = norm(soloAplica);
  if (!t) return null;
  if (!/(codigo|tipo) de persona|codigo de tipo/.test(t)) return null;
  const codigos = entreComillas(soloAplica).map((c) => c.trim().toUpperCase());
  if (codigos.length > 0) return [...new Set(codigos)];
  // Sin comillas: códigos en mayúsculas de 2-4 letras.
  const sueltos = (soloAplica.match(/\b[A-Z]{2,4}\b/g) ?? []).filter((c) => c !== 'SI' && c !== 'NO');
  return sueltos.length > 0 ? [...new Set(sueltos)] : null;
}

export interface RevelaCampos {
  /** valor que dispara (vacío = alcanza con que tenga valor) */
  valor: string;
  /** labels de los campos que se revelan */
  campos: string[];
}

/**
 * «Si se escoge "SI" se debe mostrar el campo "Detalle el Cargo"»
 * «Si se marca "Otro" se muestran los campos "Detalle" y "Descripción"»
 */
export function revelaCampos(texto: string): RevelaCampos | null {
  const { resto } = partirClausulas(texto);
  texto = resto;
  const t = norm(texto);
  if (!t) return null;
  if (!/(se debe |se )?(mostrar|muestra|desplegar|despliega|habilitar)/.test(t)) return null;
  const citas = entreComillas(texto);
  // La primera cita es el valor que dispara cuando la frase arranca con «si».
  const arrancaCondicional = /^(si|cuando|en caso)/.test(t);
  if (arrancaCondicional && citas.length >= 2) {
    return { valor: citas[0], campos: citas.slice(1) };
  }
  // Sin comillas para el valor: «se debe mostrar el campo "X"».
  const idxCampo = t.indexOf('campo');
  if (citas.length >= 1 && idxCampo >= 0) {
    return { valor: arrancaCondicional ? '' : '', campos: citas };
  }
  return null;
}

/** ¿La celda declara un `autoFillConcat`? */
export function pideConcatenar(texto: string): boolean {
  const t = norm(texto);
  return /concatena/.test(t);
}

/** ¿La celda dice que el campo es solo informativo (no viaja al JSON)? */
export function esSoloInformativo(texto: string): boolean {
  return /solo informativo/.test(norm(texto));
}
