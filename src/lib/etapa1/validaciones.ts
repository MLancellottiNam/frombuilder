// ---------------------------------------------------------------------------
// Etapa 1 — Validaciones desde la col K (v3.0.0).
//
// La col K («Regla») es texto libre pero muy regular. Lo que se deduce:
//
//   "8 dígitos"                      -> maxLength 8 + patrón numérico
//   "150 caracteres alfanuméricos"   -> maxLength 150
//   "Formato dd/mm/aaaa"             -> jsonDateFormat
//   "Formato de correo"              -> patrón de correo
//
// Regla de la casa: lo que NO se entiende **no se inventa**. Se devuelve
// `reconocido: false` con el texto crudo, y la UI lo muestra como pendiente de
// revisar. Un `maxLength` inventado corta datos del cliente en producción.
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface ValidacionDerivada {
  maxLength?: number;
  /** regex para `validationPattern` */
  validationPattern?: string;
  /** `jsonDateFormat` / `jsonNumberFormat` de Signframe */
  jsonDateFormat?: string;
  jsonNumberFormat?: string;
  /** qué se reconoció, para poder explicarlo */
  senales: string[];
  /** false si la celda tenía texto y no se pudo derivar nada */
  reconocido: boolean;
  /** el texto original, siempre */
  crudo: string;
}

export const PATRON_NUMERICO = '^[0-9]+$';
export const PATRON_CORREO = '^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$';
export const PATRON_ALFANUM = '^[A-Za-z0-9 ]+$';

/** Formatos de fecha que aparecen escritos en la col K. */
const FORMATOS_FECHA: [RegExp, string][] = [
  [/dd\s*\/\s*mm\s*\/\s*aa{2}/, 'dd/MM/yyyy'],
  [/dd\s*\/\s*mm\s*\/\s*aa/, 'dd/MM/yy'],
  [/aa{3}\s*-\s*mm\s*-\s*dd/, 'yyyy-MM-dd'],
  [/dd\s*-\s*mm\s*-\s*aa{2}/, 'dd-MM-yyyy'],
  [/mm\s*\/\s*aa{3}/, 'MM/yyyy'],
];

export function derivarValidacion(crudo: string): ValidacionDerivada {
  const out: ValidacionDerivada = { senales: [], reconocido: false, crudo: crudo ?? '' };
  const t = norm(crudo);
  if (!t) {
    out.reconocido = true; // vacío no es un problema: simplemente no hay regla
    return out;
  }

  // fecha
  for (const [re, fmt] of FORMATOS_FECHA) {
    if (re.test(t)) {
      out.jsonDateFormat = fmt;
      out.senales.push(`formato de fecha ${fmt}`);
      break;
    }
  }

  // correo
  if (/correo|email|e-mail/.test(t)) {
    out.validationPattern = PATRON_CORREO;
    out.senales.push('patrón de correo');
  }

  // cantidad + unidad. «8 dígitos», «150 caracteres», «hasta 30 caracteres» y
  // también la forma con paréntesis que usa la col G del CSC:
  // «Alfanumérico (50)» —y su typo real «Alfanumércico(50)»—.
  let t2 = t;
  const paren = t.match(/(alfanumer\w*|numeric\w*|texto)\s*\((\d+)\)/);
  if (paren) t2 = `${paren[2]} caracteres ${paren[1]}`;
  const m = t2.match(/(\d+)\s*(digitos?|numeros?|caracteres?|letras?)/);
  if (m) {
    const n = Number(m[1]);
    const unidad = m[2];
    if (Number.isFinite(n) && n > 0) {
      out.maxLength = n;
      out.senales.push(`máximo ${n} ${unidad}`);
      if (/digito|numero/.test(unidad)) {
        // Solo dígitos: además del tope, el patrón. Si el texto dice
        // «alfanumérico» no se fuerza numérico aunque diga «dígitos».
        if (!/alfanumer/.test(t)) {
          out.validationPattern = out.validationPattern ?? PATRON_NUMERICO;
          out.senales.push('solo dígitos');
        }
      }
    }
  } else {
    // «numérico» / «solo números» sin cantidad
    if (/^(numerico|solo numeros?|numeros?)$/.test(t) || /\bsolo numeros?\b/.test(t)) {
      out.validationPattern = out.validationPattern ?? PATRON_NUMERICO;
      out.senales.push('solo dígitos');
    }
  }

  // alfanumérico explícito, sin tope: no se pone patrón (dejaría afuera
  // acentos, guiones y puntos que el INS sí usa). Se anota como señal.
  if (/alfanumer/.test(t)) out.senales.push('alfanumérico');

  // «obligatorio» a veces se cuela en la col K; lo maneja la col H.
  if (/obligatorio|requerido/.test(t)) out.senales.push('menciona obligatoriedad (la decide la col H)');

  out.reconocido = out.senales.length > 0;
  return out;
}

/** Aplica lo derivado sobre un campo, sin pisar lo que ya tenga. */
export function aplicarValidacion<
  T extends {
    validationPattern: string | null;
    jsonDateFormat: string | null;
    jsonNumberFormat: string | null;
  },
>(campo: T, v: ValidacionDerivada): T & { maxLength?: number } {
  if (v.validationPattern && !campo.validationPattern) campo.validationPattern = v.validationPattern;
  if (v.jsonDateFormat && !campo.jsonDateFormat) campo.jsonDateFormat = v.jsonDateFormat;
  if (v.jsonNumberFormat && !campo.jsonNumberFormat) campo.jsonNumberFormat = v.jsonNumberFormat;
  return campo as T & { maxLength?: number };
}
