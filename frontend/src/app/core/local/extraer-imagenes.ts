import type * as MuPDF from 'mupdf';
import type { EntradaMotor, OpcionesMotor } from './tipos';
import { CUOTA_LOCAL, MAXIMO_PIXELES } from './catalogo';

/** Recorre recursos de páginas y formularios XObject sin duplicar imágenes compartidas. */
export function extraerImagenes(m: typeof MuPDF, doc: MuPDF.PDFDocument, nombre: string,
                               o: OpcionesMotor, avance: (hechos:number,total:number)=>void): EntradaMotor[] {
  const formato=String(o['formato']??'original'),minimo=Number(o['lado_minimo']??100);
  if(!['original','PNG','JPEG'].includes(formato))throw new Error('Elige formato original, PNG o JPG.');
  if(!Number.isInteger(minimo)||minimo<0||minimo>2000)throw new Error('El tamaño mínimo debe estar entre 0 y 2000 píxeles.');
  const vistas=new Set<number>(),formularios=new Set<number>(),extraidas:{ext:string;blob:Blob}[]=[];
  let bytes=0;
  const recoger=(resources:MuPDF.PDFObject,depth=0):void=>{
    if(depth>64)throw new Error('El PDF tiene una estructura de imágenes demasiado profunda.');
    const objects=resources.get('XObject');
    try {
      objects.forEach(obj=>{
        if(extraidas.length>=300)return;
        const id=obj.asIndirect(),subtype=obj.get('Subtype');
        try {
          if(subtype.asName()==='Form') {
            if(formularios.has(id))return;
            formularios.add(id);
            const nested=obj.get('Resources');try {recoger(nested,depth+1);}finally{nested.destroy();}
          } else if(subtype.asName()==='Image') {
            if(vistas.has(id))return;
            vistas.add(id);
            const w=obj.get('Width'),h=obj.get('Height');
            const ancho=w.asNumber(),alto=h.asNumber();w.destroy();h.destroy();
            if(Math.min(ancho,alto)<minimo)return;
            if(ancho*alto>MAXIMO_PIXELES)throw new Error('Una imagen supera 20 megapíxeles.');
            const filter=obj.get('Filter');
            const filtro=filter.isArray()&&filter.length===1?filter.get(0).asName():filter.asName();
            filter.destroy();
            let blob:Blob,ext:string;
            if(formato==='original'&&['DCTDecode','JPXDecode'].includes(filtro)) {
              const buffer=obj.readRawStream();
              try {ext=filtro==='DCTDecode'?'jpg':'jpx';blob=new Blob([buffer.asUint8Array().slice()],{type:filtro==='DCTDecode'?'image/jpeg':'image/jp2'});}
              finally{buffer.destroy();}
            } else {
              const image=doc.loadImage(obj);
              try {
                const original=image.toPixmap();
                try {
                  const pix=original.convertToColorSpace(m.ColorSpace.DeviceRGB,false);
                  try {
                    ext=formato==='JPEG'?'jpg':'png';
                    const data=formato==='JPEG'?pix.asJPEG(90):pix.asPNG();
                    blob=new Blob([data.slice()],{type:formato==='JPEG'?'image/jpeg':'image/png'});
                  } finally{pix.destroy();}
                } finally{original.destroy();}
              } finally{image.destroy();}
            }
            bytes+=blob.size;if(bytes>CUOTA_LOCAL)throw new Error('Las imágenes extraídas superan 250 MB.');
            extraidas.push({ext,blob});
          }
        } finally{subtype.destroy();}
      });
    } finally{objects.destroy();}
  };
  for(let n=0;n<doc.countPages()&&extraidas.length<300;n++) {
    const page=doc.findPage(n),resources=page.getInheritable('Resources');
    try{recoger(resources);}finally{resources.destroy();page.destroy();}
    avance(n+1,doc.countPages());
  }
  if(!extraidas.length)throw new Error('No se ha encontrado ninguna imagen de ese tamaño. Prueba a bajar el tamaño mínimo.');
  const ancho=String(extraidas.length).length,base=nombre.replace(/\.[^.]+$/,'');
  return extraidas.map((r,i)=>({name:`${base}-imagen-${String(i+1).padStart(ancho,'0')}.${r.ext}`,blob:r.blob}));
}
