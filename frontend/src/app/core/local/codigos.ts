import type * as MuPDF from 'mupdf';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { abrirPdf } from './pdf';
import { MAXIMO_PIXELES } from './catalogo';
import { lienzo } from './imagenes';
import type { PeticionMotor, ResultadoMotor } from './tipos';

export function configurarCodigos(wasm?: ArrayBuffer): void {
  prepareZXingModule({ overrides: wasm ? { wasmBinary: wasm } : {
    locateFile: () => new URL('/assets/zxing/zxing_reader.wasm', self.location.origin).href,
  } });
}
export function claseCodigo(texto: string): string {
  const t=texto.toUpperCase();
  if(t.startsWith('WIFI:'))return 'wifi';
  if(t.startsWith('BEGIN:VCARD')||t.startsWith('MECARD:'))return 'contacto';
  if(t.startsWith('MAILTO:'))return 'correo';
  if(t.startsWith('TEL:')||t.startsWith('SMSTO:'))return 'telefono';
  if(t.startsWith('HTTP://')||t.startsWith('HTTPS://'))return 'enlace';
  if(t.startsWith('BEGIN:VEVENT'))return 'evento';
  return 'texto';
}
export async function decodificar(bytes: Uint8Array | ImageData) {
  return (await readBarcodes(bytes, { maxNumberOfSymbols: 100, tryHarder: true }))
    .filter(r=>r.isValid&&r.text).slice(0,100).map(r=>({formato:r.format,contenido:r.text,clase:claseCodigo(r.text)}));
}
export async function leerCodigos(m: typeof MuPDF, p: PeticionMotor,
                                 avance: (hechos: number,total: number)=>void): Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona una imagen o un PDF.');
  configurarCodigos();
  let presupuesto=30;
  const informes=[];
  for(const [i,entrada] of p.archivos.entries()) {
    const codigos: {formato:string;contenido:string;clase:string;pagina?:number}[]=[];
    if(/\.pdf$/i.test(entrada.name)) {
      const doc=await abrirPdf(m,entrada);
      try {
        for(let n=0;n<doc.countPages()&&presupuesto>0&&codigos.length<100;n++,presupuesto--) {
          const page=doc.loadPage(n);
          try {
            const [x0,y0,x1,y1]=page.getBounds(),scale=150/72;
            if((x1-x0)*(y1-y0)*scale**2>MAXIMO_PIXELES)throw new Error('La página supera 20 megapíxeles.');
            const pix=page.toPixmap(m.Matrix.scale(scale,scale),m.ColorSpace.DeviceRGB,false);
            try { codigos.push(...(await decodificar(pix.asPNG().slice())).map(c=>({...c,pagina:n+1}))); }
            finally {pix.destroy();}
          } finally {page.destroy();}
        }
      } finally {doc.destroy();}
    } else {
      const canvas=await lienzo(entrada.blob),ctx=canvas.getContext('2d')!;
      codigos.push(...await decodificar(ctx.getImageData(0,0,canvas.width,canvas.height)));
      if(!codigos.length&&Math.max(canvas.width,canvas.height)<1000) {
        const doble=new OffscreenCanvas(canvas.width*2,canvas.height*2),c=doble.getContext('2d')!;
        c.drawImage(canvas,0,0,doble.width,doble.height);
        codigos.push(...await decodificar(c.getImageData(0,0,doble.width,doble.height)));
      }
    }
    informes.push({id:p.opciones.file_ids?.[i],archivo:entrada.name,codigos:codigos.slice(0,100)});
    avance(i+1,p.archivos.length);
  }
  return {archivos:[],datos:{informes}};
}
