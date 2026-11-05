import type * as MuPDF from 'mupdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';
import {abrirPdf,guardarPdf,base} from './pdf';
import {MAXIMO_PIXELES,CUOTA_LOCAL} from './catalogo';
const pasos:(readonly [number,number]|null)[]=[null,[85,2200],[75,1800],[65,1500],[55,1200],[45,1000],[35,800],[25,600]];
const niveles:Record<string,readonly [number,number]|null>={ninguno:null,suave:[85,2200],media:[70,1600],fuerte:[45,1100]};

/** Compresión local. La linearización requiere completar el adaptador qpdf. */
export async function comprimirPdf(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un PDF.');
  const nivel=String(p.opciones['nivel']??'media'),objetivo=Number(p.opciones['objetivo_mb']??0);
  if(!Object.hasOwn(niveles,nivel)||!Number.isFinite(objetivo)||objetivo<0||objetivo>1000)throw new Error('Los ajustes de compresión no son válidos.');
  if(p.opciones['web']!==undefined&&typeof p.opciones['web']!=='boolean')throw new Error('La opción web no es válida.');
  if(p.opciones['web'])throw new Error('La optimización para web está pendiente de integrar qpdf en Android.');
  const entrada=p.archivos[0];
  // Validar incluso si el original ya cabe en el tamaño solicitado.
  const validar=await abrirPdf(m,entrada);validar.destroy();
  const pasada=async(ajuste:readonly [number,number]|null):Promise<Blob>=>{
    const doc=await abrirPdf(m,entrada);
    try {
      const total=doc.countObjects();
      const mascaras=new Set<number>();
      if(ajuste)for(let i=1;i<total;i++) {
        const obj=doc.newIndirect(i);
        try {
          for(const key of ['SMask','Mask']) {
            const mask=obj.get(key);
            try{if(mask.isIndirect()&&mask.isStream())mascaras.add(mask.asIndirect());}finally{mask.destroy();}
          }
        }finally{obj.destroy();}
      }
      if(ajuste)for(let i=1;i<total;i++) {
        if(mascaras.has(i))continue;
        const obj=doc.newIndirect(i);
        try {
          const sub=obj.get('Subtype'),mask=obj.get('SMask'),hard=obj.get('Mask'),stencil=obj.get('ImageMask');
          let sirve=false;
          try{sirve=sub.asName()==='Image'&&mask.isNull()&&hard.isNull()&&!stencil.asBoolean();}
          finally{sub.destroy();mask.destroy();hard.destroy();stencil.destroy();}
          if(!sirve||!obj.isStream())continue;
          const raw=obj.readRawStream();let anterior:number;
          try{anterior=raw.length;}finally{raw.destroy();}
          if(anterior<20*1024)continue;
          const image=doc.loadImage(obj);
          try {
            const w=image.getWidth(),h=image.getHeight();
            if(Math.min(w,h)<80)continue;
            if(w*h>MAXIMO_PIXELES)throw new Error('Una imagen supera 20 megapíxeles.');
            const original=image.toPixmap();
            try {
              const rgb=original.convertToColorSpace(m.ColorSpace.DeviceRGB,false);
              let reducido:MuPDF.Pixmap|undefined;
              try {
                const escala=Math.min(1,ajuste[1]/Math.max(w,h));
                if(escala<1)reducido=rgb.warp([[0,0],[w,0],[w,h],[0,h]],Math.max(1,Math.round(w*escala)),Math.max(1,Math.round(h*escala)));
                const pix=reducido??rgb,jpeg=pix.asJPEG(ajuste[0]).slice();
                if(jpeg.length<anterior) {
                  obj.put('Width',pix.getWidth());obj.put('Height',pix.getHeight());obj.put('BitsPerComponent',8);
                  obj.put('ColorSpace','DeviceRGB');obj.put('Filter','DCTDecode');
                  obj.delete('Decode');obj.delete('DecodeParms');obj.writeRawStream(jpeg);
                }
              }finally{reducido?.destroy();rgb.destroy();}
            }finally{original.destroy();}
          }finally{image.destroy();}
        }finally{obj.destroy();}
        avance(i,total);
      }
      const blob=guardarPdf(doc,{'compress-images':true,'compress-fonts':true,'regenerate-id':false});
      if(blob.size>CUOTA_LOCAL)throw new Error('El resultado supera 250 MB.');
      return blob.size<entrada.blob.size?blob:entrada.blob;
    }finally{doc.destroy();}
  };
  if(p.slug.endsWith('/paso')) {
    const paso=Number(p.opciones['paso']);
    if(!Number.isInteger(paso)||paso<0||paso>=pasos.length)throw new Error('El paso de compresión no es válido.');
    const blob=await pasada(pasos[paso]);
    return {archivos:[{name:base(entrada.name)+'-comprimido.pdf',blob}]};
  }
  if(p.slug.endsWith('/minimo')) {
    const blob=await pasada(pasos.at(-1)!);
    return {archivos:[],datos:{minimo:blob.size,original:entrada.blob.size}};
  }
  const bytes=Math.floor(objetivo*1024*1024);let blob=entrada.blob;
  if(bytes>0) {
    if(blob.size>bytes) {
      let menor=blob;
      // Recorrer desde el nivel más suave evita asumir monotonicidad del JPEG.
      for(let i=0;i<pasos.length;i++) {
        const candidato=await pasada(pasos[i]);
        if(candidato.size<menor.size)menor=candidato;
        avance(i+1,pasos.length);
        if(candidato.size<=bytes){menor=candidato;break;}
      }
      blob=menor;
    }
  }else blob=await pasada(niveles[nivel]);
  return {archivos:[{name:base(entrada.name)+'-comprimido.pdf',blob}],resumen:{antes:entrada.blob.size,despues:blob.size},...(bytes?{objetivo:{bytes,logrado:blob.size<=bytes}}:{})};
}
