import {it,expect} from 'vitest';
import * as m from 'mupdf';
import {alinear,huella,zonasCambiadas} from '../../src/app/core/local/comparacion';
import {compararPdf} from '../../src/app/core/local/comparar-pdf';
import {guardarPdf,abrirPdf} from '../../src/app/core/local/pdf';

function entrada(textos:string[],dibujo='',name='a.pdf') {
  const doc=new m.PDFDocument(),font=new m.Font('Helvetica'),ref=doc.addSimpleFont(font);
  try {
    for(const t of textos) {
      const p=doc.addPage([0,0,240,160],0,{Font:{F:ref}},`BT /F 14 Tf 20 120 Td (${t}) Tj ET ${dibujo}`);
      try{doc.insertPage(-1,p);}finally{p.destroy();}
    }
    return {name,blob:guardarPdf(doc)};
  }finally{ref.destroy();font.destroy();doc.destroy();}
}
const ejecutar=(a=entrada(['Texto original']),b=a,imagenes=true)=>compararPdf(m,{slug:'comparar-pdf',archivos:[a,b],opciones:{imagenes}},()=>{});
it('alinea páginas insertadas sin desplazar todas las comparaciones',()=>{
  expect(alinear(['uno','dos','tres'],['uno','nueva','dos','tres'])).toEqual([
    {a:0,b:0,estado:'igual'},{a:null,b:1,estado:'añadida'},
    {a:1,b:2,estado:'igual'},{a:2,b:3,estado:'igual'},
  ]);
  expect(huella('  HOLA\n mundo ')).toBe('hola mundo');
  expect(alinear(['a','b'],['c'])).toEqual([{a:0,b:0,estado:'cambiada'},{a:1,b:null,estado:'quitada'}]);
});
it('detecta colores distintos con igual luminancia y agrupa bandas',()=>{
  const a=new Uint8Array(30*30*3).fill(255),b=a.slice();
  for(let y=4;y<8;y++)for(let x=5;x<9;x++){
    a.set([255,0,0],(y*30+x)*3);b.set([0,130,0],(y*30+x)*3);
  }
  expect(zonasCambiadas(a,b,30,30)).toEqual([[5,4,9,8]]);
});
it('genera un informe seleccionable cuando no hay cambios',async()=>{
  const r=await ejecutar();expect(r.datos?.['comparacion']).toMatchObject({identicos:true,iguales:1,diferencias:0});
  const doc=await abrirPdf(m,r.archivos[0]);
  try{const p=doc.loadPage(0),text=p.toStructuredText();expect(text.asText()).toContain('No se han detectado diferencias');text.destroy();p.destroy();}
  finally{doc.destroy();}
});
it('detecta un logotipo cambiado con el mismo texto y dibuja recuadros rojos',async()=>{
  const r=await ejecutar(entrada(['Contrato'],'0 0 0 rg 30 25 20 20 re f'),entrada(['Contrato'],'0 0 0 rg 80 25 20 20 re f'));
  expect(r.datos?.['comparacion']).toMatchObject({identicos:false,cambiadas:1,diferencias:0});
  const doc=await abrirPdf(m,r.archivos[0]);
  try {
    expect(doc.countPages()).toBeGreaterThan(1);
    const p=doc.loadPage(doc.countPages()-1),pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false),data=pix.getPixels();
    let rojos=0;for(let i=0;i<data.length;i+=3)if(data[i]>150&&data[i+1]<100&&data[i+2]<100)rojos++;
    expect(rojos).toBeGreaterThan(20);pix.destroy();p.destroy();
  }finally{doc.destroy();}
});
it('cuenta una página añadida y permite omitir las imágenes del informe',async()=>{
  const r=await ejecutar(entrada(['Inicio','Final']),entrada(['Inicio','Intermedio','Final']),false);
  expect(r.datos?.['comparacion']).toMatchObject({identicos:false,iguales:2,anadidas:1,cambiadas:0,diferencias:1});
  const doc=await abrirPdf(m,r.archivos[0]);
  try{expect(doc.countPages()).toBe(1);}finally{doc.destroy();}
});
it('incluye los textos anterior y nuevo escapando HTML del documento',async()=>{
  const r=await ejecutar(entrada(['Precio <100>']),entrada(['Precio <200>']),false);
  expect(r.datos?.['comparacion']).toMatchObject({cambiadas:1,diferencias:1});
  const doc=await abrirPdf(m,r.archivos[0]);
  try{const p=doc.loadPage(0),t=p.toStructuredText();expect(t.asText()).toContain('Precio <100>');expect(t.asText()).toContain('Precio <200>');t.destroy();p.destroy();}
  finally{doc.destroy();}
});
it('rechaza selecciones inválidas, documentos largos y contraseñas',async()=>{
  await expect(compararPdf(m,{slug:'comparar-pdf',archivos:[entrada(['uno'])],opciones:{}},()=>{})).rejects.toThrow('exactamente dos');
  await expect(ejecutar(entrada(Array(101).fill('Texto')))).rejects.toThrow('100 páginas');
  const original=entrada(['Secreto']),doc=await abrirPdf(m,original);
  const blob=guardarPdf(doc,{encrypt:'aes-256','user-password':'clave','owner-password':'owner'});doc.destroy();
  await expect(ejecutar({...original,blob})).rejects.toThrow('contraseña');
});
