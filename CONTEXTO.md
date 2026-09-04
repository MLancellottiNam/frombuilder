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

### 5.8 Etapa 0 — Detector y editor de campos del PDF (v2.0.0)

**El cambio de foco (v2.0.0).** De v1.0.0 a v1.4.5 Etapa 0 intentó resolver el mapeo
ficha↔PDF con heurísticas: regiones geométricas, Needleman-Wunsch, anclas por etiqueta
impresa, elegibilidad por región, umbrales de tokens. Cada versión agregaba una regla de
desempate más fina y ganaba unos puntos. **El techo no era de calibración, era de
naturaleza del problema: la ficha y el PDF no comparten ninguna clave.** La col N
(«Nombre interno del campo en PDF») era LA clave y el INS la manda vacía —en el CSC las
14 celdas «llenas» dicen literalmente «No aplica»—. Todo lo demás es reconstrucción.

Y hay decisiones que no salen de ningún score, solo de entender el formulario:
`asg_nacionalidad` cubre «País y lugar de nacimiento» **y** «Nacionalidad»; la ficha dice
«Física» donde el PDF imprime «Cédula»; un grupo de 8 opciones que el PDF parte 5/4; dos
campos rotulados «Detalle:» por región contra UNA fila de ficha.

**Así que la app dejó de adivinar.** Se queda con lo que una máquina hace mejor que una
persona —leer el AcroForm, medir geometría, extraer el texto impreso, escribir el PDF— y
el mapeo se resuelve afuera, con juicio, sobre un paquete que la app exporta:

```
1. la app     detecta campos · geometría · etiquetas impresas
              agregar / borrar / renombrar / mover / trocear a mano
              -> EXPORTA el paquete de campos (xlsx) + el PDF
2. afuera     se resuelve el mapeo leyendo formulario + ficha + paquete
              -> devuelve los nombres
3. la app     IMPORTA esos nombres -> escribe el PDF renombrado
4. Signframe  subir el renombrado -> bajar el JSON main
5. Etapa 1/2  esqueleto desde la ficha + bind 1:1 por sourceName
```

**El PDF es el único input obligatorio.** La ficha pasó a ser opcional y entra solo para
importar nombres.

Módulos vivos (`src/lib/etapa0/`):

| archivo | qué hace |
|---|---|
| `pdfFields.ts` | walk **crudo** del AcroForm (no la API de alto nivel de pdf-lib). Orden de lectura `(page, -Y, X)`. Un nodo con kids sin `/T` es **un** campo con N widgets. Marca `multiWidgetSospechoso` (`/Tx` con >1 widget = colisión del PDF original). |
| `paquete.ts` | **el paquete de campos**: una fila por WIDGET en orden de lectura, con `nombre_actual`, `nombre_nuevo`, tipo, página, rect, `etiqueta_impresa`, `etiquetas_candidatas`, `texto_zona`, `multi_widget`, `origen` y `notas`. Un campo con dos widgets da dos filas con el mismo `#` y el mismo `nombre_actual`: eso es justo lo que hay que ver. Tiene que ser **autosuficiente** — quien lo lee resuelve el mapeo con eso, la ficha y el PDF impreso, sin abrir la app. |
| `importarNombres.ts` | cierra el circuito. Dos vehículos: el **paquete** con `nombre_nuevo` (directo y sin ambigüedad) y la **ficha** con la col N (matchea contra `nombre_actual` y aplica el nombre canónico de la fila, con sufijos 1:N del formato de la col F). **Nada se aplica a medias**: si algún nombre quedaría repetido se reporta y no se toca nada. **No pisa** lo editado a mano sin confirmación explícita. |
| `camposManuales.ts` | crear y borrar campos. `aplicarCambios` devuelve la lista **efectiva** (detectados − borrados + creados) reordenada por orden de lectura. `trocearRect` reparte un rect en N cajas parejas. La identidad de un creado es un **`uid` propio que no depende de su nombre**: si fuera el nombre, borrar «X» y crear otro «X» reengancharía la edición al campo equivocado. |
| `rects.ts` | **editar la geometría** (v2.0.0): mover y redimensionar, en detectados y creados. Dos claves a propósito: en la UI el override se indexa por `claveEstable#índiceDeWidget` sobre la lista ORIGINAL; para **escribir** se traduce a `{rect original -> rect nuevo}` y se empareja **por el rect**, porque `readPdfFields` ordena los widgets por orden de lectura y `writePdf` los recorre en el orden de `/Kids` —un índice movería el widget equivocado en silencio—. `aplicarRects` no reordena la lista de widgets (reordenarla haría que el próximo arrastre escribiera en la clave de otro) y arrastrar un borde no invierte la caja: topea en 4pt. |
| `writePdf.ts` | escribe el PDF renombrado sobre el dict crudo: aplana `/AcroForm/Fields` (Signframe necesita nombres planos), baja los heredables (`FT`, `Ff`, `DA`, `Q`, `MaxLen`, `Opt`) antes de desenganchar el `/Parent`, limpia `/V` `/DV` `/TU` `/TM` `/RV`, pone `/AS /Off` en los `/Btn`, topea el `/DA`, setea `/NeedAppearances`, aplica creados, borrados y rects. Relee el resultado y exige nombres únicos. **Los renombrados circulares no necesitan nombre intermedio**: el renombre se aplica sobre la identidad del objeto, no sobre una tabla por nombre. |
| `writePdfImpreso.ts` | el **PDF con los nombres impresos**: dibuja el borde de cada widget y su nombre en 5pt con el `#` del paquete adelante. Es una **copia visual para revisar sin la app** y NO se sube a Signframe. Acá sí se usa la API de dibujo de pdf-lib —la regla es no usarla para CAMPOS— y se guarda con `updateFieldAppearances:false` para no deshacer el `/NeedAppearances`. |
| `fichaRaw.ts` | sigue siendo el lector multi-hoja del xlsx del INS (13 hojas, header de 14 columnas, col N). Su clasificación de destino (filas-nota, exclusiones, `NO APLICA`, precedencia JSON-first) quedó **sin uso en el flujo**: se conserva por si el mapeo vuelve a la app y porque el import de la col N lo usa para ubicar las filas. |
| `regiones.ts` (lo que sobrevive) | `extraerTextoPdf` y `textItemDePdfjs` (texto impreso con pdfjs), `etiquetasDeLeaf` / `etiquetaPreferida` (rótulo de un widget: izquierda para `/Tx`, derecha para `/Btn`), `textoDeRegion` y `sufijosDeFormato`. Todo lo de regiones, bandas, anclas, elegibilidad, segmentos y evidencias quedó **dormido**. |

