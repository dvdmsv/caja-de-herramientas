import type * as MuPDF from 'mupdf';
import {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,ImageRun,WidthType,PageBreak} from 'docx';
import {abrirPdf,base} from './pdf';
import {estructuraPdf} from './estructura-pdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';

export async function pdfWord(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona al menos un PDF.');
  const archivos:ResultadoMotor['archivos']=[];
  let bytes=0;
  for(const entrada of p.archivos) {
    const pdf=await abrirPdf(m,entrada);
    try {
      const paginas=estructuraPdf(m,pdf,true,avance);
      if(!paginas.some(p=>p.lineas.length))throw new Error('El PDF no contiene texto. Pásalo antes por PDF con OCR.');
      const children:Array<Paragraph|Table>=[];
      for(const [i,page] of paginas.entries()) {
        if(i)children.push(new Paragraph({children:[new PageBreak()]}));
        const elementos:Array<{x:number;y:number;obj:Paragraph|Table}>=[];
        for(const l of page.lineas) {
          const x=(l.caja[0]+l.caja[2])/2,y=(l.caja[1]+l.caja[3])/2;
          if(page.tablas.some(t=>x>=t.caja[0]&&x<t.caja[2]&&y>=t.caja[1]&&y<t.caja[3]))continue;
          elementos.push({x:l.caja[0],y:l.caja[1],obj:new Paragraph({
            children:l.tramos.map(t=>new TextRun({text:t.texto,bold:t.negrita,italics:t.cursiva,size:Math.max(2,Math.round(t.tamano*2)),font:t.mono?'Courier New':'Calibri'})),
            spacing:{after:80},
          })});
        }
        for(const tabla of page.tablas)elementos.push({x:tabla.caja[0],y:tabla.caja[1],obj:new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:tabla.filas.map(f=>new TableRow({children:f.map(text=>new TableCell({children:[new Paragraph({children:[new TextRun(text)]})]}))}))})});
        for(const img of page.imagenes) {
          const w=(img.caja[2]-img.caja[0])*96/72,h=(img.caja[3]-img.caja[1])*96/72;
          if(w<=0||h<=0)continue;
          const escala=Math.min(1,600/w);
          elementos.push({x:img.caja[0],y:img.caja[1],obj:new Paragraph({children:[new ImageRun({type:'png',data:img.datos,transformation:{width:Math.max(1,Math.round(w*escala)),height:Math.max(1,Math.round(h*escala))}})]})});
        }
        children.push(...elementos.sort((a,b)=>a.y-b.y||a.x-b.x).map(e=>e.obj));
      }
      const doc=new Document({title:pdf.getMetaData('info:Title')??base(entrada.name),creator:pdf.getMetaData('info:Author')??'',sections:[{children}]});
      const blob=await Packer.toBlob(doc);
      bytes+=blob.size;if(bytes>250*1024*1024)throw new Error('Los documentos Word superan 250 MB.');
      archivos.push({name:base(entrada.name)+'.docx',blob});
    }finally{pdf.destroy();}
  }
  return {archivos};
}
