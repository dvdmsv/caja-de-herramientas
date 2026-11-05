import { it, expect } from 'vitest';
import * as m from 'mupdf';
import { zipSync, strToU8 } from 'fflate';
import { convertirEpub, comprobarEpub } from '../../src/app/core/local/epub';

function libro(extra: Record<string,Uint8Array> = {}) {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test</dc:identifier><dc:title>Libro de prueba</dc:title><dc:language>es</dc:language></metadata><manifest><item id="p" href="page.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="p"/></spine></package>'),
    'page.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Prueba</title></head><body><h1>Capítulo primero</h1><p>Texto seleccionable del libro.</p></body></html>'),
    ...extra,
  });
}
it('convierte EPUB a PDF local con texto seleccionable y tamaño elegido', async () => {
  const r = await convertirEpub(m, { slug:'epub-a-pdf', archivos:[{name:'libro.epub',blob:new Blob([libro()])}], opciones:{pagina:'a4',letra:'grande'} },()=>{});
  const doc=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
  try {
    expect(doc.countPages()).toBeGreaterThan(0);
    const page=doc.loadPage(0), text=page.toStructuredText();
    expect(page.getBounds()).toEqual([0,0,595,842]);
    expect(text.asText()).toContain('Texto seleccionable');
    expect(doc.getMetaData('info:Title')).toBe('Libro de prueba');
    text.destroy(); page.destroy();
  } finally { doc.destroy(); }
});
it('rechaza DRM y archivo dañado antes de convertir',()=>{
  expect(()=>comprobarEpub(libro({'META-INF/encryption.xml':strToU8('<EncryptionMethod Algorithm="http://example.com/drm"/>')}))).toThrow('DRM');
  expect(()=>comprobarEpub(new Uint8Array([1,2,3]))).toThrow();
});
