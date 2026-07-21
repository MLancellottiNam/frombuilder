# Signframe Form-Definition Builder

App web local (sin backend) para armar visualmente el JSON de definición de
formularios de **Signframe**. Cargás la lista de campos crudos de un PDF con
AcroForms (CSV), los agrupás en secciones y subsecciones arrastrando, editás sus
propiedades y exportás un `form-definition.json` válido.

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + build de producción
```

Todo corre en el navegador: no hay backend, base de datos, ni llamadas de red.

## Flujo

1. **Cargar CSV** — la lista de `sourceName` del PDF. El diálogo detecta las
   columnas por nombre (sourceName / label / page / type) y la _convención de id_
   (`exact` vs `lower`); podés ajustarlas.
2. **Pool** (columna izquierda) — los campos sin ubicar. Buscador, y selección
   múltiple para **Agrupar** varios en una subsección nueva de un tiro.
3. **Mapa** (centro) — creá Secciones → Subsecciones y arrastrá campos del pool
   (o entre subsecciones) para agruparlos y reordenarlos.
4. **Inspector** (derecha) — editá tipo, label, ancho, `salidaJSON`, opciones,
   visibilidad/requerido condicional, etc. En campos que pintan el PDF, `id` y
   `sourceMeta` quedan **bloqueados** (candado).
5. **Validaciones** — panel en vivo (badge en la barra superior).
6. **Exportar JSON** — descarga el form-definition listo para Signframe.

También podés **Importar JSON** de una definición existente para seguir
editándola (preserva `_sourcePdf`, ids y `sourceMeta`), y **guardar/cargar el
proyecto** completo como `.json`.

## Regla de Oro

Los campos que pintan el PDF llevan `sourceMeta` y su `id` es inmutable, con
`id == "field_" + applyConvención(sourceName)` (los índices `nombre[0]` se
normalizan a `nombre_0`). La app nunca deja editar `id`/`sourceMeta` de esos
campos, y los checkboxes del PDF usan `checkedPdfValue: true` (nunca `"X"`).

## Validaciones en vivo

1. Todos los `sourceName` usados existen en el CSV.
2. `id` alineado con `sourceName` en todo campo con `sourceMeta`.
3. Sin `id` duplicados en el árbol.
4. Cobertura: campos ubicados vs. pendientes en el pool.
5. `order > 0` en todos.
6. Checkboxes del PDF con `checkedPdfValue: true`.
7. `conditionalVisibility` / `conditionalRequired` parsean y referencian ids
   existentes.

Cada ítem que falla es clickeable y selecciona el campo correspondiente.

## Stack

React + Vite + TypeScript + Tailwind · `@dnd-kit` (drag & drop) · `papaparse` ·
`zustand` (estado) · `lucide-react` (íconos).

## Arquitectura

- `src/types.ts` — tipos del dominio Signframe (estructura exacta del export).
- `src/lib/` — lógica pura: `idConvention`, `csv`, `factory`, `conditions`,
  `validation`, `exporter`.
- `src/store/store.ts` — estado central (zustand) con todas las mutaciones.
- `src/components/` — UI (TopBar, Pool, Canvas, Inspector, editores, diálogos).

## Estado de milestones

Implementados M1–M4 (scaffold + CSV + pool, canvas y agrupación con drag & drop,
inspector con la Regla de Oro, export + validaciones en vivo, guardar/cargar
proyecto) más piezas de M5: editor visual de condiciones, editor de opciones e
import de JSON existente. Pendiente de M5: editor completo de `autoFillConcat`,
repeaters + `slotMappings`, radios desdoblados e import de ficha/matriz.
