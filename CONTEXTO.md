# CONTEXTO — `frombuilder`

Documento de traspaso. Lo que la app hace hoy, por qué, y con qué evidencia.

---

## 1. Qué es

Una app local, sin backend, para preparar los **PDF AcroForm del INS Costa Rica** antes de
subirlos a Signframe. Lee el PDF, muestra sus campos con la geometría y el texto impreso
alrededor, deja editarlos, escribe el PDF renombrado y **exporta un paquete de campos
(xlsx)** que es el artefacto con el que se resuelve el mapeo afuera.

React 18 + Vite 5 + TypeScript + Tailwind 3. `pdf-lib` (dict crudo), `pdfjs-dist` (render y
texto), `xlsx`, `zustand`, `nanoid`, `lucide-react`. Todo en el navegador: ningún archivo
sale de la máquina.

---

## 2. El circuito (v3.0.0)

```
la app (frombuilder)     lo mecánico
                         leer el PDF · leer la ficha · editar campos ·
                         renombrar · exportar el paquete

afuera (una skill)       lo que necesita juicio
                         mapear ficha ↔ PDF · generar el form-def ·
                         la última milla

Signframe                subir el PDF renombrado -> bajar el JSON main
```

El paquete de campos va, se completa afuera, y vuelve: la app aplica los nombres y escribe
el PDF. **El PDF es el único input obligatorio**; la ficha del INS es opcional y sirve para
presembrar columnas del paquete.

**Por qué se recortó así.** De v1.0.0 a v1.4.5 la app intentó resolver el mapeo ficha↔PDF
con heurísticas: regiones geométricas, Needleman-Wunsch, anclas por etiqueta impresa,
elegibilidad, umbrales. Cada versión agregaba una regla de desempate y ganaba unos puntos,
y el techo quedó en ~70%. **No era un problema de calibración: la ficha y el PDF no
comparten ninguna clave.** La col N («Nombre interno del campo en PDF») era LA clave y el
INS la manda vacía —en el CSC las 14 celdas «llenas» dicen literalmente «No aplica»—.

Y hay decisiones que no salen de ningún score, solo de entender el formulario: un campo que
cubre «País y lugar de nacimiento» **y** «Nacionalidad»; la ficha que dice «Física» donde el
PDF imprime «Cédula»; un grupo de 8 opciones que el PDF parte 5/4; dos campos rotulados
«Detalle:» por región contra UNA fila de ficha.

Lo mecánico es determinístico y se puede congelar. Lo otro no. El motor de alineación, el
armador manual (pool + canvas + drag&drop) y las etapas 1 y 2 **se borraron en v3.0.0**;
están en el historial de git si algún día hacen falta.

---

## 3. REGLA DE ORO (no negociable)

El `sourceMeta` que devuelve Signframe es **ground truth**: se copia verbatim y no se toca.
Y el `id` de un campo del form-def es `"field_" + sourceName` en minúsculas, con `[n]` →
`_n`. Nunca camelCase. Eso lo aplica la skill, pero la app lo respeta en todo lo que
escribe: el nombre que se le pone a un campo del PDF es el que va a terminar en ese `id`,
así que **acento, espacio o punto en un nombre es un error que se arrastra hasta el final**.

---

## 4. Arquitectura

```
src/
  lib/etapa0/
    pdfFields.ts        lectura CRUDA del AcroForm
    textoPdf.ts         texto impreso: etiquetas y zona (pdfjs)
    fichaRaw.ts         lectura multi-hoja de la ficha del INS
    validaciones.ts     las reglas de formato de las cols K y G
    camposManuales.ts   crear, borrar y trocear campos
    rects.ts            mover y redimensionar la caja de un campo
    paquete.ts          el paquete de campos: ida y vuelta
    importarNombres.ts  aplicar los nombres que resolvió la skill
    writePdf.ts         escritura del PDF renombrado
    writePdfImpreso.ts  copia visual con los nombres dibujados
    slug.ts             nombre de archivo
  components/etapa0/    la pantalla: tabla + preview + paneles
  store/store.ts        proyecto y decisiones de Etapa 0
  types.ts              `Project` y `Etapa0State`
tools/
  gen-ficha-sintetica.ts  fabrica el fixture de ficha (sin datos del cliente)
tests/                  8 suites, 235 asserts
tests/fixtures/         fixture SINTÉTICO, commiteado
fixtures/               material del cliente, gitignoreado
```

