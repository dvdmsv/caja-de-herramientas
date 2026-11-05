import {describe,it,expect} from 'vitest';
import * as m from 'mupdf';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';
import {writeFileSync,mkdirSync} from 'node:fs';
import {pdfWord} from '../../src/app/core/local/pdf-a-word';
import {guardarPdf} from '../../src/app/core/local/pdf';

const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const tags=(node:Document|Element,name:string)=>Array.from(node.getElementsByTagNameNS(ns,name));
const text=(x:Document|Element)=>tags(x,'t').map(n=>n.textContent).join('');
function documento(paginas=['BT /F1 12 Tf 40 500 Td (Texto editable) Tj ET'],imagen=false,soloImagen=false,transform='80 0 0 40 40 400') {
 const d=new m.PDFDocument(),fonts=['Helvetica','Helvetica-Bold','Helvetica-Oblique'].map(n=>new m.Font(n));
 const fontDict=Object.fromEntries(fonts.map((f,i)=>['F'+(i+1),d.addSimpleFont(f)]));
 let img:m.Image|undefined,ref:m.PDFObject|undefined;
 if(imagen){const pix=new m.Pixmap(m.ColorSpace.DeviceRGB,[0,0,80,40],false);const pixels=pix.getPixels();for(let y=0;y<40;y++)for(let x=0;x<80;x++){const i=(y*80+x)*3;pixels[i]=x<40?255:0;pixels[i+1]=0;pixels[i+2]=x<40?0:255;}img=new m.Image(pix.asPNG());ref=d.addImage(img);pix.destroy();}
 for(const contenido of paginas){const p=d.addPage([0,0,600,600],0,{Font:fontDict,...(ref?{XObject:{Im:ref}}:{})},(soloImagen?'':contenido)+(ref?`\nq ${transform} cm /Im Do Q` :''));d.insertPage(-1,p);p.destroy();}
 d.setMetaData('info:Title','Título de prueba');d.setMetaData('info:Author','María');
 const e={name:'prueba.pdf',blob:guardarPdf(d)};ref?.destroy();img?.destroy();for(const f of fonts)f.destroy();d.destroy();return e;
}
const run=(entradas=[documento()])=>pdfWord(m,{slug:'pdf-a-word',archivos:entradas,opciones:{}},()=>{});
async function docx(e=documento(),nombre='salida') {
 const r=await run([e]),bytes=new Uint8Array(await r.archivos[0].blob.arrayBuffer());

 const zip=unzipSync(bytes),document=new JSDOM(strFromU8(zip['word/document.xml']),{contentType:'text/xml'}).window.document;
 return {r,zip,document};
}

