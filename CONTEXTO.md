# CONTEXTO — Signframe Form-Definition Builder (estado actual)

> Pegá este documento como primer prompt para retomar el trabajo con todo el contexto.
> Describe **qué está implementado hoy**, cómo funciona y qué falta.

---

## 1. Qué es

App web **local, sin backend** para armar visualmente el **JSON de definición de
formularios de Signframe** (plataforma que mapea PDFs con AcroForms del INS Costa Rica
a formularios estructurados).

- Repo: `MLancellottiNam/frombuilder`
- Rama de trabajo: `claude/signframe-form-builder-0bmsbi` (todo mergeado a `main`)
- Live: **https://mlancellottinam.github.io/frombuilder/**
  (GitHub Pages con **Source = GitHub Actions**; si vuelve a “Deploy from a branch”
  sirve el `index.html` fuente y rompe con `main.tsx 404`)
- Stack: **React + Vite + TypeScript + Tailwind**, `@dnd-kit` (drag & drop),
  `papaparse` (CSV), `xlsx`/SheetJS (lazy, solo al importar), `zustand` (estado),
  `lucide-react`, `nanoid`. Todo corre en el navegador: **sin backend ni red**.
- Comandos: `npm install`, `npm run dev` (5173), `npm run build` (tsc + vite).

**Importante: la app es 100% genérica.** No hay nada hardcodeado a un formulario
puntual (verificado: 0 ocurrencias de vital/360/colectivo/gastos/crediticia/d0764 en
`src/`). Sirve para cualquier ficha del INS.

---

## 2. El flujo por etapas (así lo pensamos con el usuario)

1. **Etapa 1 — Ordenar la matriz.** La ficha/matriz (xlsx o CSV) arma el **esqueleto**:
   secciones → subsecciones → campos ya ubicados y ordenados, con labels, tipos,
   paths, radios desdoblados y condiciones.
2. **Etapa 2 — Sumar el PDF.** Se carga el **JSON main de Signframe** (el auto-mapeado
   al importar el PDF) y se **vinculan** los campos con su `sourceName`/`sourceMeta`
   **real**, respetando la Regla de Oro.
3. **Etapa 3 — JSON final.** Export del form-definition. La **última milla**
   (`autoFillConcat`, repeaters, `excludeFromJson` masivo) va con la **skill**
   `signframe-form-def`, no con la app (decisión: enfoque **híbrido**).

---

## 3. REGLA DE ORO (no negociable)

Los campos que pintan el PDF llevan `sourceMeta`. Sobre esos:
- `id` y `sourceMeta` son **inmutables**; la UI los muestra con candado.
- Debe cumplirse `id == "field_" + sourceName`, **respetando el renombrado**:
  Signframe usa **minúsculas** y **`[n]` → `_n`**.
  Ej. real del json main: `sourceName: "depGeneroFem[0]"` → `id: "field_depgenerofem_0"`.
- Campos nuevos de UI (opciones desdobladas, helpers): id nuevo y `sourceMeta: null`.
- Checkboxes que pintan: `checkedPdfValue: true` (nunca `"X"`).

---

## 4. Arquitectura del código

```
src/types.ts            Tipos del dominio Signframe (estructura EXACTA del export)
src/store/store.ts      Estado central (zustand) + todas las mutaciones
src/lib/
  idConvention.ts       detectar/aplicar convención de id (exact|lower, [n]→_n)
  csv.ts                parseo CSV simple (pool) + mapeo de columnas
  matrix.ts             ficha/matriz: parseTable, detección de columnas INS,
                        readMatrix (entries), materializeMatrix (Etapa 1)
  matrixOut.ts          export de la matriz plana a CSV/xlsx (round-trip)
  factory.ts            creación de Field/Section/Subsection + splitPath
  conditions.ts         serializar/parsear conditionalVisibility
  matching.ts           Etapa 2: sugerencias, rename de id con reescritura de refs,
                        extractAcroFromForm (leer el json main)
  exporter.ts           buildExport (orden, childrenOrder, paths sync, _sourcePdf)
  validation.ts         7 validaciones en vivo
src/components/         TopBar, Pool, Canvas, Inspector, MatrixImportDialog,
                        MatrixExplorer, AcroFormsImportDialog, UnirDialog,
                        ValidationPanel, ConditionEditor, OptionsEditor, ui
```

Layout: **3 columnas** — Pool (izq) · Mapa del formulario (centro) · Inspector (der),
con barra superior de acciones.

---

## 5. Lo implementado, en detalle

### 5.1 Import de ficha/matriz (xlsx o CSV) — “Matriz”

Reconoce el formato real de la **“Ficha de Configuración” del INS**:

- **Detecta la hoja principal** (la de más filas) en workbooks multi-hoja.
- **Mapea columnas por nombre**, con *candidate-priority* (prueba candidatos
  específicos antes que genéricos) y tolerante a acentos:
  | Col | Header | Uso |
  |---|---|---|
  | A | `Pasos Formulario` | `section.title` |
  | B | `Sección` | `subsection.title` |
  | D | `Nombre del campo en formulario` | label / agrupador de opciones |
  | E | `Tipo de dato` | `field.type` |
  | F | `Valor` | valor de la opción → `jsonValue` |
  | G | `Regla` | condiciones |
  | H | `Obligatorio` | `required` |
  | J | `Visualización en Formularios` | `readOnly` / `hidden` |
  | M | `Nombre del campo en el JSON` | `salidaJSON` (+ secundaria) |
  | N | `Nombre del campo en el PDF` | `sourceName` |
- **Forward-fill** de sección/subsección (celdas combinadas).
- **Agrupación de opciones**: filas **consecutivas con el mismo label (col D)** = una
  pregunta con varias opciones → se modela **desdoblada**: un `radio` por opción,
  compartiendo `radioGroupLabel`, con `radioGroupFields` cruzados y `jsonValue` = col F.
- **Reglas col G**: patrón dominante `"se despliegan los campos: A / B"` = regla
  **invertida** (esta fila es el disparador, lista los targets). Los targets reciben
  `conditionalVisibility` `not_empty` apuntando a **esa opción concreta**, combinadas
  con `or` si varias opciones revelan el mismo campo. El matching de targets es
  **insensible a acentos y puntuación** (`Quienes` matchea `¿Quiénes?`).
- **Dos destinos en col M**: si la celda trae `"codigoX, descripcionX"` se parte en
  `salidaJSON` (primario) + `salidaJSONSecundaria`, como el golden. Nunca se emite un
  path con coma.
- **Dos modos** al importar:
  - **Etapa 1 · Armar ordenado** (default): construye el árbol con los campos ya
    ubicados; muestra preview (“N secciones · M preguntas de opciones · K condiciones”).
  - **Solo al pool**: carga los campos al pool + crea las secciones/subsecciones
    vacías, para arrastrar a mano.

### 5.2 Explorador de matriz (entenderla antes de armar)

Botón **“Explorar en detalle”** dentro del import. Vista read-only:
- **Árbol compartimentado**: Sección → Subsección → **Pregunta** con sus **opciones
  anidadas** (no filas sueltas). Ej.: “Seleccione la moneda de la póliza” con badge
  “2 opciones” y `↳ Colones` / `↳ Dólares`.
- **Duplicados**: marca `×N` (por `sourceName` real; labels repetidos = opciones, no dup).
- **Chips de lógica** por fila: `↳ muestra: A · B` (lo que despliega) y `👁 si …`.
- **Simulador Sí/No**: elegís respuestas y ves qué campos se muestran/ocultan
  (“se ven X de Y campos”).
- Filas con `data-entry` / `data-visible` (hooks estables de test).

### 5.3 Pool y Canvas (armado manual)

- **Pool**: campos sin ubicar, con buscador, **selección múltiple → “Agrupar”** en una
  subsección nueva, y etiqueta `→ Sección / Subsección` **sugerida** por la matriz.
- **Canvas**: crear secciones/subsecciones, **drag & drop** (pool→subsección y entre
  subsecciones, reordenar), colapsar, ocultar, reordenar secciones.
- **Los radios desdoblados se muestran agrupados**: bloque colapsable con el título de
  la pregunta, badge “N opciones” y cobertura `x/N PDF`, con las opciones anidadas.
- Cada campo condicionado muestra un chip **“👁 si «disparador»”** (resuelve el id del
  trigger a su label). Los NEVER muestran “oculto”.

### 5.4 Inspector

Edita tipo, label, ancho, `required`, `readOnly`, `hidden`, `excludeFromJson`,
`salidaJSON`, **`salidaJSONSecundaria`**, `checkedPdfValue`, formatos
(`jsonNumberFormat`, `jsonDateFormat`), `defaultValue`, **opciones**, y editores
visuales de **`conditionalVisibility` / `conditionalRequired`** (dropdown de campo +
operador + valor, con opción “siempre oculto” = NEVER).
En campos con `sourceMeta`, **`id` y `sourceMeta` son solo lectura (candado)**.

### 5.5 Etapa 2 — PDF y binding (“Campos PDF”, “PDF”, “Unir”)

- **“Campos PDF”** importa **el JSON main de Signframe** (el auto-mapeado del PDF) o,
  como fallback, un xlsx/CSV de nombres de AcroForms.
  - Del JSON main extrae, por cada campo con `sourceMeta`: `sourceName`, **`id`
    autoritativo**, `type`, `page` y el **`sourceMeta` completo**.
  - **Preserva `_sourcePdf`** (`fileName`, `pageCount`, `fieldPositions`) en el proyecto
    → se emite en el export (es el ground truth del validador).
- **“PDF”** adjunta el PDF y lo muestra embebido como referencia.
- **“Unir”** (workspace, modal ancho): PDF a la izquierda, tabla de vinculación a la
  derecha. Por cada campo sin vincular: **sugerencias automáticas** por similitud
  (label / cola del path, con % de match) + input con datalist. Al vincular:
  - copia el **`sourceMeta` VERBATIM** del json main (con `rect`, `fontSize`…),
  - adopta el **`id` real**,
  - **reescribe todas las referencias** al id viejo (`conditionalVisibility`,
    `conditionalRequired`, `radioGroupFields`, `autoFillConcat.sourceFieldIds`),
  - `checkedPdfValue: true` si es checkbox,
  - rechaza el bind si generaría un id duplicado.
  Contadores de cobertura (vinculados / sin vincular / AcroForms sin usar) y desvincular.

