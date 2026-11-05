import {it,expect} from 'vitest';
import * as m from 'mupdf';
import {anonimizar} from '../../src/app/core/local/anonimizar';
import {coincidencias,compilarPatron,probarPatron} from '../../src/app/core/local/patrones';
import {PATRONES} from '../../src/app/core/local/patrones-generados';
import {abrirPdf,guardarPdf} from '../../src/app/core/local/pdf';
const todos=new Set<string>(PATRONES.map(p=>p.tipo));

it.each([
 ['12345678Z','dni'],['12345678 Z','dni'],['X1234567L','nie'],['ES91 2100 0418 4502 0005 1332','iban'],
 ['4539 1488 0343 6467','tarjeta'],['+34 600 123 456','telefono'],['ana.ruiz@ejemplo.es','correo'],
 ['A58818501','cif'],['Q2826004J','cif'],['G28029643','cif'],['1234 BCD','matricula'],['M-1234-AB','matricula'],['28001','codigo_postal'],
])('reconoce y valida %s como %s',(texto,tipo)=>{
  expect(coincidencias(texto,todos)).toEqual([{inicio:0,fin:texto.length,tipo}]);
});
it.each(['12345678A','X1234567A','ES90 2100 0418 4502 0005 1332','4539 1488 0343 6468','A58818502','Q2826004K','1234 AEI','1234 QQQ','99999'])('rechaza el dato inválido %s',texto=>{
  // Buscar cada validador por separado: un IBAN inválido aún puede contener teléfonos reales.
  const tipos=new Set(['dni','nie','iban','tarjeta','cif','matricula','codigo_postal']);
  expect(coincidencias(texto,tipos)).toEqual([]);
});
it('resuelve solapes a favor del dato más largo y conserva posiciones con emoji',()=>{
  const s='🙂 ES91 2100 0418 4502 0005 1332';
  expect(coincidencias(s,todos,compilarPatron('2100'))).toEqual([{inicio:3,fin:s.length,tipo:'iban'}]);
  expect(probarPatron({texto:'🙂 EXP-2026\nNada',patron:'(?i)exp-\\d{4}'})).toEqual({total:1,lineas:[[{texto:'🙂 ',coincide:false},{texto:'EXP-2026',coincide:true}],[{texto:'Nada',coincide:false}]]});
  expect(probarPatron({texto:'a\n',patron:'^$'}).total).toBe(0);
});
function entrada(giro=0) {
  const doc=new m.PDFDocument(),font=new m.Font('Helvetica'),ref=doc.addSimpleFont(font);
  const page=doc.addPage([0,0,400,300],giro,{Font:{F:ref}},'BT /F 12 Tf 30 240 Td (DNI 12345678 Z) Tj 0 -30 Td (Correo ana@ejemplo.es) Tj 0 -30 Td (Conservar este texto) Tj ET');
  doc.insertPage(-1,page);const blob=guardarPdf(doc);page.destroy();ref.destroy();font.destroy();doc.destroy();return {name:'datos.pdf',blob};
}
it.each([0,90,180,270])('inspecciona y elimina el contenido real de una página girada %i',async(giro)=>{
  const p={slug:'anonimizar-pdf/inspeccionar',archivos:[entrada(giro)],opciones:{tipos:['dni','correo']}};
  const previa=await anonimizar(m,p,()=>{});
  expect(previa.datos?.['total']).toBe(2);
  const paginas=previa.datos?.['paginas'] as {marcas:{rect:number[]}[]}[];
  for(const marca of paginas[0].marcas)expect(marca.rect.every(n=>n>=0&&n<=1)).toBe(true);
  const r=await anonimizar(m,{...p,slug:'anonimizar-pdf'},()=>{});expect(r.datos?.['tachadas']).toBe(2);
  const doc=await abrirPdf(m,r.archivos[0]);
  try {
    const page=doc.loadPage(0),text=page.toStructuredText();
    expect(text.asText()).not.toContain('12345678');expect(text.asText()).not.toContain('ana@');expect(text.asText()).toContain('Conservar este texto');
    expect(page.getAnnotations()).toHaveLength(0);
    const pix=page.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false),pixels=pix.getPixels();
    for(const marca of paginas[0].marcas) {
      const x=Math.floor((marca.rect[0]+marca.rect[2])/2*pix.getWidth());
      const y=Math.floor((marca.rect[1]+marca.rect[3])/2*pix.getHeight());
      expect([...pixels.slice((y*pix.getWidth()+x)*3,(y*pix.getWidth()+x)*3+3)]).toEqual([0,0,0]);
    }
    pix.destroy();
    // Además del texto visible, comprobar que los objetos de contenido antiguos se eliminaron.
    for(let i=1;i<doc.countObjects();i++) {
      const obj=doc.newIndirect(i);
      try{if(obj.isStream()){const b=obj.readStream();try{expect(b.asString()).not.toContain('12345678');expect(b.asString()).not.toContain('ana@ejemplo.es');}finally{b.destroy();}}}
      finally{obj.destroy();}
    }
    text.destroy();page.destroy();
  }finally{doc.destroy();}
});
it('el blanco elimina el texto sin dejar una barra negra',async()=>{
  const r=await anonimizar(m,{slug:'anonimizar-pdf',archivos:[entrada()],opciones:{tipos:['dni','correo'],color:'blanco'}},()=>{});
  const doc=await abrirPdf(m,r.archivos[0]);
  try{
    const p=doc.loadPage(0),text=p.toStructuredText(),pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false);
    expect(text.asText()).not.toContain('12345678');
    const data=pix.getPixels();expect([...data.slice((60*400+90)*3,(60*400+90)*3+3)]).toEqual([255,255,255]);
    pix.destroy();text.destroy();p.destroy();
  }finally{doc.destroy();}
});
it('valida patrones, tipos y PDF sin coincidencias sin producir un resultado',async()=>{
  expect(()=>compilarPatron('(')).toThrow('no es válida');expect(()=>compilarPatron('a'.repeat(201))).toThrow('200');
  const p={slug:'anonimizar-pdf',archivos:[entrada()],opciones:{tipos:['desconocido']}};
  await expect(anonimizar(m,p,()=>{})).rejects.toThrow('tipos');
  await expect(anonimizar(m,{...p,opciones:{tipos:['nie']}},()=>{})).rejects.toThrow('No se ha encontrado');
});

