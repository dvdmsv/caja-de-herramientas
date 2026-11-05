import type * as MuPDF from 'mupdf';
import {createWorker,OEM,type Worker as WorkerOCR} from 'tesseract.js';
import {abrirPdf,guardarPdf,base} from './pdf';
import {estampar} from './marca';
import type {PeticionMotor,ResultadoMotor} from './tipos';

/** Inserta una página PDF como Form, adaptando su sistema de coordenadas. */
export function incorporar(m:typeof MuPDF,destino:MuPDF.PDFDocument,n:number,origen:MuPDF.PDFDocument) {
  const page=origen.loadPage(0),target=destino.loadPage(n),obj=origen.findPage(0),map=destino.newGraftMap();
  try {
    const bounds=page.getBounds(),box=target.getBounds();
    let matrix=m.Matrix.concat(page.getTransform(),m.Matrix.translate(-bounds[0],-bounds[1]));
    matrix=m.Matrix.concat(matrix,m.Matrix.scale((box[2]-box[0])/(bounds[2]-bounds[0]),(box[3]-box[1])/(bounds[3]-bounds[1])));
    matrix=m.Matrix.concat(matrix,m.Matrix.translate(box[0],box[1]));
    const contents=obj.get('Contents'),originalResources=obj.getInheritable('Resources');
    const resources=map.graftObject(originalResources);
    try {
      let texto='';
      const leer=(stream:MuPDF.PDFObject)=>{const buf=stream.readStream();try{texto+=buf.asString()+'\n';}finally{buf.destroy();}};
      if(contents.isArray())for(let i=0;i<contents.length;i++){const s=contents.get(i);try{leer(s);}finally{s.destroy();}}
      else if(!contents.isNull())leer(contents);
      estampar(m,destino,n,`q ${matrix.join(' ')} cm\n${texto}\nQ`,resources as unknown as Record<string,unknown>);
    }finally{contents.destroy();originalResources.destroy();resources.destroy();}
  }finally{page.destroy();target.destroy();obj.destroy();map.destroy();}
}

/** Reescribe sólo los contenidos: conserva anotaciones, enlaces y geometría originales. */
export function quitarTextoInvisible(m:typeof MuPDF,doc:MuPDF.PDFDocument,n:number):MuPDF.Rect[] {
  const page=doc.loadPage(n),buffer=new m.Buffer(),writer=new m.DocumentWriter(buffer,'pdf','compress');
  const visibles:MuPDF.Rect[]=[];
  const stroke=new m.StrokeState({lineCap:'Butt',lineJoin:'Miter',lineWidth:0,miterLimit:10});
  try {
    const output=writer.beginPage(page.getBounds());
    const callbacks:Record<string,(...args:any[])=>any>={};
    for(const name of ['fillPath','strokePath','clipPath','clipStrokePath','clipText','clipStrokeText','fillShade','fillImage','fillImageMask','clipImageMask','popClip','beginMask','endMask','beginGroup','endGroup','beginTile','endTile','beginLayer','endLayer'])callbacks[name]=(...args:any[])=>(output as any)[name](...args);
    callbacks['ignoreText']=()=>{};
    callbacks['fillText']=(text:MuPDF.Text,ctm:MuPDF.Matrix,cs:MuPDF.ColorSpace,color:number[],alpha:number)=>{
      if(alpha>0){visibles.push(text.getBounds(stroke,ctm));output.fillText(text,ctm,cs,color,alpha);}
    };
    callbacks['strokeText']=(text:MuPDF.Text,s:MuPDF.StrokeState,ctm:MuPDF.Matrix,cs:MuPDF.ColorSpace,color:number[],alpha:number)=>{
      if(alpha>0){visibles.push(text.getBounds(s,ctm));output.strokeText(text,s,ctm,cs,color,alpha);}
    };
    const device=new m.Device(callbacks);
    try {page.runPageContents(device,m.Matrix.identity);device.close();}finally{device.destroy();output.destroy();}
    writer.endPage();writer.close();
    const limpio=new m.PDFDocument(buffer),obj=doc.findPage(n);
    try {obj.delete('Contents');incorporar(m,doc,n,limpio);}finally{obj.destroy();limpio.destroy();}
    return visibles;
  }finally{stroke.destroy();writer.destroy();buffer.destroy();page.destroy();}
}

/**
 * Cuántos Tesseract a la vez. Reconocer es lo lento y cada página es
 * independiente, así que se reparten. Medido en un OnePlus 6 (8 núcleos,
 * 8 GB) con 40 páginas A4 escaneadas: 186 s con uno, 104 con dos, 80 con tres,
 * y con cuatro el WebView se queda sin memoria (`pixdata_malloc fail`): todos
 * reservan la suya de WebAssembly en el mismo proceso. De ahí el tope de tres,
 * y menos con poca memoria. Lo que de verdad ocupa es el tamaño de cada página:
 * eso lo limita además `PIXELES_A_LA_VEZ`.
 */
export function trabajadoresOcr(nucleos: number | undefined, memoriaGb: number | undefined): number {
  const porNucleos = Math.floor((nucleos || 2) / 2);
  const porMemoria = memoriaGb === undefined ? 3 : memoriaGb < 2 ? 1 : memoriaGb < 4 ? 2 : 3;
  return Math.max(1, Math.min(3, porNucleos, porMemoria));
}

/**
 * Píxeles reconociéndose a la vez. Tres A4 a 200 ppp son unos 11,7 Mpx y caben;
 * una página puede llegar a 20 Mpx, y ésa va sola.
 */
