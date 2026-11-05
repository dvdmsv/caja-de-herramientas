import type * as MuPDF from 'mupdf';
import {abrirPdf} from './pdf';
import {prepararFirma} from './firma';
import type {PeticionMotor,ResultadoMotor} from './tipos';

export async function aparienciaCertificado(m:typeof MuPDF,p:PeticionMotor):Promise<ResultadoMotor> {
  const o=p.opciones,visible=o['visible']??true;
  if(typeof visible!=='boolean'||(o['sello_tiempo']!==undefined&&typeof o['sello_tiempo']!=='boolean'))throw new Error('Las opciones de firma no son válidas.');
  const datos=o['datos_certificado'] as Record<string,unknown>|undefined;
  if(!datos||typeof datos['nombre']!=='string')throw new Error('Selecciona un certificado.');
  for(const clave of ['motivo','lugar'])if(o[clave]!==undefined&&(typeof o[clave]!=='string'||String(o[clave]).length>120))throw new Error('El motivo y el lugar admiten hasta 120 caracteres.');
  const motivo=String(o['motivo']??'').replace(/[\r\n]/g,' '),lugar=String(o['lugar']??'').replace(/[\r\n]/g,' ');
  const lineas=['Firmado digitalmente por',String(datos['nombre']),String(o['fecha_firma']??new Date().toISOString()),...(motivo?['Motivo: '+motivo]:[]),...(lugar?['Lugar: '+lugar]:[])];
  const medir=new OffscreenCanvas(1,1).getContext('2d')!;medir.font='16px sans-serif';
  const textWidth=Math.ceil(Math.max(...lineas.map(l=>medir.measureText(l).width)))+24;
  const trazo=p.recursos?.['trazo_id']?await prepararFirma(p.recursos['trazo_id'].blob,o['quitar_fondo']!==false,Number(o['umbral']??240)):undefined;
  const ancho=Math.min(2500,trazo?Math.ceil(textWidth/0.62):textWidth),alto=Math.max(lineas.length*20+24,trazo?Math.ceil(ancho*0.34):0);
  const canvas=new OffscreenCanvas(ancho,alto),ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,ancho,alto);ctx.fillStyle='#111';ctx.font='16px sans-serif';
  const textX=trazo?Math.round(ancho*0.38):12;
  for(const [i,linea] of lineas.entries())ctx.fillText(linea,textX,24+i*20,ancho-textX-12);
  if(trazo){const scale=Math.min((textX-18)/trazo.width,(alto-24)/trazo.height);ctx.drawImage(trazo,6+(textX-18-trazo.width*scale)/2,(alto-trazo.height*scale)/2,trazo.width*scale,trazo.height*scale);}
  let png=await canvas.convertToBlob({type:'image/png'});
  if(p.slug.endsWith('/apariencia'))return {archivos:[{name:'apariencia.png',blob:png}]};
  if(!p.archivos.length)throw new Error('Selecciona un PDF.');
  const doc=await abrirPdf(m,p.archivos[0]);
  try {
    const pagina=Number(o['pagina']??1),x=Number(o['x']??0.5),y=Number(o['y']??0.85),fraccion=Number(o['ancho']??0.35);
    if(!Number.isInteger(pagina)||pagina<1||pagina>doc.countPages()||![x,y,fraccion].every(Number.isFinite)||x<0||x>1||y<0||y>1||fraccion<0.12||fraccion>1)throw new Error('La colocación de la firma no es válida.');
    if(!visible)return {archivos:[],datos:{pagina,recuadro:null}};
    const page=doc.loadPage(pagina-1);
    try {
      const [x0,y0,x1,y1]=page.getBounds(),w=(x1-x0)*fraccion,h=w*alto/ancho;
      const left=x0+x*(x1-x0)-w/2,top=y0+y*(y1-y0)-h/2;
      if(left<x0||top<y0||left+w>x1||top+h>y1)throw new Error('El sello no cabe en la página. Reduce su tamaño o mueve su posición.');
      const matrix=m.Matrix.invert(page.getTransform());
      const corners=[[left,top],[left+w,top],[left,top+h],[left+w,top+h]].map(([a,b])=>[a*matrix[0]+b*matrix[2]+matrix[4],a*matrix[1]+b*matrix[3]+matrix[5]]);
      const recuadro=[Math.min(...corners.map(c=>c[0])),Math.min(...corners.map(c=>c[1])),Math.max(...corners.map(c=>c[0])),Math.max(...corners.map(c=>c[1]))];
      const obj=doc.findPage(pagina-1),rotate=obj.getInheritable('Rotate');
      let giro=0;try{giro=((rotate.asNumber()%360)+360)%360;}finally{rotate.destroy();obj.destroy();}
      if(giro) {
        const rotated=new OffscreenCanvas(giro===180?ancho:alto,giro===180?alto:ancho),rctx=rotated.getContext('2d')!;
        rctx.translate(rotated.width/2,rotated.height/2);rctx.rotate(-giro*Math.PI/180);rctx.drawImage(canvas,-ancho/2,-alto/2);
        png=await rotated.convertToBlob({type:'image/png'});
      }
      return {archivos:[{name:'apariencia.png',blob:png}],datos:{pagina,recuadro}};
    }finally{page.destroy();}
  }finally{doc.destroy();}
}
