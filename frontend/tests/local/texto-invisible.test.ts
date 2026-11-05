import { describe, it, expect } from 'vitest';
import * as m from 'mupdf';
import { esInvisible, quitarTextoInvisibleDelFlujo } from '../../src/app/core/local/texto-invisible';
import { quitarTextoInvisible } from '../../src/app/core/local/ocr-pdf';
import { guardarPdf } from '../../src/app/core/local/pdf';

const bytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
const cadena = (b: Uint8Array) => String.fromCharCode(...b);
const filtrar = (s: string, alfas: Record<string, { relleno?: number; trazo?: number }> = {}) => {
  const r = quitarTextoInvisibleDelFlujo(bytes(s), n => alfas[n] ?? {});
  return { texto: cadena(r.contenido), quitados: r.quitados };
};

describe('filtro de texto invisible', () => {
  it('quita lo pintado con Tr 3 y deja lo demás byte a byte', () => {
    const r = filtrar('BT /F1 12 Tf 0 0 Td (visible) Tj 3 Tr 10 10 Td (oculto) Tj [(a) 120 (b)] TJ 0 Tr (otra) Tj ET');
    expect(r.texto).toBe('BT /F1 12 Tf 0 0 Td (visible) Tj 3 Tr 10 10 Td   0 Tr (otra) Tj ET');
    expect(r.quitados).toBe(2);
  });
  it('q y Q guardan y recuperan el modo', () => {
    expect(filtrar('q 3 Tr BT (a) Tj ET Q BT (b) Tj ET').texto).toBe('q 3 Tr BT  ET Q BT (b) Tj ET');
  });
  it('la transparencia cero de un estado gráfico también esconde', () => {
    const alfas = { GS0: { relleno: 0 }, GS1: { relleno: 1 } };
    expect(filtrar('/GS0 gs BT (a) Tj ET /GS1 gs BT (b) Tj ET', alfas).texto).toBe('/GS0 gs BT  ET /GS1 gs BT (b) Tj ET');
    // Trazo sin transparencia: con modo de trazo, se ve.
    expect(filtrar('/GS0 gs 1 Tr BT (a) Tj ET', alfas).quitados).toBe(0);
  });
  it("' y \" conservan el salto de renglón", () => {
    expect(filtrar("3 Tr BT (a) ' 1 2 (b) \" ET").texto).toBe('3 Tr BT T* 1 Tw 2 Tc T* ET');
  });
  it('no se confunde con lo que parece un operador dentro de una cadena o una imagen', () => {
    const s = '3 Tr BT (dice \\) Tj y \\( Tr) Tj <48 6f> Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 Tj 0 Tr \xff EI 0 Tr BT (b) Tj ET';
    expect(filtrar(s).texto).toBe('3 Tr BT   ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 Tj 0 Tr \xff EI 0 Tr BT (b) Tj ET');
  });
  it('un modo con relleno y trazo sólo es invisible si los dos lo son', () => {
    expect(esInvisible({ modo: 2, relleno: 0, trazo: 1 })).toBe(false);
    expect(esInvisible({ modo: 2, relleno: 0, trazo: 0 })).toBe(true);
    expect(esInvisible({ modo: 7, relleno: 1, trazo: 1 })).toBe(true);
  });
});

/** Una página con texto visible con tildes en WinAnsi y una capa de OCR antigua, también dentro de un Form. */
function conCapaAntigua(): Blob {
  const doc = new m.PDFDocument(), fuente = new m.Font('Helvetica');
  const f = doc.addSimpleFont(fuente, 'Latin');
  const forma = doc.addStream('BT /F1 10 Tf 3 Tr 20 40 Td (CAPA EN FORMA) Tj ET', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 200], Resources: { Font: { F1: f } } });
  const gs = doc.addObject({ Type: 'ExtGState', ca: 0 });
  // «Información · página» con los códigos WinAnsi de ó (363), · (267) y á (341).
  const contenido = 'BT /F1 14 Tf 20 150 Td (Informaci\\363n \\267 p\\341gina) Tj ET\n'
    + 'BT /F1 14 Tf 3 Tr 20 120 Td (CAPA ANTIGUA) Tj ET\n'
    + 'q /G0 gs BT /F1 14 Tf 20 100 Td (CAPA TRANSPARENTE) Tj ET Q\n/Fm0 Do';
  const pagina = doc.addPage([0, 0, 300, 200], 0, { Font: { F1: f }, XObject: { Fm0: forma }, ExtGState: { G0: gs } }, contenido);
  doc.insertPage(-1, pagina);
  try { return guardarPdf(doc); } finally { pagina.destroy(); fuente.destroy(); doc.destroy(); }
}

describe('quitar la capa de un OCR anterior sin redibujar la página', () => {
  it('conserva el texto visible con sus tildes, se ve igual y no deja la capa antigua', async () => {
    const original = new m.PDFDocument(await conCapaAntigua().arrayBuffer());
    const pixeles = (d: m.PDFDocument) => d.loadPage(0).toPixmap(m.Matrix.identity, m.ColorSpace.DeviceRGB, false).getPixels().slice();
    const antes = pixeles(original);
    const visibles = quitarTextoInvisible(m, original, 0);
    // Guardado y reabierto: es el archivo lo que importa.
    const reabierto = new m.PDFDocument(await guardarPdf(original, { garbage: 2 }).arrayBuffer());
    const texto = reabierto.loadPage(0).toStructuredText().asText();
    expect(texto).toContain('Información · página');
    expect(texto).not.toContain('CAPA');
    expect(pixeles(reabierto)).toEqual(antes);
    expect(visibles).toHaveLength(1);
    original.destroy(); reabierto.destroy();
  });
});