it('admite todos los ejemplos generados por el ayudante compartido',async()=>{
  const {EJEMPLOS,construir}=await import('../../src/app/shared/regex-guiada');
  for(const e of EJEMPLOS)expect(probarPatron({texto:e.muestra,patron:construir(e.piezas)}).total,e.nombre).toBe(1);
  expect(probarPatron({texto:'\\-',patron:'\\\\-'}).total).toBe(1);
});

it('coincide con el motor Python en el corpus generado de validaciones y solapes',async()=>{
  const {default:casos}=await import('./fixtures/patrones-python.json');
  for(const c of casos)expect(coincidencias(c.texto,todos),c.texto).toEqual(c.coincidencias);
});

it('no confunde un PDF sin capa de texto con un documento sin datos personales',async()=>{
  const doc=new m.PDFDocument(),page=doc.addPage([0,0,100,100],0,{},'0 0 0 rg 10 10 20 20 re f');doc.insertPage(-1,page);
  const blob=guardarPdf(doc);page.destroy();doc.destroy();
  await expect(anonimizar(m,{slug:'anonimizar-pdf/inspeccionar',archivos:[{name:'escaneado.pdf',blob}],opciones:{tipos:['dni']}},()=>{})).rejects.toThrow('necesita OCR');
});

it('no aplica marcas de tachado previas que el usuario no haya seleccionado',async()=>{
  const original=entrada(),doc=await abrirPdf(m,original),page=doc.loadPage(0),annot=page.createAnnotation('Redact');
  annot.setRect([30,110,200,130]);annot.update();
  const blob=guardarPdf(doc);annot.destroy();page.destroy();doc.destroy();
  await expect(anonimizar(m,{slug:'anonimizar-pdf',archivos:[{name:'con-marcas.pdf',blob}],opciones:{tipos:['dni']}},()=>{})).rejects.toThrow('tachado pendientes');
});
