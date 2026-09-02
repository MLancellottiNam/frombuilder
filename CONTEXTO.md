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

### 5.8 Etapa 0 — Renombrado asistido (v1.0.0 → v1.5.0, + v1.4.1, v1.4.2 y v1.4.3)

La ficha cruda del INS viene con la **col N vacía** y los AcroNames del PDF **mienten**
(en el CSC `Profesión` es en realidad el Detalle del domicilio extranjero). Etapa 0 toma
la **ficha cruda + el PDF crudo** y devuelve el **PDF renombrado** y la **ficha con la col N
completada**, para que el bind de Etapa 2 sea 1:1 exacto.

Módulos (`src/lib/etapa0/`):

| archivo | qué hace |
|---|---|
| `fichaRaw.ts` | aplana las 13 hojas, detecta el header de 14 columnas y las **4 exclusiones**, más las **filas-nota** (col C con prosa descriptiva en vez de un nombre de campo). La señal de fila-nota es **estructural** —sin label (D), sin tipo (E), sin path JSON (M)— y se puntúa: el largo del texto es una señal débil a propósito, porque en el CSC las preguntas PEP tienen 16-23 palabras y son campos reales mientras «Dentro de datosFormulario» tiene 3 y es nota. Un marcador `NO APLICA` real cumple **3 condiciones** (`NO APLICA` + (`HOJA`\|`SECCION`) + `FORMULARIO`); nunca se escanean J ni N (usan “No aplica” como enum) y el marcador de bloque solo vale en col G. Precedencia: **contrato JSON primero** (`A === 'JSON'`), después hoja, bloque, sin-campo-pdf. Cada fila lleva `motivo` y `hojaAplica`. |
| `pdfFields.ts` | walk **crudo** del AcroForm (no la API de alto nivel de pdf-lib). Orden de lectura `(page, -Y, X)`. Un nodo con kids sin `/T` es **un** campo con N widgets. Marca `multiWidgetSospechoso` (`/Tx` con >1 widget = colisión del PDF original). |
| `acroName.ts` | instancias del bloque repetible (ASG/PJR/RPL, expansión **instancia-mayor**) y el nombre propuesto `prefijo + slug(C) + [slug(F)]`. El bloque repetible incluye sus **hojas hijas** según el índice (`datosFormulario.personas.direccion` es hija de `personas`, o sea el PDF la repite por instancia). Los grupos de opciones se detectan por **nombre base consecutivo** —la misma clave con la que se genera el nombre—, no por col D. Las colisiones **se marcan, no se desambiguan con contador ciego**. |
| `align.ts` | Needleman-Wunsch con huecos tolerados. La señal confiable es la **posición**; el texto del AcroName solo **suma** (`BOOST_TEXTO`), nunca resta. El 1:N (fecha partida en día/mes/año) se modela **dentro del DP**, no en un post-paso. `alinearPorSegmentos` corre ese mismo algoritmo **por región** y nunca cruza el límite: una fila sin campo en su región queda huérfana en vez de robarle el campo a otra instancia. |
| `regiones.ts` (corridas) | **1:N de fechas** (v1.4.3 B0.2): una fila de tipo fecha se pinta a veces en varias cajas angostas y contiguas (día/mes/año). El DP ya lo modelaba pero nunca llegaba a evaluarlo: la fila se ancla a la primera caja por su etiqueta impresa y las anclas son 1:1, así que el arreglo es un **post-paso sobre las anclas**. El sufijo sale del formato de la col F (`dd/mm/aaaa` → `_dia/_mes/_ano`) y si no se puede derivar queda `_1.._n`; es editable. Un 1:N nunca queda en `alta`: el reparto por caja lo confirma una persona. Ojo: un texto de solo guiones bajos (`_____ / _____`) **no** es etiqueta — tomarlo por rótulo cortaba la corrida. |
| `regiones.ts` (elegibilidad) | **Filtro de filas por región** (v1.4.3 A): una fila del bloque repetible solo se le ofrece a una instancia si su clave aparece **impresa** dentro de la región de esa instancia (col F si es opción y el valor sirve; col C si no). Acotar la geometría no alcanzaba: limita dónde puede caer una fila, no impide que el DP la meta en un hueco de esa región. Medido en el CSC: 32 filas quedan exclusivas de una región y los subsets salen **40/37/22** contra los ~44/40/25 esperados, sin ninguna grilla manual. Las filas que no aparecen en NINGUNA región quedan elegibles en todas: es el hueco de vocabulario (la ficha dice «Física», el PDF imprime «Cédula») y perder campos por eso sería peor. La cobertura parcial del match se usa solo para claves de 5 tokens o más, las que pdfjs parte en fragmentos. |
| `regiones.ts` | **Anclas por texto** (Fix C): el PDF trae la etiqueta impresa al lado de cada campo y la col C de la ficha *es* esa etiqueta (col F para las opciones de un grupo). Los pares inequívocos quedan fijos y el DP alinea solo el resto; NO se exige monotonía, porque el desorden ficha↔PDF dentro del bloque es real y pedirla descarta justo las anclas que lo arreglan. Una opción cuyo grupo tiene anclas en la región pero que no aparece en ninguna etiqueta es **foránea**: vive en otra región y no se fuerza (así se reparten 5 física / 4 jurídica). También expone `evidenciaEnContra`: cuando la etiqueta impresa identifica a otra fila, o cuando una casilla cae en la banda de un grupo al que la fila no pertenece, el par se degrada a `revisar`. Los tramos libres se parten en **zonas contiguas** (`construirSegmentos`): juntos, "Lugar" y "Fecha" se iban a los campos de la firma del pie de la página 2. |
| `regiones.ts` (regiones) | Cada instancia ocupa una **región** del PDF (rango contiguo del orden de lectura). Se siembra en dos pasos: (1) los **grupos de opciones** del bloque repetible se buscan en el texto del PDF y un grupo que aparece tantas veces como instancias ancla la banda *k* a la instancia *k*; (2) el borde exacto sale del **mayor salto vertical** entre campos consecutivos de la zona ambigua (en el CSC 27pt contra 20-21pt internos: cae en y=339). El cambio de página es un salto infinito. La siembra es orientativa: el usuario corrige `desdeLeaf`/`hastaLeaf` con dos selects por instancia y las regiones se pintan como bandas de color en el preview. |
| `writePdf.ts` | escribe el PDF renombrado sobre el dict crudo: aplana `/AcroForm/Fields` (Signframe necesita nombres planos), baja los heredables (`FT`, `Ff`, `DA`, `Q`, `MaxLen`, `Opt`) antes de desenganchar el `/Parent`, limpia `/V` `/DV` `/TU` `/TM` `/RV`, pone `/AS /Off` en los `/Btn`, topea el tamaño de fuente del `/DA` (default 10pt) y setea `/NeedAppearances`. **Los renombrados circulares no necesitan nombre intermedio**: el renombre se aplica sobre la identidad del objeto, no sobre una tabla por nombre. |
| `writeFicha.ts` | reescribe el mismo `.xlsx` completando **solo la col N** de las filas que van al PDF (solo-JSON y excluidas quedan vacías). Además `detectarAvisosColM`: erratas de tipeo **genéricas** (grafía inconsistente, no-ASCII, mayúscula inicial, espacios, punto doble) — **se reportan, no se corrigen**. |
| `reporte.ts` | CSV con asignados, huérfanos de los dos lados, colisiones, avisos de col M y la nota de ausencia de `/Sig`. |

