// Fixture sintético: casilla con estado de exportación acentuado.
//
// Es el sustituto de los PDFs de Equipo Electrónico, que son del cliente y no
// se commitean. Reproduce lo único que importa del D0714: un /AP/N cuya clave
// es «Sí», con la í escapada en hex MINÚSCULA, que es como la escribe el
// generador del INS (pdf-lib siempre escribe mayúscula, así que hay que bajarla
// a nivel de bytes; el reemplazo es del mismo largo y el xref sigue válido).

import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

export const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
export const bytes = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

export async function pdfConCasilla(caso: 'minuscula' | 'mayuscula'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;

  const apariencia = () =>
    ctx.register(
      ctx.stream('', {
        Type: PDFName.of('XObject'),
        Subtype: PDFName.of('Form'),
        BBox: ctx.obj([0, 0, 12, 12]),
      }),
    );

  const campo = ctx.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Btn'),
    T: PDFString.of('casilla'),
    Rect: ctx.obj([50, 200, 62, 212]),
    F: ctx.obj(4),
    P: page.ref,
    // el PDF viene marcado: el renombrado tiene que limpiar /V y /AS...
    V: PDFName.of('Sí'),
    AS: PDFName.of('Sí'),
    // ...pero NO el /AP, que es el que define el estado.
    AP: ctx.obj({ N: ctx.obj({ ['Sí']: apariencia(), Off: apariencia() }) }),
    MK: ctx.obj({ BC: ctx.obj([0, 0, 0]) }),
  });
  const ref = ctx.register(campo);
  page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  doc.catalog.set(
    PDFName.of('AcroForm'),
    ctx.obj({ Fields: ctx.obj([ref]), DA: PDFString.of('/Helv 0 Tf 0 g') }),
  );

  // Sin object streams para poder tocar los bytes del name.
  const crudo = await doc.save({ useObjectStreams: false });
  if (caso === 'mayuscula') return crudo;
  return bytes(latin1(crudo).split('#ED').join('#ed'));
}