### 5.6 Validaciones en vivo (badge en la barra)

1. Todos los `sourceName` usados existen en el CSV cargado.
2. `id == "field_"+sourceName` en todo campo con `sourceMeta`.
3. Sin `id` duplicados en el árbol.
4. Cobertura: ubicados vs. pendientes en el pool.
5. `order > 0` en todos.
6. Checkboxes del PDF con `checkedPdfValue: true`.
7. `conditionalVisibility`/`conditionalRequired` parsean y referencian ids existentes.

Cada ítem que falla es **clickeable** y selecciona el campo.

### 5.7 Exportar (menú **Exportar ▾**)

- **JSON** — form-definition Signframe: reasigna `order` 1..n, reconstruye
  `childrenOrder`, sincroniza `salidaJSON`/`jsonOutputPath`, **preserva `_sourcePdf`**.
  Avisa (no bloquea) si hay validaciones en rojo.
- **CSV** y **xlsx** — la **matriz plana enriquecida**: una fila por campo/opción con
  las **mismas columnas que la app sabe importar** → **round-trip** (editás en Excel y
  reimportás). Verificado que al reimportar se re-agrupan las preguntas desdobladas y
  se conserva el binding de `sourceName`.
- **Proyecto** (.json) para guardar/cargar todo el estado, e **Importar JSON** de un
  form-definition existente (preserva `_sourcePdf`, ids y `sourceMeta`).

---

## 6. Estado verificado (evidencia)

Con la ficha real `Book1_MAPEADO_v1.xlsx` (403 filas, formato INS):
- Auto-detectó **las 10 columnas** sin configuración.
- Produjo: **8 secciones, 19 subsecciones, 396 campos, 38 radios desdoblados,
  13 condiciones, 330 con `sourceMeta` / 66 UI** — idéntico al output que ya tenía el
  usuario.
- **Validador de la skill `signframe-form-def`: 10 OK, 0 ERROR**, 1 WARN
  (solo “no hay `_sourcePdf` embebido”, que desaparece al importar el json main).

Comparación de **forma** contra un form-def golden (5919 Seguro Médico Colectivo):
- Keys de **sección y subsección: idénticas**.
- El campo de la app es **superset** de las keys base del golden
  (`id, label, options, order, readOnly, required, sourceMeta, type`).
- Las keys extra del golden (`pdfValue`, `helpText`, `placeholder`, `maxLength`,
  config de firmas, `_revisar`…) son **opcionales/por-feature** → última milla.

**Parche aplicado al validador de la skill** (`scripts/validate.py`): el check
`id == field_+sourceName` ahora acepta las 4 variantes (exacto/lower × `[n]`/`_n`).
Antes marcaba **117 falsos positivos en el propio json main de Signframe**; ahora ese
archivo valida **0 ERROR / 0 WARN**.

---

## 7. Lo que NO hace la app (va con la skill `signframe-form-def`)

Medido contra el golden 5919 (802 campos):
- **`autoFillConcat`** (305 en el golden): notificación concatenada, fecha partida en
  substrings, fecha “hoy”, etc.
- **Repeaters** + `slotMappings` (8) y el **lookup de enfermedades** con `needles`
  entre comillas.
- **`excludeFromJson`** masivo (460) y los ~**499 campos ocultos** que pintan derivados.
- `jsonValueSecundario` con los pares código/descripción.

**Decisión acordada: enfoque híbrido.** La app deja el **esqueleto correcto**
(estructura + binding + condiciones + validación); la skill hace la última milla y la
app puede **re-importar** el resultado para revisión visual final.

---

## 8. Convenciones de trabajo con el usuario (Marcos)

- Español argentino informal, respuestas directas y accionables.
- Versionar incremental, nunca pisar. Trabajar siempre sobre el **último archivo** que
  pasa el usuario.
- Ante ambigüedad: preguntar con opciones cortas, no inventar.
- Todo cambio: `npm run build` limpio + verificación real (tests de librería con
  esbuild y/o navegador con Playwright) antes de commitear y pushear.

---

## 9. Próximos pasos abiertos

1. **`SKILL.md` / `CLAUDE.md`** para la última milla híbrida (tomar el esqueleto
   validado + la ficha y generar `autoFillConcat`, repeaters, enfermedades,
   `excludeFromJson`).
2. Seguir **cazando diferencias de forma** contra el golden (como fue el caso de
   `salidaJSONSecundaria`) para que el esqueleto salga cada vez más cerca del 5919.
3. Opcional: que el esqueleto salga **ya bindeado** al json main (con `_sourcePdf` y
   `sourceMeta` reales) en un solo paso → validador en **0/0**.
