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

### Importar ficha/matriz (CSV o xlsx)

El botón **Matriz** sube una planilla (CSV o `.xlsx`) que describe cómo debería
verse el formulario. La app **no arma la definición sola**: mira las columnas y
las secciones/subsecciones, te muestra un resumen (cuántas columnas, secciones,
subsecciones y campos detectó) y:

- carga los campos al **pool**, cada uno con su **sección/subsección sugerida**
  como etiqueta (para que sepas a dónde va);
- opcionalmente crea las **secciones y subsecciones vacías** detectadas, para que
  arrastres los campos adentro y armes el camino a mano.

Al arrastrar un campo de la matriz, nace con el tipo y el `salidaJSON` sugeridos
(igual respetando la Regla de Oro). El mapeo fino contra el JSON del PDF queda
para un segundo momento. Las columnas se mapean a mano (se auto-detectan por
nombre) y soporta forward-fill: si la sección solo aparece en la primera fila del
grupo, se arrastra a las siguientes.

#### Ficha del INS (Etapa 1: armar ordenado)

El importador reconoce el formato real de la **“Ficha de Configuración” del INS**
(`.xlsx` con varias hojas). Al importar:

- **detecta la hoja principal** (la que tiene más filas) entre las 3 hojas;
- mapea las columnas por nombre (tolerante a acentos): `Pasos Formulario`→sección,
  `Sección`→subsección, `Nombre del campo en formulario`→label, `Tipo de dato`→tipo,
  `Valor`→opción, `Regla`→condición, `Obligatorio`→required, `Visualización en
  Formularios`→readOnly/hidden, `Nombre del campo en el JSON`→`salidaJSON`,
  `Nombre del campo en el PDF`→`sourceName`;
- **forward-fill** de sección/subsección (celdas combinadas);
- **agrupa opciones**: filas consecutivas con el mismo label = una pregunta con
  varias opciones → se modela **desdoblada** (un `radio` por opción, compartiendo
  `radioGroupLabel` y `radioGroupFields`, con `jsonValue` = valor de la opción);
- **reglas col G**: `"se despliegan los campos: A / B"` hace que A/B se muestren
  cuando esa opción se selecciona (`conditionalVisibility` `not_empty`, combinadas
  con `or` si varias opciones revelan el mismo campo).

En el modo **Etapa 1 · Armar ordenado**, todo esto queda ya ubicado en su lugar.
Como la columna `Nombre del campo en el PDF` suele venir vacía, los campos nacen
como UI (`sourceMeta: null`); el binding real al PDF es la **Etapa 2** (cruzar
contra la lista de AcroForms para asignar `sourceMeta`), y la **Etapa 3** es el
export del JSON completo.

#### Explorar matriz (entenderla antes de armar)

Desde el importador, **Explorar en detalle** abre una vista de solo lectura para
entender la ficha sin tocar nada:

- **Orden** tal como viene la matriz (Sección → Subsección → campos numerados).
- **Duplicados**: marca los campos que aparecen más de una vez (`×N`), tanto por
  `sourceName` como por label.
- **Ramas Sí/No**: si mapeás una columna de *Condición* (p. ej. `Campo = Sí`), un
  simulador te deja elegir respuestas y ver en vivo **qué campos aparecen y cuáles
  se ocultan** (“qué sale si dice Sí / qué pasa si dice No”). El parser de
  condiciones es tolerante: acepta `=`, `:`, `es`, `vale`, prefijos como “si …” y
  frases negativas, y siempre muestra el texto crudo de la condición.

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