Una sola pantalla, dos paneles: **izquierda** la tabla de campos (`#` · nombre actual · → ·
nombre nuevo · tipo · origen · dividir/borrar, con buscador, filtros y bulk edit);
**derecha** el preview del PDF con el overlay, el modo dibujo y los tiradores para mover y
redimensionar. Click bidireccional tabla↔overlay.

---

## 5. Lo implementado, en detalle

### 5.1 Detección (`pdfFields.ts`)

Walk **crudo** del `/AcroForm` (no la API de alto nivel de pdf-lib, que indexa por nombre y
se rompe con los campos jerárquicos del INS). Orden de lectura `(page, −Y, X)`. Un nodo con
kids sin `/T` es **un** campo con N widgets, no N campos. Marca `multiWidgetSospechoso`: un
`/Btn` multi-widget es normal (grupo de radios), un `/Tx` no —suele ser una colisión real
del PDF, dos campos distintos que comparten nombre— y si no se parte antes de subir,
Signframe los colapsa en un solo `sourceMeta` y el dato se pierde.

### 5.2 Texto impreso (`textoPdf.ts`)

Es lo que sobrevive del módulo grande de regiones: leer el texto con pdfjs, encontrar el
rótulo pegado a un widget (izquierda para `/Tx`, derecha para `/Btn` —mirar los dos lados
genera cruces—) y derivar los sufijos de un campo troceado por su formato de fecha
(`dd/mm/aaaa` → `_dia/_mes/_ano`). Un texto de solo guiones no es una etiqueta: es el
placeholder de la línea a completar.

### 5.3 Ficha (`fichaRaw.ts`)

Lector multi-hoja: aplana las 13 hojas, detecta el header de 14 columnas y las **4
exclusiones**, con `motivo` por fila y reconciliación auditable. Un marcador `NO APLICA`
real cumple **3 condiciones** (`NO APLICA` + (`HOJA`|`SECCION`) + `FORMULARIO`); nunca se
escanean las cols J ni N, que usan «No aplica» como enum. Las **filas-nota** (col C con
prosa en vez de un nombre de campo) se detectan por señal **estructural** —sin label, sin
tipo, sin ruta— y no por largo del texto: en el CSC las preguntas PEP tienen 16-23 palabras
y son campos reales, mientras «Dentro de datosFormulario» tiene 3 y es nota.

Desde v3.0.0 su salida alimenta las **columnas del paquete**, no un árbol de formulario.

### 5.4 Edición de campos

- **Crear**: se dibuja el rect sobre el preview y se elige tipo (`/Tx` `/Btn` `/Sig`). En el
  CSC las cuatro firmas son líneas **dibujadas**: 115 widgets y cero `/Sig`.
- **Borrar**: detectados incluidos, con confirmación y reversible.
- **Trocear en N** y **reemplazar por N cajas**: el caso de la fecha del CSC, que el
  asegurado resuelve con UNA caja de 88pt y el representante con TRES.
- **Mover y redimensionar** (`rects.ts`), arrastrando o escribiendo x/y/w/h.
- **Nombre y tipo** por campo, **bulk edit** (prefijo, sufijo, buscar-reemplazar) y
  colisiones en vivo.

Dos claves a propósito en `rects.ts`: en la UI el override se indexa por
`claveEstable#índiceDeWidget` sobre la lista ORIGINAL; para **escribir** se traduce a
`{rect original → rect nuevo}` y se empareja **por el rect**, porque `readPdfFields` ordena
los widgets por orden de lectura y `writePdf` los recorre en el orden de `/Kids` —con un
índice se movería el widget equivocado, en silencio y en el entregable—.

La identidad de un campo creado es un **`uid` propio que no depende de su nombre**: si fuera
el nombre, borrar «X» y crear otro «X» reengancharía la edición al campo equivocado.

### 5.5 Escritura (`writePdf.ts`)

