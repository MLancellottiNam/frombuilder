// ---------------------------------------------------------------------------
// Generador del fixture de ficha SINTÉTICO (`tests/fixtures/`).
//
// POR QUÉ EXISTE. El motor de alineación se borró en v3.0.0, y con él el script
// que fabricaba la ficha-con-col-N a partir del CSC real. Los tests que necesitan
// una ficha con esa forma tienen que sobrevivir a ese borrado, así que el fixture
// se genera acá, con datos INVENTADOS.
//
// Y es sintético a propósito: la ficha del CSC con la col N llena se deriva de la
// ficha del INS y del PDF del cliente, o sea que ES material del cliente, y la
// regla del proyecto es que `fixtures/` está gitignoreada para que el pipeline de
// 80-100 formularios no termine con documentos del cliente adentro. Este archivo
// tiene la misma FORMA —10 hojas, header de 14 columnas, índice «Estructura base
// JSON», bloque repetible con 3 códigos, col N con varios nombres por celda,
// filas-nota, hoja y bloque marcados NO APLICA— y ningún dato real.
//
//   npx esbuild tools/gen-ficha-sintetica.ts --bundle --platform=node \
//     --format=cjs --outfile=.tmp/genficha.cjs && node .tmp/genficha.cjs
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const HEADER = [
  'Pasos formulario',
  'Sección',
  'Nombre en PDF',
  'Nombre del campo en formulario',
  'Tipo de dato',
  'Valor',
  'Regla',
  'Obligatorio',
  'Formulario a visualizar',
  'Visualización en formularios',
  'Observaciones',
  'Nombre de la seccion del JSON',
  'Nombre del campo en el JSON',
  'Nombre interno del campo en PDF',
];

/** Una fila de datos. `colN` puede traer varios nombres separados por coma. */
function fila(o: {
  paso?: string;
  seccion?: string;
  nombrePdf: string;
  label?: string;
  tipo?: string;
  valor?: string;
  regla?: string;
  obligatorio?: string;
  visualizacion?: string;
  observaciones?: string;
  seccionJson?: string;
  campoJson?: string;
  colN?: string;
}): string[] {
  return [
    o.paso ?? '',
    o.seccion ?? '',
    o.nombrePdf,
    o.label ?? o.nombrePdf,
    o.tipo ?? 'Texto',
    o.valor ?? '',
    o.regla ?? '',
    o.obligatorio ?? 'Both',
    '',
    o.visualizacion ?? '',
    o.observaciones ?? '',
    o.seccionJson ?? '',
    o.campoJson ?? '',
    o.colN ?? '',
  ];
}

const hojas: { nombre: string; aoa: (string | number)[][] }[] = [];

// --- índice «Estructura base JSON» ---------------------------------------
hojas.push({
  nombre: 'Estructura base JSON',
  aoa: [
    ['Nodo', 'Paso del formulario', 'Secciones'],
    ['sobre', 'No aplica', 'No aplica'],
    ['datos', '', ''],
    ['datos.generales', 'Datos Generales', 'Información de la solicitud'],
    ['datos.generales.asesor', 'Datos Generales', 'Datos del Asesor'],
    ['datos.personas', 'Datos de la persona', 'Datos / Contacto'],
    ['datos.personas.domicilio', 'Datos de la persona', 'Contacto'],
    ['datos.personas.notificacion', 'Datos de la persona', 'Preferencias'],
    ['datos.extras', 'Extras', 'Adicionales'],
    ['datos.noAplica', 'No aplica', 'No aplica'],
  ],
});

// --- hoja de contrato (paso «No aplica») ---------------------------------
hojas.push({
  nombre: 'sobre',
  aoa: [
    ['datos.sobre'],
    HEADER,
    fila({ paso: 'JSON', nombrePdf: 'Tipo de sobre', campoJson: 'sobre.tipo', obligatorio: 'JSON' }),
    fila({ paso: 'JSON', nombrePdf: 'Referencia', campoJson: 'sobre.referencia', obligatorio: 'JSON' }),
    fila({
      paso: 'JSON',
      nombrePdf: 'Correo de aviso',
      campoJson: 'sobre.correo',
      regla: 'Formato de correo',
      obligatorio: 'JSON',
    }),
  ],
});