describe('Auditoria independiente Word editable',()=>{
 it('genera ZIP DOCX con texto editable y relaciones',async()=>{
  const {r,zip,document}=await docx();expect(r.archivos[0].name).toBe('prueba.docx');expect(text(document)).toBe('Texto editable');expect(tags(document,'r')).not.toHaveLength(0);
  expect(zip['[Content_Types].xml']).toBeDefined();expect(zip['_rels/.rels']).toBeDefined();expect(zip['word/_rels/document.xml.rels']).toBeDefined();
 });
 it('preserva caracteres españoles y XML escapado',async()=>{
  const contenido='BT /F1 12 Tf 40 500 Td <45737061f16f6c3a20e1e9edf3fa20bf5175e93f203c41202620423e> Tj ET';
  const {document}=await docx(documento([contenido]),'espanol');expect(text(document)).toBe('Español: áéíóú ¿Qué? <A & B>');
 });
 it('preserva negrita cursiva y tamaño de texto',async()=>{
  const s='BT /F2 18 Tf 40 500 Td (Negrita) Tj ET\nBT /F3 12 Tf 40 470 Td (Cursiva) Tj ET';
  const {document}=await docx(documento([s]),'estilos');const runs=tags(document,'r');
  const bold=runs.find(r=>text(r)==='Negrita')!,italic=runs.find(r=>text(r)==='Cursiva')!;
  expect(tags(bold,'b')).toHaveLength(1);expect(tags(italic,'i')).toHaveLength(1);expect(tags(bold,'sz')[0].getAttributeNS(ns,'val')).toBe('36');
 });
 it('conserva título y autor en propiedades del DOCX',async()=>{
  const {zip}=await docx();const core=new JSDOM(strFromU8(zip['docProps/core.xml']),{contentType:'text/xml'}).window.document;
  expect(core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/','title')[0].textContent).toBe('Título de prueba');expect(core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/','creator')[0].textContent).toBe('María');
 });
 it('crea tabla editable con posiciones de celdas correctas',async()=>{
  let s='40 340 200 60 re S\n140 340 m 140 400 l S\n40 370 m 240 370 l S\n';
  for(const [x,y,v] of [[45,382,'Codigo'],[145,382,'Valor'],[45,352,'08001'],[145,352,'12,50']] as const)s+=`BT /F1 10 Tf ${x} ${y} Td (${v}) Tj ET\n`;
  const {document}=await docx(documento([s]),'tabla');expect(tags(document,'tbl')).toHaveLength(1);const rows=tags(document,'tr').map(r=>tags(r,'tc').map(text));expect(rows).toEqual([['Codigo','Valor'],['08001','12,50']]);
 });
 it('incrusta imagen PNG real junto a texto editable',async()=>{
  const {zip,document}=await docx(documento(undefined,true),'imagen');const media=Object.entries(zip).filter(([p])=>p.startsWith('word/media/')&&p.endsWith('.png'));
  expect(media).toHaveLength(1);expect([...media[0][1].subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(tags(document,'drawing')).toHaveLength(1);expect(text(document)).toContain('Texto editable');
 });
 it('preserva orientación visual de imagen girada 90 grados',async()=>{
  const original=documento(undefined,true,false,'0 80 -40 0 100 400');
  const {zip,document}=await docx(original,'imagen-girada');const image=Object.entries(zip).find(([p])=>p.startsWith('word/media/')&&p.endsWith('.png'))!;
  const im=new m.Image(image[1]);const shape=document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','xfrm')[0];
  const rot=Number(shape?.getAttribute('rot')??0);
  try {expect(im.getWidth()<im.getHeight() || rot===90*60000 || rot===270*60000).toBe(true);}finally{im.destroy();}
 });
 it('introduce salto explícito entre páginas',async()=>{
  const {document}=await docx(documento(['BT /F1 12 Tf 40 500 Td (Primera) Tj ET','BT /F1 12 Tf 40 500 Td (Segunda) Tj ET']),'paginas');
  expect(text(document)).toBe('PrimeraSegunda');expect(tags(document,'br').filter(b=>b.getAttributeNS(ns,'type')==='page')).toHaveLength(1);
 });
 it('convierte varios archivos conservando nombres',async()=>{const e=documento();const r=await run([e,{...e,name:'segundo.pdf'}]);expect(r.archivos.map(x=>x.name)).toEqual(['prueba.docx','segundo.docx']);});
 it('rechaza escaneado puro',async()=>{await expect(run([documento(undefined,true,true)])).rejects.toThrow('OCR');});
 it('rechaza selección vacía',async()=>{await expect(run([])).rejects.toThrow('Selecciona');});
 it('rechaza PDF corrupto',async()=>{await expect(run([{name:'roto.pdf',blob:new Blob(['%PDF basura'])}])).rejects.toThrow();});
 it('rechaza documento protegido',async()=>{const e=documento(),d=new m.PDFDocument(await e.blob.arrayBuffer());try{e.blob=guardarPdf(d,{encrypt:'aes-256','user-password':'secreto','owner-password':'owner'});}finally{d.destroy();}await expect(run([e])).rejects.toThrow('contraseña');});
 it('no entrega resultados parciales cuando falla el segundo archivo',async()=>{await expect(run([documento(),{name:'roto.pdf',blob:new Blob(['%PDF basura'])}])).rejects.toThrow();});
});