UI (`src/components/etapa0/`), reorganizada en **v1.4.2** para mostrar el resultado y no
el razonamiento del motor:

- `Etapa0Screen` arranca con un **resumen de tres líneas** (campos resueltos · necesitan
  revisión · colisiones) más los tres botones de descarga. Nada más. Las colisiones y las
  regiones sin sembrar suben al resumen como advertencia accionable, porque ahí sí hay que
  intervenir.
- **`Ver detalle`** (colapsado, y recuerda su estado en el proyecto) contiene todo el
  diagnóstico sin perder nada: stats, tabla de la ficha, tabla de los 111 campos con su
  bulk edit, instancias, regiones y sus avisos, filas sin campo y avisos de col M.
- `ModoRevision` recorre de a uno **solo** los campos que necesitan atención
  (media/revisar/sin asignar) con los mismos controles de la tabla, y el preview hace zoom
  para que se lea la etiqueta impresa alrededor del campo. `Confirmar` saca el campo de la
  lista (es estado de UI, no re-clasifica nada); `Saltar` avanza sin marcar.
- El **hand-off** aparece recién al descargar el PDF renombrado, con los pasos que siguen.
- `TablaCampos` (tabla editable centrada en el campo del PDF, con bulk edit y colisiones en
  rojo) y `PdfPreview` (render con `pdfjs-dist` + overlay clickeable, azul=alta,
  ámbar=media/revisar, rojo=colisión, gris=sin asignar, bandas de región de fondo).

Sobre el conteo de filas sin campo: la alineación corre **solo** sobre las filas
clasificadas como `pdf`, así que ninguna `solo-json` ni `excluida` entra nunca. De las 71
que quedaban sin campo en el CSC, **70 son filas del bloque repetible que no aplican a su
instancia** —el subset por geometría funcionando— y **1** es huérfana de verdad. Se muestran
separadas: llamarlas todas «huérfanas» asustaba sin motivo.

El hand-off es un checklist de 4 pasos y **“Continuar a Etapa 1” queda deshabilitado hasta
descargar el PDF renombrado**: si el PDF entra a Signframe antes del renombrado, el
`sourceMeta` queda clavado a los nombres genéricos. El estado de Etapa 0 (instancias,
ediciones, tope de fuente, descargas hechas) se guarda dentro del **proyecto .json**; los
archivos no viajan.

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

0. **Etapa 0, huecos de vocabulario ficha↔PDF.** Quedan ~28 pares en `revisar` sobre el
   CSC, y buena parte arranca de que la ficha y el PDF nombran la misma cosa distinto:
   la ficha dice «Física» donde el PDF imprime «Cédula», así que esa casilla no se puede
   anclar por texto y arrastra a las vecinas. Un diccionario de sinónimos editable por
   formulario (o por producto) los cerraría sin tocar el algoritmo.
1. **`SKILL.md` / `CLAUDE.md`** para la última milla híbrida (tomar el esqueleto
   validado + la ficha y generar `autoFillConcat`, repeaters, enfermedades,
   `excludeFromJson`).
2. Seguir **cazando diferencias de forma** contra el golden (como fue el caso de
   `salidaJSONSecundaria`) para que el esqueleto salga cada vez más cerca del 5919.
3. Opcional: que el esqueleto salga **ya bindeado** al json main (con `_sourcePdf` y
   `sourceMeta` reales) en un solo paso → validador en **0/0**.