// --- datos generales -----------------------------------------------------
hojas.push({
  nombre: 'generales',
  aoa: [
    ['datos.generales'],
    HEADER,
    fila({
      paso: 'Datos Generales',
      seccion: 'Información de la solicitud',
      nombrePdf: 'Número de solicitud',
      tipo: 'Numérico',
      regla: '8 dígitos',
      campoJson: 'datos.generales.numeroSolicitud',
      colN: 'numero_solicitud',
    }),
    fila({
      nombrePdf: 'Fecha de solicitud',
      tipo: 'Fecha',
      observaciones: 'Formato dd/mm/aaaa',
      campoJson: 'datos.generales.fechaSolicitud',
      colN: 'fecha_solicitud',
    }),
    // fila-nota: sin label, sin tipo, sin ruta, con prosa
    ['', '', 'Estos datos los completa el asesor antes de enviar la solicitud.', '', '', '', '', '', '', '', '', '', '', ''],
    fila({
      nombrePdf: 'Observaciones',
      tipo: 'Área de texto',
      observaciones: '150 caracteres alfanuméricos',
      campoJson: 'datos.generales.observaciones',
      colN: 'observaciones_generales',
      obligatorio: 'None',
    }),
  ],
});

hojas.push({
  nombre: 'asesor',
  aoa: [
    ['datos.generales.asesor'],
    HEADER,
    fila({
      paso: 'Datos Generales',
      seccion: 'Datos del Asesor',
      nombrePdf: 'Código de asesor',
      regla: 'Alfanumérico (15)',
      campoJson: 'datos.generales.asesor.codigo',
      colN: 'codigo_asesor',
    }),
    fila({
      nombrePdf: 'Nombre del asesor',
      observaciones: '50 caracteres alfanumericos',
      campoJson: 'datos.generales.asesor.nombre',
      colN: 'nombre_asesor',
    }),
  ],
});

// --- bloque repetible: 3 códigos, y la col N con un nombre por instancia --
hojas.push({
  nombre: 'personas',
  aoa: [
    ['datos.personas'],
    HEADER,
    // la fila que declara los códigos: es lo que hace instanciable al bloque
    fila({
      paso: 'Datos de la persona',
      seccion: 'Datos',
      nombrePdf: 'Código de tipo de persona',
      valor: 'TIT / CON / REP',
      campoJson: 'datos.personas.codigoTipo',
      obligatorio: 'JSON',
    }),
    fila({
      nombrePdf: 'Primer apellido',
      campoJson: 'datos.personas.primerApellido',
      colN: 'tit_primer_apellido, con_primer_apellido, rep_primer_apellido',
    }),
    fila({
      nombrePdf: 'Segundo apellido',
      campoJson: 'datos.personas.segundoApellido',
      colN: 'tit_segundo_apellido, con_segundo_apellido, rep_segundo_apellido',
    }),
    fila({
      nombrePdf: 'Nombre completo',
      campoJson: 'datos.personas.nombreCompleto',
      observaciones: 'Concatenar automatico',
      colN: 'tit_nombre_completo, con_nombre_completo, rep_nombre_completo',
    }),
    // 1:N: una fila que se pinta en tres cajas
    fila({
      nombrePdf: 'Fecha de nacimiento',
      tipo: 'Fecha',
      valor: 'dd/mm/aaaa',
      observaciones: 'Formato dd/mm/aaaa',
      campoJson: 'datos.personas.fechaNacimiento',
      colN: 'tit_fecha_nacimiento_dia, tit_fecha_nacimiento_mes, tit_fecha_nacimiento_ano',
    }),
    // grupo de opciones (misma col C, valores distintos)
    fila({
      nombrePdf: 'Tipo de identificación',
      tipo: 'Casilla',
      valor: 'Cédula',
      campoJson: 'datos.personas.codigoTipoIdentificacion',
      colN: 'tit_tipo_id_cedula, con_tipo_id_cedula, rep_tipo_id_cedula',
    }),
    fila({
      nombrePdf: 'Tipo de identificación',
      tipo: 'Casilla',
      valor: 'Pasaporte',
      campoJson: 'datos.personas.codigoTipoIdentificacion',
      colN: 'tit_tipo_id_pasaporte, con_tipo_id_pasaporte, rep_tipo_id_pasaporte',
    }),
    // fila que solo aplica a una instancia (la restricción va en prosa)
    fila({
      nombrePdf: 'Razón social',
      regla: 'Solo aplica cuando código de persona es "CON"',
      campoJson: 'datos.personas.razonSocial',
      colN: 'con_razon_social',
    }),
    // fila con condicional en prosa
    fila({
      nombrePdf: '¿Tiene representante?',
      tipo: 'Casilla',
      valor: 'SI',
      regla: 'Si se escoge "SI" se debe mostrar el campo "Detalle del representante"',
      campoJson: 'datos.personas.tieneRepresentante',
      colN: 'tit_tiene_representante, con_tiene_representante, rep_tiene_representante',
    }),
    fila({
      nombrePdf: 'Detalle del representante',
      campoJson: 'datos.personas.detalleRepresentante',
      colN: 'tit_detalle_rep, con_detalle_rep, rep_detalle_rep',
      obligatorio: 'None',
    }),
    // fila solo-JSON dentro del bloque
    fila({
      paso: 'JSON',
      nombrePdf: 'Identificador interno',
      campoJson: 'datos.personas.identificadorInterno',
      obligatorio: 'JSON',
    }),
  ],
});

