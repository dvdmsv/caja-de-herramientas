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

export async function ocrPdf(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un PDF.');
  const idioma=p.opciones['idioma']??'spa+eng',rehacer=p.opciones['rehacer']??false;
  if(!['spa','eng','spa+eng'].includes(String(idioma))||typeof rehacer!=='boolean')throw new Error('Las opciones de OCR no son válidas.');
  const doc=await abrirPdf(m,p.archivos[0]);let worker:WorkerOCR|undefined;
  try {
    for(let n=0;n<doc.countPages();n++) {
      let page=doc.loadPage(n);
      try {
        const text=page.toStructuredText('');let hayTexto=false;
        try{hayTexto=Boolean(text.asText().trim());}finally{text.destroy();}
        if(hayTexto&&!rehacer){avance(n+1,doc.countPages());continue;}
        let visibles:MuPDF.Rect[]=[];
        if(rehacer){page.destroy();visibles=quitarTextoInvisible(m,doc,n);page=doc.loadPage(n);}
        const box=page.getBounds(),scale=Math.min(200/72,Math.sqrt(20_000_000/((box[2]-box[0])*(box[3]-box[1]))));
        const pix=page.toPixmap(m.Matrix.scale(scale,scale),m.ColorSpace.DeviceRGB,false,false);
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
        if(!worker) {
          const assets=new URL('/assets/ocr/',self.location.origin).href;
          worker=await createWorker(String(idioma),OEM.LSTM_ONLY,{workerPath:assets+'worker.min.js',corePath:assets,langPath:assets,gzip:false,cacheMethod:'none',workerBlobURL:false});
        }
        await worker.setParameters({user_defined_dpi:String(Math.round(scale*72))});
        const result=await worker.recognize(new Blob([png]),{pdfTextOnly:true},{pdf:true,text:true});
        if(result.data.pdf&&result.data.text.trim()) {
          const layer=new m.PDFDocument(Uint8Array.from(result.data.pdf));
          try{incorporar(m,doc,n,layer);}finally{layer.destroy();}
        }
        avance(n+1,doc.countPages());
      }finally{page.destroy();}
    }
    // MuPDF 1.28.1 puede deduplicar incorrectamente Forms recién injertados.
    // Recoger objetos sin fusionarlos conserva la estructura y el contenido.
    const blob=guardarPdf(doc,rehacer?{garbage:2}:{});
    if(blob.size>250*1024*1024)throw new Error('El PDF reconocido supera 250 MB.');
    return {archivos:[{name:base(p.archivos[0].name)+'-con-texto.pdf',blob}]};
  }finally{doc.destroy();await worker?.terminate();}
}
