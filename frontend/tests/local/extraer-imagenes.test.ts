import { it, expect } from 'vitest';
import * as m from 'mupdf';
import { ejecutarPdf, guardarPdf } from '../../src/app/core/local/pdf';

function documento(jpeg:boolean) {
  const d=new m.PDFDocument(),pix=new m.Pixmap(m.ColorSpace.DeviceRGB,[0,0,120,100],false);
  pix.clear(100);
  const bytes=(jpeg?pix.asJPEG(90):pix.asPNG()).slice(),img=new m.Image(bytes),ref=d.addImage(img);
  const form=d.addStream('q 120 0 0 100 0 0 cm /Im Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,120,100],Resources:{XObject:{Im:ref}}});
  for(let i=0;i<2;i++) {const p=d.addPage([0,0,200,300],0,{XObject:{Form:form}},'/Form Do');d.insertPage(-1,p);p.destroy();}
  const blob=guardarPdf(d);form.destroy();ref.destroy();img.destroy();pix.destroy();d.destroy();
  return {bytes,entrada:{name:'fotos.pdf',blob}};
}
it('extrae un JPEG sin recomprimir y no repite recursos compartidos entre páginas',async()=>{
  const {bytes,entrada}=documento(true);
  const r=await ejecutarPdf(m,{slug:'extraer-imagenes',archivos:[entrada],opciones:{formato:'original'}},()=>{});
  expect(r.archivos).toHaveLength(1);expect(r.archivos[0].name).toBe('fotos-imagen-1.jpg');
  expect(new Uint8Array(await r.archivos[0].blob.arrayBuffer())).toEqual(bytes);
});
it('convierte a PNG o JPG conservando dimensiones',async()=>{
  const {entrada}=documento(false);
  for(const formato of ['original','PNG','JPEG']) {
    const r=await ejecutarPdf(m,{slug:'extraer-imagenes',archivos:[entrada],opciones:{formato}},()=>{});
    const img=new m.Image(await r.archivos[0].blob.arrayBuffer());
    expect(img.getWidth()).toBe(120);expect(img.getHeight()).toBe(100);img.destroy();
  }
});
it('aplica el tamaño mínimo y valida opciones',async()=>{
  const {entrada}=documento(true);
  const run=(opciones:Record<string,unknown>)=>ejecutarPdf(m,{slug:'extraer-imagenes',archivos:[entrada],opciones},()=>{});
  await expect(run({lado_minimo:121})).rejects.toThrow('ninguna imagen');
  await expect(run({lado_minimo:-1})).rejects.toThrow('mínimo');
  await expect(run({formato:'TIFF'})).rejects.toThrow('formato');
});