// hoja HIJA del bloque repetible (se repite con él)
hojas.push({
  nombre: 'domicilio',
  aoa: [
    ['datos.personas.domicilio'],
    HEADER,
    fila({
      paso: 'Datos de la persona',
      seccion: 'Contacto',
      nombrePdf: 'Provincia',
      campoJson: 'datos.personas.domicilio.provincia',
      colN: 'tit_provincia, con_provincia, rep_provincia',
    }),
    fila({
      nombrePdf: 'Cantón',
      campoJson: 'datos.personas.domicilio.canton',
      colN: 'tit_canton, con_canton, rep_canton',
    }),
    fila({
      nombrePdf: 'Teléfono',
      tipo: 'Numérico',
      regla: '8 dígitos',
      campoJson: 'datos.personas.domicilio.telefono',
      colN: 'tit_telefono, con_telefono, rep_telefono',
    }),
  ],
});

hojas.push({
  nombre: 'notificacion',
  aoa: [
    ['datos.personas.notificacion'],
    HEADER,
    fila({
      paso: 'Datos de la persona',
      seccion: 'Preferencias',
      nombrePdf: 'Medio de notificación',
      tipo: 'Casilla',
      valor: 'Correo',
      campoJson: 'datos.personas.notificacion.medio',
      colN: 'tit_medio_correo, con_medio_correo, rep_medio_correo',
    }),
    // ruta con grafía sospechosa a propósito (para el aviso de col M)
    fila({
      nombrePdf: 'Correo de notificación',
      regla: 'Formato de correo',
      campoJson: 'datos.personas.notificacion.CorreoNotificación',
      colN: 'tit_correo_notif, con_correo_notif, rep_correo_notif',
    }),
  ],
});

// --- hoja con BLOQUE excluido -------------------------------------------
hojas.push({
  nombre: 'extras',
  aoa: [
    ['datos.extras'],
    HEADER,
    fila({
      paso: 'Extras',
      seccion: 'Adicionales',
      nombrePdf: 'Dato adicional',
      campoJson: 'datos.extras.adicional',
      colN: 'dato_adicional',
    }),
    // marcador de BLOQUE no aplica (col G, con las 3 condiciones)
    ['', '', '', '', '', '', 'NO APLICA ESTA SECCION PARA ESTE FORMULARIO', '', '', '', '', '', '', ''],
    fila({
      nombrePdf: 'Cobertura opcional',
      campoJson: 'datos.extras.coberturaOpcional',
      colN: 'cobertura_opcional',
    }),
  ],
});

// --- hoja entera excluida -----------------------------------------------
hojas.push({
  nombre: 'noAplica',
  aoa: [
    ['datos.noAplica'],
    ['NO APLICA ESTA HOJA PARA ESTE FORMULARIO'],
    HEADER,
    fila({ nombrePdf: 'Campo que no va', campoJson: 'datos.noAplica.campo', colN: 'campo_que_no_va' }),
  ],
});

const wb = XLSX.utils.book_new();
for (const h of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h.aoa), h.nombre);

const destino = path.resolve('tests/fixtures/ficha-sintetica-col-n.xlsx');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
console.log(`ficha sintética: ${hojas.length} hojas -> ${destino}`);