export const PIXELES_A_LA_VEZ = 12_000_000;

/** Si una página más cabe con las que ya se están reconociendo. La primera cabe siempre. */
export function cabeOtra(enCurso: number, pixelesEnCurso: number, pixeles: number, maximo: number): boolean {
  return enCurso === 0 || (enCurso < maximo && pixelesEnCurso + pixeles <= PIXELES_A_LA_VEZ);
}

export async function ocrPdf(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un PDF.');
  const idioma=p.opciones['idioma']??'spa+eng',rehacer=p.opciones['rehacer']??false;
  if(!['spa','eng','spa+eng'].includes(String(idioma))||typeof rehacer!=='boolean')throw new Error('Las opciones de OCR no son válidas.');
  const doc=await abrirPdf(m,p.archivos[0]);
  const maximo=trabajadoresOcr(navigator.hardwareConcurrency,(navigator as {deviceMemory?:number}).deviceMemory);
  const creados:WorkerOCR[]=[],libres:WorkerOCR[]=[];
  const crear=async()=>{
    const assets=new URL('/assets/ocr/',self.location.origin).href;
    const w=await createWorker(String(idioma),OEM.LSTM_ONLY,{workerPath:assets+'worker.min.js',corePath:assets,langPath:assets,gzip:false,cacheMethod:'none',workerBlobURL:false});
    creados.push(w);return w;
  };
  // Las capas de texto reconocidas, por página. Se incorporan al final y en
  // orden: son PDF de pocos KB y así MuPDF sólo toca el documento desde aquí.
  const capas=new Map<number,Uint8Array>();
  const enCurso=new Set<Promise<void>>();
  const total=doc.countPages();let hechos=0,pixelesEnCurso=0;
  const contar=()=>{hechos++;avance(hechos,total);};
  try {
    for(let n=0;n<total;n++) {
      let page=doc.loadPage(n);
      try {
        const text=page.toStructuredText('');let hayTexto=false;
        try{hayTexto=Boolean(text.asText().trim());}finally{text.destroy();}
        if(hayTexto&&!rehacer){contar();continue;}
        let visibles:MuPDF.Rect[]=[];
        if(rehacer){page.destroy();visibles=quitarTextoInvisible(m,doc,n);page=doc.loadPage(n);}
        const box=page.getBounds(),scale=Math.min(200/72,Math.sqrt(20_000_000/((box[2]-box[0])*(box[3]-box[1]))));
        const pix=page.toPixmap(m.Matrix.scale(scale,scale),m.ColorSpace.DeviceRGB,false,false);
        const ancho=pix.getWidth(),alto=pix.getHeight();
        let png:Uint8Array<ArrayBuffer>;
        try {
          const pixels=pix.getPixels(),stride=pix.getStride();
          for(const r of visibles) {
            const x0=Math.max(0,Math.floor(r[0]*scale)-pix.getX()),x1=Math.min(pix.getWidth(),Math.ceil(r[2]*scale)-pix.getX());
            const y0=Math.max(0,Math.floor(r[1]*scale)-pix.getY()),y1=Math.min(pix.getHeight(),Math.ceil(r[3]*scale)-pix.getY());
            for(let y=y0;y<y1;y++)pixels.fill(255,y*stride+x0*3,y*stride+x1*3);
          }
          png=pix.asPNG().slice();
        }finally{pix.destroy();}
        // Hueco: no reconocer más de lo que cabe en memoria a la vez (ni
        // acumular imágenes rasterizadas esperando turno).
        const pixeles=ancho*alto;
        while(!cabeOtra(enCurso.size,pixelesEnCurso,pixeles,maximo))await Promise.race(enCurso);
        pixelesEnCurso+=pixeles;
        const pagina=n,dpi=String(Math.round(scale*72));
        const tarea=(async()=>{
          const w=libres.pop()??await crear();
          try {
            await w.setParameters({user_defined_dpi:dpi});
            const result=await w.recognize(new Blob([png]),{pdfTextOnly:true},{pdf:true,text:true});
            if(result.data.pdf&&result.data.text.trim())capas.set(pagina,Uint8Array.from(result.data.pdf));
          }finally{libres.push(w);pixelesEnCurso-=pixeles;}
          contar();
        })();
        enCurso.add(tarea);
        // Quitarla al acabar, también si falla: el fallo lo recoge el Promise.all de abajo.
        void tarea.then(()=>enCurso.delete(tarea),()=>enCurso.delete(tarea));
      }finally{page.destroy();}
    }
    await Promise.all(enCurso);
    for(const n of [...capas.keys()].sort((a,b)=>a-b)) {
      const layer=new m.PDFDocument(capas.get(n)!);
      try{incorporar(m,doc,n,layer);}finally{layer.destroy();}
    }
    // MuPDF 1.28.1 puede deduplicar incorrectamente Forms recién injertados.
    // Recoger objetos sin fusionarlos conserva la estructura y el contenido.
    const blob=guardarPdf(doc,rehacer?{garbage:2}:{});
    if(blob.size>250*1024*1024)throw new Error('El PDF reconocido supera 250 MB.');
    return {archivos:[{name:base(p.archivos[0].name)+'-con-texto.pdf',blob}]};
  }finally{
    // Si una página falla, las que siguen en marcha no deben quedar colgando.
    await Promise.allSettled(enCurso);
    doc.destroy();
    await Promise.all(creados.map(w=>w.terminate()));
  }
}
