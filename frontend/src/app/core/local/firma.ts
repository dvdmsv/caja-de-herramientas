import type * as MuPDF from 'mupdf';
import { lienzo } from './imagenes';
import { abrirPdf, base, guardarPdf } from './pdf';
import { estampar } from './marca';
import type { PeticionMotor, ResultadoMotor } from './tipos';

export async function prepararFirma(blob: Blob, quitar: boolean, umbral: number): Promise<OffscreenCanvas> {
  if(!Number.isInteger(umbral)||umbral<200||umbral>255)throw new Error('El umbral debe estar entre 200 y 255.');
  const canvas=await lienzo(blob),ctx=canvas.getContext('2d')!,data=ctx.getImageData(0,0,canvas.width,canvas.height);
  let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
    const i=(y*canvas.width+x)*4;
    if(quitar) {
      const gris=Math.round(data.data[i]*0.299+data.data[i+1]*0.587+data.data[i+2]*0.114);
      data.data[i+3]=Math.floor(data.data[i+3]*Math.min(1,Math.max(0,(umbral-gris)/30)));
    }
    if(data.data[i+3]) {x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  }
  if(x1-x0<1||y1-y0<1)throw new Error('Al quitar el fondo no ha quedado nada de la firma. Prueba a bajar el umbral.');
  ctx.putImageData(data,0,0);
  const salida=new OffscreenCanvas(x1-x0+1,y1-y0+1);
  salida.getContext('2d')!.drawImage(canvas,x0,y0,salida.width,salida.height,0,0,salida.width,salida.height);
  return salida;
}
export async function firmarLocal(m: typeof MuPDF,p: PeticionMotor,avance:(hechos:number,total:number)=>void):Promise<ResultadoMotor> {
  const firma=p.recursos?.['firma_id'];
  if(!firma)throw new Error('Sube o dibuja la firma.');
  const o=p.opciones,canvas=await prepararFirma(firma.blob,o['quitar_fondo']!==false,Number(o['umbral']??240));
  const png=await canvas.convertToBlob({type:'image/png'});
  if(p.slug==='firmar/preparar')return {archivos:[{name:'firma.png',blob:png}]};
  const numero=(k:string,d:number,min:number,max:number)=>{
    const n=Number(o[k]??d);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`El valor de ${k} no es válido.`);return n;
  };
  const x=numero('x',0.5,0,1),y=numero('y',0.8,0,1),ancho=numero('ancho',0.25,0.05,1),giro=numero('rotacion',0,-180,180)*Math.PI/180;
  if(!p.archivos.length)throw new Error('Selecciona un documento.');
  const archivos=[];
  for(const [i,entrada] of p.archivos.entries()) {
    if(/\.pdf$/i.test(entrada.name)) {
      const doc=await abrirPdf(m,entrada),img=new m.Image(await png.arrayBuffer());
      try {
        const pagina=numero('pagina',1,1,100000);
        if(!Number.isInteger(pagina)||(!o['todas']&&pagina>doc.countPages()))throw new Error('La página seleccionada no existe.');
        const ref=doc.addImage(img);
        try {
          for(let n=0;n<doc.countPages();n++) {
            if(!o['todas']&&n!==pagina-1)continue;
            const page=doc.loadPage(n),[x0,y0,x1,y1]=page.getBounds();page.destroy();
            const w=(x1-x0)*ancho,h=w*canvas.height/canvas.width,c=Math.cos(giro),s=Math.sin(giro);
            const command=`q ${c} ${s} ${-s} ${c} ${x0+x*(x1-x0)} ${y0+y*(y1-y0)} cm ${w} 0 0 ${-h} ${-w/2} ${h/2} cm /Im Do Q`;
            estampar(m,doc,n,command,{XObject:{Im:ref}});
          }
        } finally {ref.destroy();}
        archivos.push({name:base(entrada.name)+'-firmado.pdf',blob:guardarPdf(doc)});
      } finally {img.destroy();doc.destroy();}
    } else {
      const destino=await lienzo(entrada.blob),ctx=destino.getContext('2d')!,w=destino.width*ancho,h=w*canvas.height/canvas.width;
      ctx.save();ctx.translate(x*destino.width,y*destino.height);ctx.rotate(giro);ctx.drawImage(canvas,-w/2,-h/2,w,h);ctx.restore();
      const tipo=['image/jpeg','image/webp'].includes(entrada.blob.type)?entrada.blob.type:'image/png';
      if(tipo==='image/jpeg'){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,destino.width,destino.height);}
      const blob=await destino.convertToBlob({type:tipo,quality:0.95});
      if(blob.type!==tipo)throw new Error('El formato de imagen no está disponible.');
      archivos.push({name:base(entrada.name)+'-firmado.'+(tipo==='image/jpeg'?'jpg':tipo==='image/webp'?'webp':'png'),blob});
    }
    avance(i+1,p.archivos.length);
  }
  return {archivos};
}
