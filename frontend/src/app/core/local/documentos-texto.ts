import type * as MuPDF from 'mupdf';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { cuerpoMarkdown } from './markdown';
import { estilosMarkdown } from './markdown-estilos';
import { estilosImpresion } from './markdown-impresion';
import { guardarPdf, escribirIndice, base } from './pdf';
import { numerar } from './numeracion';
import { CUOTA_LOCAL } from './catalogo';
import type { PeticionMotor, ResultadoMotor } from './tipos';

type Nodo = DefaultTreeAdapterMap['node'];
const prohibidas=new Set(['script','iframe','object','embed','base','link','form','input','button','textarea']);
export function sanearHtml(html:string):string {
  const tree=parse(html);
  const visitar=(n:Nodo):void=>{
    if('childNodes' in n) {
      n.childNodes=n.childNodes.filter(c=>!('tagName' in c)||!prohibidas.has(c.tagName));
      for(const child of n.childNodes)visitar(child);
    }
    if('tagName' in n) {
      n.attrs=n.attrs.filter(a=>{
        const name=a.name.toLowerCase(),value=a.value.replace(/[\x00-\x20\x7f]/g,'');
        if(name.startsWith('on')||name==='srcdoc'||name==='srcset'||name==='http-equiv')return false;
        if(['href','src','poster','data'].includes(name)) {
          if(value.startsWith('#')||/^data:image\//i.test(value))return true;
          return n.tagName==='a'&&name==='href'&&/^(https?:|mailto:|tel:)/i.test(value);
        }
        return true;
      });
    }
  };
  visitar(tree);return serialize(tree);
}
export async function leerTexto(blob:Blob):Promise<string> {
  const bytes=await blob.arrayBuffer();
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('windows-1252').decode(bytes);}
}
export async function convertirTexto(m:typeof MuPDF,p:PeticionMotor,avance:(hechos:number,total:number)=>void):Promise<ResultadoMotor> {
  const markdown=p.slug==='markdown-a-pdf',o=p.opciones;
  const entero=(k:string,d:number,min:number,max:number)=>{
    const n=Number(o[k]??d);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`El valor de ${k} no es válido.`);return n;
  };
  const pagina=String(o['pagina']??'a4'),orientacion=String(o['orientacion']??'vertical');
  if(!['a4','carta'].includes(pagina)||!['vertical','horizontal'].includes(orientacion))throw new Error('El tamaño u orientación de página no son válidos.');
  let [ancho,alto]=pagina==='a4'?[210,297]:[215.9,279.4];if(orientacion==='horizontal')[ancho,alto]=[alto,ancho];
  const margen=entero('margen',markdown?20:15,markdown?10:0,40),cuerpo=entero('cuerpo',11,8,16);
  const familia=String(o['familia']??'sans'),acento=String(o['acento']??'azul');
  if(markdown&&(!['sans','serif'].includes(familia)||!Object.hasOwn(estilosMarkdown.COLORES_ACENTO,acento)))throw new Error('La fuente o el acento no son válidos.');
  if(!p.archivos.length)throw new Error('Selecciona un archivo de texto.');
  const archivos=[];let bytes=0;
  for(const [i,entrada] of p.archivos.entries()) {
    if(!(markdown?/\.md$/i:/\.html?$/i).test(entrada.name))throw new Error(markdown?'Selecciona un archivo Markdown (.md).':'Selecciona un archivo HTML.');
    const texto=await leerTexto(entrada.blob);
    if(!texto.trim())throw new Error('El archivo está vacío.');
    if(texto.length>2_000_000)throw new Error('El documento supera dos millones de caracteres.');
    let css=`@page {margin:${margen}mm} body {margin:0;}`;
    if(markdown) {
      const color=estilosMarkdown.COLORES_ACENTO[acento as keyof typeof estilosMarkdown.COLORES_ACENTO];
      const valores:Record<string,string|number>={ancho,alto,margen,margen_inferior:margen+4,familia:familia==='serif'?'serif':'sans-serif',mono:'monospace',cuerpo,pie:Math.max(7,cuerpo*0.72),acento:color.base,acento_oscuro:color.oscuro,acento_tenue:color.tenue};
      css=estilosImpresion.replace(/\{([a-z_]+)\}/g,(_,k)=>String(valores[k])).replaceAll('{{','{').replaceAll('}}','}');
      // MuPDF no compone cajas de margen CSS. El pie se añade al PDF al terminar.
      css=css.replace(/@bottom-(?:left|right)\s*\{[^}]*\}/g,'').replace(/break-after:\s*page/g,'page-break-after:always');
    }
    const html=sanearHtml(markdown?`<html><head><meta charset="utf-8"></head><body>${cuerpoMarkdown(texto,o['saltos']!==false,true)}</body></html>`:texto);
    const source=m.Document.openDocument(new TextEncoder().encode(html),'text/html'),buffer=new m.Buffer();
    try {
      source.style(true,css);source.layout(ancho/25.4*72,alto/25.4*72,cuerpo);
      const total=source.countPages();
      if(!total||total>1000)throw new Error('El documento debe tener entre 1 y 1000 páginas.');
      const writer=new m.DocumentWriter(buffer,'pdf','compress');
      try {
        for(let n=0;n<total;n++) {
          const page=source.loadPage(n);
          try {const device=writer.beginPage(page.getBounds());try{page.run(device,m.Matrix.identity);}finally{device.destroy();}writer.endPage();}
          finally{page.destroy();}
          if(buffer.length>CUOTA_LOCAL)throw new Error('El PDF supera 250 MB.');
          avance(n+1,total);
        }
        writer.close();
      } finally{writer.destroy();}
      const doc=new m.PDFDocument(buffer);
      try {
        escribirIndice(doc,source.loadOutline()??[]);
        for(let n=0;n<total;n++) {
          const original=source.loadPage(n),destino=doc.loadPage(n);
          try {
            for(const link of original.getLinks()) {
              try {
                const uri=link.getURI();let target=uri;
                if(!link.isExternal()) {const page=source.resolveLink(link);if(page<0)continue;target=`#page=${page+1}`;}
                else if(!/^(https?:|mailto:|tel:)/i.test(uri))continue;
                destino.createLink(link.getBounds(),target).destroy();
              } finally{link.destroy();}
            }
          } finally{original.destroy();destino.destroy();}
        }
        if(markdown)numerar(m,doc,{formato:'pagina-de-total',alineacion:'derecha',tamano:Math.max(7,Math.round(cuerpo*0.72)),margen:Math.min(30,Math.max(5,Math.round(margen/2))),fuente:familia});
        const blob=guardarPdf(doc);bytes+=blob.size;if(bytes>CUOTA_LOCAL)throw new Error('Los resultados superan 250 MB.');
        archivos.push({name:base(entrada.name)+'.pdf',blob});
      } finally{doc.destroy();}
    } finally{source.destroy();buffer.destroy();}
    avance(i+1,p.archivos.length);
  }
  return {archivos};
}
