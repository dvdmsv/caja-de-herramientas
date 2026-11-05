import type * as MuPDF from 'mupdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';
import {abrirPdf,guardarPdf,base} from './pdf';
import {ajustes,coincidencias} from './patrones';
import {estampar} from './marca';
import {CUOTA_LOCAL} from './catalogo';

interface Palabra {texto:string;rect:MuPDF.Rect}
interface Zona {tipo:string;rect:MuPDF.Rect}
function renglones(text:MuPDF.StructuredText):Palabra[][] {
  const lineas:Palabra[][]=[];let linea:Palabra[]=[],actual:Palabra|undefined;
  const cerrar=()=>{if(actual){linea.push(actual);actual=undefined;}};
  text.walk({beginLine:()=>{linea=[];},onChar:(c,_origin,_font,_size,quad)=>{
    if(/^\s+$/u.test(c)){cerrar();return;}
    const xs=[quad[0],quad[2],quad[4],quad[6]],ys=[quad[1],quad[3],quad[5],quad[7]];
    const r:MuPDF.Rect=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
    if(actual){actual.texto+=c;actual.rect=[Math.min(actual.rect[0],r[0]),Math.min(actual.rect[1],r[1]),Math.max(actual.rect[2],r[2]),Math.max(actual.rect[3],r[3])];}
    else actual={texto:c,rect:r};
  },endLine:()=>{cerrar();if(linea.length)lineas.push(linea);}});
  return lineas;
}
export async function anonimizar(m:typeof MuPDF,p:PeticionMotor,avance:(hechos:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un PDF.');
  const {tipos,propio}=ajustes(p.opciones),inspeccionar=p.slug.endsWith('/inspeccionar');
  const color=String(p.opciones['color']??'negro');
  if(!['negro','blanco'].includes(color))throw new Error('El color no es válido.');
  const doc=await abrirPdf(m,p.archivos[0]);
  try {
    const zonas=new Map<number,Zona[]>(),recuento=new Map<string,number>(),ejemplos:string[]=[];
    const paginas:{pagina:number;marcas:{tipo:string;rect:number[]}[]}[]=[];
    let total=0,conTexto=false,caracteres=0;
    for(let n=0;n<doc.countPages();n++) {
      const page=doc.loadPage(n),text=page.toStructuredText();
      try {
        const anotaciones=page.getAnnotations();
        try {
          if(anotaciones.some(a=>a.getType()==='Redact'))throw new Error('El PDF contiene marcas de tachado pendientes. Aplícalas o elimínalas antes de buscar nuevos datos.');
        }finally{anotaciones.forEach(a=>a.destroy());}
        const encontradas:Zona[]=[];
        for(const palabras of renglones(text)) {
          conTexto=true;let s='';const mapa:(number|null)[]=[];
          palabras.forEach((palabra,i)=>{if(i){s+=' ';mapa.push(null);}s+=palabra.texto;for(let j=0;j<palabra.texto.length;j++)mapa.push(i);});
          caracteres+=s.length;if(caracteres>2_000_000)throw new Error('El texto supera dos millones de caracteres. Divide el PDF en tramos.');
          if(propio&&ejemplos.length<10)for(const c of coincidencias(s,new Set(),propio)) {
            const ejemplo=s.slice(c.inicio,c.fin);if(!ejemplos.includes(ejemplo)&&ejemplos.length<10)ejemplos.push(ejemplo);
          }
          for(const c of coincidencias(s,tipos,propio)) {
            const indices=new Set(mapa.slice(c.inicio,c.fin).filter((i):i is number=>i!==null));
            if(!indices.size)continue;
            const cajas=[...indices].map(i=>palabras[i].rect);
            const rect:MuPDF.Rect=[Math.min(...cajas.map(r=>r[0])),Math.min(...cajas.map(r=>r[1])),Math.max(...cajas.map(r=>r[2])),Math.max(...cajas.map(r=>r[3]))];
            encontradas.push({tipo:c.tipo,rect});total++;
            if(total>50_000)throw new Error('Se han encontrado más de 50000 datos. Divide el PDF o afina la expresión.');
            recuento.set(c.tipo,(recuento.get(c.tipo)??0)+1);
          }
        }
        if(encontradas.length) {
          zonas.set(n,encontradas);const [x0,y0,x1,y1]=page.getBounds();
          paginas.push({pagina:n+1,marcas:encontradas.map(z=>({tipo:z.tipo,rect:[(z.rect[0]-x0)/(x1-x0),(z.rect[1]-y0)/(y1-y0),(z.rect[2]-x0)/(x1-x0),(z.rect[3]-y0)/(y1-y0)]}))});
        }
      }finally{text.destroy();page.destroy();}
      avance(n+1,doc.countPages());
    }
    if(!conTexto)throw new Error('Este PDF no tiene texto. Es un escaneado: necesita OCR antes de poder buscar datos.');
    if(inspeccionar)return {archivos:[],datos:{total,recuento:[...recuento].map(([tipo,cuantas])=>({tipo,cuantas})),paginas,ejemplos}};
    if(!total)throw new Error('No se ha encontrado ninguno de los datos marcados. El documento se queda como estaba.');
    for(const [n,lista] of zonas) {
      const page=doc.loadPage(n);
      try {
        for(const zona of lista) {
          const annot=page.createAnnotation('Redact');
          try{annot.setRect(zona.rect);annot.update();}finally{annot.destroy();}
        }
        // Eliminar texto y píxeles, no sólo dibujar rectángulos sobre el contenido.
        page.applyRedactions(false,m.PDFPage.REDACT_IMAGE_PIXELS,m.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,m.PDFPage.REDACT_TEXT_REMOVE);
      }finally{page.destroy();}
      const comandos=(color==='blanco'?'1 1 1':'0 0 0')+' rg '+lista.map(z=>{
        const [x0,y0,x1,y1]=z.rect;return `${x0} ${y0} ${x1-x0} ${y1-y0} re f`;
      }).join(' ');
      estampar(m,doc,n,comandos,{});
    }
    const blob=guardarPdf(doc);
    if(blob.size>CUOTA_LOCAL)throw new Error('El resultado supera 250 MB.');
    return {archivos:[{name:base(p.archivos[0].name)+'-anonimizado.pdf',blob}],datos:{tachadas:total}};
  }finally{doc.destroy();}
}