Sobre el dict crudo: aplana `/AcroForm/Fields` (Signframe necesita nombres planos), **baja
los heredables** (`FT`, `Ff`, `DA`, `Q`, `MaxLen`, `Opt`) antes de desenganchar el
`/Parent`, limpia `/V` `/DV` `/TU` `/TM` `/RV`, pone `/AS /Off` en los `/Btn`, topea el
tamaño de fuente del `/DA`, setea `/NeedAppearances`, agrega los creados con `/F 4` (y
`SigFlags 3` si hay alguna firma), saca los borrados del `/Annots` de su página y aplica los
rects editados. Al final **relee el PDF escrito** y exige `detectados − borrados + creados`
nombres únicos.

Los renombrados circulares (A→B y B→A) **no necesitan nombre intermedio**: el renombre se
aplica sobre la identidad del objeto, no sobre una tabla por nombre.

### 5.6 Las tres descargas

1. **PDF renombrado** — el que se sube a Signframe.
2. **PDF con nombres impresos** — copia visual con el nombre de cada campo dibujado encima
   en 5pt, con el `#` del paquete adelante. Para revisar en papel o mandárselo al cliente.
   **No se sube**, y el botón lo dice. Se genera encadenado al renombrado (se escribe, se
   relee y se rotula), así lo impreso es exactamente lo que va a estar en los campos. Acá sí
   se usa la API de dibujo de pdf-lib —la regla es no usarla para CAMPOS— y se guarda con
   `updateFieldAppearances: false` para no deshacer el `/NeedAppearances`.
3. **Paquete de campos (xlsx)** — §5.7.

### 5.7 El paquete de campos = la matriz

El artefacto central. Una fila por **widget**, en orden de lectura. Un campo con dos widgets
aparece en dos filas con el mismo `#` y el mismo `nombre_actual`: eso es justamente lo que
hay que ver, un nombre pintando en dos lugares.

Columnas que **escribe la app**:

```
# · nombre_actual · nombre_nuevo · tipo · pagina · x · y · w · h
etiqueta_impresa · etiquetas_candidatas · texto_zona · multi_widget · origen · notas
```

Columnas que se **completan afuera** y la app no toca:

```
seccion · subseccion · label · ruta_json · required · validaciones · grupo · valor · instancia
```

**El archivo puede dar vueltas sin perder información**: al reimportar se lee `nombre_nuevo`
y todo lo demás se conserva —incluidas columnas que la app no conoce—, y al reexportar se
vuelve a escribir tal cual. Es la única memoria del mapeo.

Las columnas valiosas no son las del AcroForm sino las del texto: con `etiqueta_impresa`,
`etiquetas_candidatas` y `texto_zona`, quien lee el paquete resuelve el mapeo con eso, la
ficha y el PDF impreso, **sin abrir la app**.

**Presembrado** (opcional): si se cargó la ficha, se copian `ruta_json` (col M), `required`
(col H) y `validaciones` (cols K y G) a las columnas de afuera. Es una **sugerencia** —queda
anotada en `notas`— y **no pisa** nada que haya vuelto de la skill: quien resolvió el mapeo
con el formulario a la vista sabe más que la ficha.

Las validaciones se leen de las cols **K y G**, porque en la ficha real conviven las dos
formas: «50 caracteres alfanumericos» en K y «Alfanumérico (50)» en G. Y lo que no se
entiende **no se inventa**: queda sin reconocer, con el texto crudo. Un `maxLength`
inventado corta datos del cliente en producción.

### 5.8 Reimportar (`importarNombres.ts`)

**Nada se aplica a medias**: si el resultado tendría nombres repetidos —incluido el choque
contra un campo que el archivo no menciona— se reporta y no se toca nada. **No se pisa** lo
editado a mano sin confirmación explícita (hay un botón aparte para eso). Un campo con
varios widgets es UN campo y lleva UN nombre: si el paquete trae dos distintos, se avisa.

La vía «col N de la ficha» existió en v2.0.0 y se fue con el recorte. Además del motor que
necesitaba, tenía un límite de fondo: **la col N no puede expresar el renombrado** de un
formulario con bloque repetible —una fila se corresponde con 3 campos que necesitan 3
nombres distintos y la ficha tiene una sola celda—. El paquete sí, porque tiene una fila por
widget.

