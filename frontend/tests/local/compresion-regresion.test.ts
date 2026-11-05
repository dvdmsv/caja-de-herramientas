import {it,expect} from 'vitest';
import * as m from 'mupdf';
import {comprimirPdf} from '../../src/app/core/local/comprimir-pdf';
import {guardarPdf} from '../../src/app/core/local/pdf';

function fixture(w=2400,h=300,alpha=false,noisyAlpha=false) {
 const doc=new m.PDFDocument(),pix=new m.Pixmap(m.ColorSpace.DeviceRGB,[0,0,w,h],alpha),data=pix.getPixels(),n=alpha?4:3;
 let seed=123456;
 const colors=[[230,20,20],[20,230,20],[20,20,230],[230,230,20]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const c=colors[(y>=h/2?2:0)+(x>=w/2?1:0)],i=(y*w+x)*n;
   for(let k=0;k<3;k++)data[i+k]=c[k]-(seed>>>24)%20;
   if(alpha){data[i+3]=noisyAlpha?(seed>>>24):128;for(let k=0;k<3;k++)data[i+k]=Math.floor(data[i+k]*data[i+3]/255);}
 }
 const image=new m.Image(pix),im=doc.addImage(image),font=new m.Font('Helvetica'),f=doc.addSimpleFont(font);
 const pg=doc.addPage([0,0,400,400],0,{Font:{F:f},XObject:{Im:im}},'q 360 0 0 200 20 20 cm /Im Do Q BT /F 15 Tf 20 350 Td (Texto preservado) Tj ET');doc.insertPage(-1,pg);
 const page=doc.loadPage(0);page.createLink([20,30,120,50],'https://example.com').destroy();page.destroy();
 const blob=guardarPdf(doc);pg.destroy();f.destroy();font.destroy();im.destroy();image.destroy();pix.destroy();doc.destroy();return {name:'prueba.pdf',blob};
}
const run=(e:ReturnType<typeof fixture>,opciones:Record<string,unknown>={},slug='comprimir-pdf')=>comprimirPdf(m,{slug,archivos:[e],opciones},()=>{});
function imageInfo(doc:m.PDFDocument) {
 for(let i=1;i<doc.countObjects();i++) {const o=doc.newIndirect(i),s=o.get('Subtype');try{if(s.asName()==='Image'){const im=doc.loadImage(o);return im;}}finally{s.destroy();o.destroy();}}
 throw new Error('no image');
}
it('reduce imágenes grandes y conserva texto, enlaces y dimensiones de página',async()=>{
 const e=fixture(),r=await run(e,{nivel:'fuerte'});expect(r.archivos[0].blob.size).toBeLessThan(e.blob.size);
 const d=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer()),p=d.loadPage(0),t=p.toStructuredText();
 expect(t.asText()).toContain('Texto preservado');expect(p.getBounds()).toEqual([0,0,400,400]);
 const links=p.getLinks();expect(links.map(l=>l.getURI())).toContain('https://example.com');links.forEach(l=>l.destroy());
 const img=imageInfo(d);expect(img.getWidth()).toBe(1100);img.destroy();t.destroy();p.destroy();d.destroy();
});
it('conserva posición y color de los cuatro cuadrantes al reducir',async()=>{
 const e=fixture(),r=await run(e,{nivel:'fuerte'}),d=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer()),img=imageInfo(d),pix=img.toPixmap(),data=pix.getPixels(),w=pix.getWidth(),h=pix.getHeight(),n=pix.getNumberOfComponents();
 const colors=[[230,20,20],[20,230,20],[20,20,230],[230,230,20]];
 for(let q=0;q<4;q++){
  const x=Math.floor(w*(q%2?0.75:0.25)),y=Math.floor(h*(q>=2?0.75:0.25)),i=(y*w+x)*n;
  for(let k=0;k<3;k++)expect(Math.abs(data[i+k]-colors[q][k]),`quadrant ${q} channel ${k}: ${data[i+k]}`).toBeLessThan(45);
 }
 pix.destroy();img.destroy();d.destroy();
});
it('no altera la apariencia de imágenes con transparencia',async()=>{
 const e=fixture(300,200,true),r=await run(e,{nivel:'fuerte'});
 const render=async(blob:Blob)=>{const d=new m.PDFDocument(await blob.arrayBuffer()),p=d.loadPage(0),pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false);const bytes=pix.getPixels().slice();pix.destroy();p.destroy();d.destroy();return bytes;};
 expect(await render(r.archivos[0].blob)).toEqual(await render(e.blob));
});
it('el mínimo es repetible y un objetivo con ese tamaño se cumple',async()=>{
 const e=fixture();const a=await run(e,{},'comprimir-pdf/minimo'),b=await run(e,{},'comprimir-pdf/minimo');
 expect(a.datos).toEqual(b.datos);const minimo=Number(a.datos?.['minimo']);
 const r=await run(e,{objetivo_mb:minimo/1024/1024});expect(r.objetivo?.logrado).toBe(true);expect(r.archivos[0].blob.size).toBeLessThanOrEqual(minimo);
});
it('informa de objetivos imposibles sin devolver algo más grande',async()=>{
 const e=fixture(120,120),r=await run(e,{objetivo_mb:0.000001});expect(r.objetivo?.logrado).toBe(false);expect(r.archivos[0].blob.size).toBeLessThanOrEqual(e.blob.size);
});
it('si el original ya cabe conserva exactamente sus bytes',async()=>{
 const e=fixture(120,120),r=await run(e,{objetivo_mb:50});expect(await r.archivos[0].blob.arrayBuffer()).toEqual(await e.blob.arrayBuffer());
});
it('rechaza contraseña, documentos dañados, niveles y opción web pendiente',async()=>{
 const e=fixture(120,120);await expect(run(e,{nivel:'no'})).rejects.toThrow();await expect(run(e,{objetivo_mb:-1})).rejects.toThrow();await expect(run(e,{web:true})).rejects.toThrow('qpdf');
 const d=new m.PDFDocument(await e.blob.arrayBuffer());const blob=guardarPdf(d,{encrypt:'aes-256','user-password':'clave','owner-password':'clave'});d.destroy();
 await expect(run({...e,blob},{objetivo_mb:50})).rejects.toThrow('contraseña');
 await expect(run({...e,blob:new Blob(['bad'])})).rejects.toThrow();
});
it('no recomprime ni cambia a RGB la máscara alfa de una imagen transparente',async()=>{
 const e=fixture(300,200,true,true),r=await run(e,{nivel:'fuerte'}),d=new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
 try {
  let masks=0;
  for(let i=1;i<d.countObjects();i++) {
   const obj=d.newIndirect(i),smask=obj.get('SMask');
   try {if(!smask.isNull()){const cs=smask.get('ColorSpace'),filter=smask.get('Filter');try{masks++;expect(cs.asName()).toBe('DeviceGray');expect(filter.asName()).not.toBe('DCTDecode');}finally{cs.destroy();filter.destroy();}}}
   finally{obj.destroy();smask.destroy();}
  }
  expect(masks).toBe(1);
 }finally{d.destroy();}
});
