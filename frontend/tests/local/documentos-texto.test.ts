import { it,expect } from 'vitest';
import * as m from 'mupdf';
import { convertirTexto,sanearHtml } from '../../src/app/core/local/documentos-texto';

it('convierte Markdown con tablas a PDF seleccionable y página horizontal',async()=>{
  const r=await convertirTexto(m,{slug:'markdown-a-pdf',archivos:[{name:'informe.md',blob:new Blob(['# Informe\n\n| Producto | Precio |\n|---|---|\n| Pan | 2 € |\n\nUn párrafo con **negrita**.'])}],opciones:{orientacion:'horizontal',pagina:'carta',margen:25,cuerpo:12}},()=>{});
  const doc=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
  try {
    const p=doc.loadPage(0),text=p.toStructuredText();
    expect(p.getBounds()[2]).toBeCloseTo(792,1);expect(p.getBounds()[3]).toBeCloseTo(612,1);
    expect(text.asText()).toContain('Informe');expect(text.asText()).toContain('Producto');
    expect(text.asText()).toContain('Página 1 de 1');
    expect(p.search('Informe')[0][0][0]).toBeGreaterThan(65);
    text.destroy();p.destroy();
  } finally{doc.destroy();}
});
it('HTML conserva enlaces seguros y elimina contenido activo y fuentes remotas',async()=>{
  const html='<html><head><script>alert(1)</script><link rel="stylesheet" href="https://example.com/x"></head><body><h1>Prueba</h1><a href="https://example.com">Enlace seguro</a><a href="java&#x09;script:alert(1)">No ejecutar</a><img src="file:///privado"></body></html>';
  const clean=sanearHtml(html);
  expect(clean).not.toContain('<script');expect(clean).not.toContain('file:///');expect(clean).not.toContain('script:alert');expect(clean).not.toContain('<link');
  const r=await convertirTexto(m,{slug:'html-a-pdf',archivos:[{name:'pagina.html',blob:new Blob([html])}],opciones:{margen:15}},()=>{});
  const doc=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
  try {
    const p=doc.loadPage(0),text=p.toStructuredText(),links=p.getLinks();
    expect(text.asText()).toContain('Enlace seguro');expect(links.map(l=>l.getURI())).toEqual(['https://example.com']);
    links.forEach(l=>l.destroy());text.destroy();p.destroy();
  } finally{doc.destroy();}
});
it('valida márgenes y archivos vacíos',async()=>{
  const p={slug:'html-a-pdf',archivos:[{name:'p.html',blob:new Blob([' '])}],opciones:{}};
  await expect(convertirTexto(m,p,()=>{})).rejects.toThrow('vacío');
  await expect(convertirTexto(m,{...p,opciones:{margen:41}},()=>{})).rejects.toThrow('margen');
});
it('compone una portada Markdown y comienza el contenido en otra página',async()=>{
  const texto='# Memoria anual\n\nDepartamento de pruebas\n\n<div style="page-break-after: always"></div>\n\n## Resultados\n\nContenido del informe.';
  const r=await convertirTexto(m,{slug:'markdown-a-pdf',archivos:[{name:'memoria.md',blob:new Blob([texto])}],opciones:{}},()=>{});
  const doc=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
  try {
    expect(doc.countPages()).toBeGreaterThanOrEqual(2);
    const first=doc.loadPage(0),last=doc.loadPage(1),a=first.toStructuredText(),b=last.toStructuredText();
    expect(a.asText()).toContain('Memoria anual');expect(a.asText()).not.toContain('Contenido del informe');
    expect(b.asText()).toContain('Contenido del informe');
    a.destroy();b.destroy();first.destroy();last.destroy();
  }finally{doc.destroy();}
});