---

## 6. Estado verificado (evidencia)

Sobre el **CSC** (`BUC_Formulario_Conozca_Cliente_Homologado.pdf`, 111 campos / 115 widgets,
2 páginas):

- **Detección**: 111 campos, 115 widgets, 4 `/Tx` multi-widget marcados, cero `/Sig`.
- **Paquete**: 115 filas para 115 widgets · **113 con etiqueta impresa** · 114 con texto de
  zona · 1 solo widget sin nada alrededor. (La alineación de v1.4.3 anclaba 67, porque
  anclar exigía además matchear una fila de la ficha.)
- **PDF impreso**: 115 de 115 widgets rotulados, +11KB, y los nombres se extraen como texto.
- **Circuito completo**: crear un `/Sig`, borrar un detectado, trocear otro en 3, mover una
  caja, bajar el paquete, completarlo afuera (nombres + `ruta_json` + `seccion` + una columna
  inventada), reimportarlo y reexportarlo → **118 filas conservan las columnas de afuera**,
  incluida la que la app no conoce.
- **PDF renombrado, releído**: **114 campos, 114 nombres únicos, 0 duplicados, 0 sin
  renombrar, 0 con acento/espacio/punto, 0 con `/V`**, el `/Sig` creado presente y el campo
  borrado ausente.
- **Suite**: 8 suites, **235 asserts**, 0 SKIP local. `npm run build` limpio.

El **fixture de ficha** (`tests/fixtures/ficha-sintetica-col-n.xlsx`) es **sintético y
commiteado**: tiene la misma forma que la del INS —hojas de nodo, índice «Estructura base
JSON», bloque repetible con 3 códigos, col N con varios nombres por celda, filas-nota, hoja
y bloque `NO APLICA`— y ningún dato del cliente. Se regenera con `npm run fixture:ficha`.
La ficha real y los PDF viven en `fixtures/`, que está **gitignoreada**: el pipeline de
80-100 formularios no puede terminar con documentos del cliente adentro del repo.

---

## 7. Lo que NO hace la app

Todo lo que necesita juicio, y a propósito:

- **mapear ficha ↔ PDF**: se resuelve afuera, sobre el paquete;
- **generar el form-definition** (secciones, tipos, anchos, opciones, condicionales);
- **la última milla**: `autoFillConcat`, repeaters con `slotMappings`, `excludeFromJson`
  masivo, `jsonValueSecundario`, campos ocultos que pintan derivados;
- **validar el form-def**. El validador que tenía la app era el único control del circuito
  —Signframe guarda el JSON sin validar nada— y ese control **pasó a la skill**. Con él se
  fueron los diagnósticos del panel de JSON (ruta contenedora, rutas duplicadas, cobertura
  del contrato). **No reimplementarlos acá.**

---

## 8. Convenciones de trabajo

- **Plan corto y OK antes de tocar código.** Una fase por vez.
- ❌ No hardcodear nada de un formulario puntual: los fixtures son fixtures, y vienen 80-100
  formularios más.
- ❌ No usar la API de alto nivel de `pdf-lib` para campos.
- ❌ No desambiguar colisiones con contador ciego. El sufijo `_1.._n` de un troceado es
  estructural y editable, no desambiguación.
- ❌ No inventar lo que no se entiende: se reporta con el texto crudo.
- ❌ No agregar dependencias sin avisar.
- ✅ `npm run build` limpio + verificación real (y relectura del PDF escrito) antes de
  commitear.
- ✅ `fixtures/` gitignoreada; los tests que la necesitan se saltean si no está.

---

## 9. Próximos pasos abiertos

- Verificar el circuito con el formulario **1000484** (202 campos, 4 páginas) cuando estén
  su PDF y su ficha. Hoy la evidencia es el CSC.
- El `form-definition-test__2_.json` de Signframe para el CSC: serviría para confirmar el
  `sourceMeta` verbatim contra un main real.
- Sacar del `package.json` lo que quedó sin uso tras el recorte, si aparece algo (las tres
  `@dnd-kit` ya salieron).