**Dormido, no borrado** (queda en el repo con todos sus tests, sin cablear desde la UI):
`align.ts` completo (DP, segmentos, confianza, 1:N, huérfanos), `acroName.ts` completo
(instancias, expansión, `generarNombres` —que el import de la col N sí usa para el nombre
canónico—, colisiones, grupos de opciones), la mitad grande de `regiones.ts`, `reporte.ts`,
`writeFicha.ts::escribirFichaConColN`, `ModoRevision.tsx` y la pantalla vieja en
`Etapa0ScreenV1.tsx.bak` (con extensión `.bak` justamente para que no la compile tsc: sus
props ya no existen). Si el enfoque nuevo se confirma, se limpia; los 480 asserts de
librería siguen cubriéndolo mientras tanto, así que no se podre en silencio.

UI (`src/components/etapa0/`): dos paneles.

- **Izquierda: la tabla de campos.** `#` · nombre actual · → · nombre nuevo (editable, con
  colisiones en vivo) · tipo · origen · ✕ / dividir / borrar. Buscador, **filtros**
  (`sin nombre` · `con colisión` · `creados` · `multi-widget`), **bulk edit** (prefijo,
  sufijo, buscar-reemplazar sobre la selección) y `Posiciones`.
- **`PanelCampo`** es la respuesta al click: el campo que se toca —en el PDF o en la
  tabla— se abre con la **etiqueta que el PDF tiene impresa al lado**, el **texto de su
  zona**, el nombre, el tipo y la **caja editable con números** (para alinear con la de al
  lado, escribir el valor es más preciso que el mouse). Seleccionar además **lleva** hasta
  el campo: la tabla scrollea su fila y el preview salta a su página y la centra.
- **Derecha: el preview.** Overlay por widget con el nombre final, leyenda de colores
  (azul = con nombre nuevo · gris = sin nombre · rojo = repetido · punteado = creado),
  `+ Agregar campo` (dibujar el rect) y, en el campo seleccionado, **8 tiradores** para
  mover y redimensionar. Click bidireccional tabla↔overlay.
- **Barra superior**: contadores (`N campos (M widgets) · K con nombre · C colisiones`),
  las **tres descargas** —`PDF renombrado` (el que se sube a Signframe), `PDF con nombres
  impresos` (para revisar, no se sube) y `Paquete de campos (xlsx)`— y `Cargar nombres`.
  Las tres descargas están disponibles **sin ficha**.

Dos detalles de scroll que costaron una vuelta: el salto a un campo de otra página no puede
hacerse en el mismo tick que el `setPage` —la caja todavía no existe—, así que va en un
efecto atado a las cajas ya renderizadas, y solo **una vez por (campo, página)** o la página
salta abajo del puntero mientras se arrastra; y traer una fila a la vista con
`scrollIntoView` arrastra también los contenedores de arriba, así que la tabla mueve **solo**
su propia caja calculando el delta a mano.

El aviso duro se queda: **el renombrado va siempre antes de subir el PDF a Signframe**; si
entra antes, el `sourceMeta` queda clavado a los nombres genéricos del AcroForm. El estado
de Etapa 0 (ediciones, creados, borrados, rects editados, tope de fuente, descargas hechas)
se guarda dentro del **proyecto .json**; los archivos no viajan.

**Medido sobre el CSC real (sin cargar la ficha):** 111 campos / 115 widgets detectados;
el paquete sale con **115 de 115 widgets con etiqueta impresa o candidatas** y 114 con
texto de zona (la alineación anclaba 67, porque anclar exigía además matchear una fila de
la ficha); el PDF impreso rotula **115 de 115** widgets y los nombres se extraen como
texto; el circuito completo —crear un `/Sig`, borrar un detectado, trocear otro en 3, mover
una caja, bajar el paquete, editarlo afuera, reimportarlo y escribir— deja **114 campos,
114 nombres únicos, 0 duplicados**, con el creado presente y el borrado ausente.

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
