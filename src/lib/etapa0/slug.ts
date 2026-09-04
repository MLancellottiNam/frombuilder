// ---------------------------------------------------------------------------
// Etapa 0 — Nombre de archivo (v3.0.0).
//
// Vivía en `exporter.ts`, que se borró con Etapa 3. Es lo único que Etapa 0
// usaba de ahí: el nombre base de las tres descargas.
// ---------------------------------------------------------------------------

/** `Formulario Conozca (1).pdf` -> `formulario-conozca-1`. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'formulario'
  );
}
