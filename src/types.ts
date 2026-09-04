// ---------------------------------------------------------------------------
// Tipos de la app (v3.0.0).
//
// Con el recorte a Etapa 0 se fueron todos los tipos del form-definition de
// Signframe (`Field`, `Section`, `Subsection`, `FormDefinition`, `AutoFillConcat`,
// `RepeaterConfig`, `Condition`, `SourceMeta`…): el form-def lo genera la skill y
// la app ya no lo modela. Lo que queda describe el trabajo de Etapa 0.
// ---------------------------------------------------------------------------

/** Proyecto guardable: el nombre y las decisiones de Etapa 0. */
export interface Project {
  name: string;
  etapa0?: Etapa0State;
}

// --- Estado persistible de Etapa 0 ---------------------------------------
// Los archivos (ficha .xlsx y PDF crudo) NO se guardan: solo las decisiones.
// Al retomar, se vuelven a adjuntar y el estado se re-hidrata por nombre.

export interface Etapa0Edicion {
  nombreNuevo: string;
  tipo: string;
  manual: boolean;
}

/**
 * Campo dibujado a mano sobre el PDF (v1.4.4). El `uid` es su identidad y NO
 * depende del nombre: si el usuario borra un campo y crea otro con el mismo
 * nombre, remapear por nombre reengancharía la edición al campo equivocado.
 */
export interface Etapa0CampoCreado {
  uid: string;
  nombre: string;
  /** '/Tx' | '/Btn' | '/Sig' */
  tipo: string;
  /** 0-based */
  page: number;
  /** coordenadas PDF (origen abajo-izquierda) */
  rect: { x: number; y: number; w: number; h: number };
  /** uid del grupo cuando el campo salió de trocear un rect en N cajas */
  grupo?: string;
  /** posición dentro del grupo troceado (1-based) */
  parte?: number;
}

export interface Etapa0State {
  fichaNombre?: string;
  pdfNombre?: string;
  /** nombre del paquete que se cargó, si se cargó uno */
  paqueteNombre?: string;
  /** nombre ACTUAL del campo en el PDF -> edición */
  ediciones: Record<string, Etapa0Edicion>;
  limitarFuente: boolean;
  tamanoFuente: number;
  pdfDescargado: boolean;
  paqueteDescargado: boolean;
  /**
   * Columnas que la skill completó afuera, por `nombre_actual`. Se guardan para
   * que el paquete pueda dar vueltas sin perder información aunque se recargue
   * la app en el medio.
   */
  externas?: Record<string, Record<string, string>>;
  /** campos dibujados a mano (v1.4.4) */
  camposCreados?: Etapa0CampoCreado[];
  /** nombres ACTUALES de los campos detectados que el usuario borró */
  camposBorrados?: string[];
  /**
   * Geometría editada a mano (v2.0.0). Clave: `claveEstable#índiceDeWidget`
   * sobre la lista ORIGINAL de campos, que no cambia nunca.
   */
  rectsEditados?: Record<string, { x: number; y: number; w: number; h: number }>;
}
