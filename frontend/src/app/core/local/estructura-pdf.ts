import type * as MuPDF from 'mupdf';
import {MAXIMO_PIXELES} from './catalogo';

export interface TramoPdf {texto:string;tamano:number;negrita:boolean;cursiva:boolean;mono:boolean}
export interface LineaPdf {caja:MuPDF.Rect;tramos:TramoPdf[]}
export interface TablaPdf {pagina:number;caja:MuPDF.Rect;filas:string[][]}
export interface ImagenPdf {caja:MuPDF.Rect;datos:Uint8Array<ArrayBuffer>}
export interface PaginaPdf {numero:number;caja:MuPDF.Rect;lineas:LineaPdf[];tablas:TablaPdf[];imagenes:ImagenPdf[]}
type Segmento = {x0:number;y0:number;x1:number;y1:number};
const texto=(l:LineaPdf)=>l.tramos.map(t=>t.texto).join('');
const cerca=(a:number,b:number)=>Math.abs(a-b)<2;
const unicos=(v:number[])=>v.sort((a,b)=>a-b).filter((x,i,a)=>i===0||!cerca(x,a[i-1]));
const dentro=(l:LineaPdf,r:MuPDF.Rect)=>{
  const x=(l.caja[0]+l.caja[2])/2,y=(l.caja[1]+l.caja[3])/2;
  return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3];
};

function rejillas(m:typeof MuPDF,page:MuPDF.PDFPage,lineas:LineaPdf[],numero:number):TablaPdf[] {
  const segmentos:Segmento[]=[];
  function path(p:MuPDF.Path,ctm:MuPDF.Matrix) {
    let actual:MuPDF.Point=[0,0],inicio:MuPDF.Point=[0,0];
    const transformar=(x:number,y:number):MuPDF.Point=>[x*ctm[0]+y*ctm[2]+ctm[4],x*ctm[1]+y*ctm[3]+ctm[5]];
    const unir=(destino:MuPDF.Point)=>{
      const [x0,y0]=actual,[x1,y1]=destino;
      if((cerca(x0,x1)||cerca(y0,y1))&&Math.hypot(x1-x0,y1-y0)>4)segmentos.push({x0:Math.min(x0,x1),y0:Math.min(y0,y1),x1:Math.max(x0,x1),y1:Math.max(y0,y1)});
      actual=destino;
    };
    p.walk({moveTo(x,y){actual=inicio=transformar(x,y);},lineTo(x,y){unir(transformar(x,y));},curveTo(_a,_b,_c,_d,x,y){actual=transformar(x,y);},closePath(){unir(inicio);}});
  }
  const device=new m.Device({strokePath(p,_s,ctm){path(p,ctm);},fillPath(p,_e,ctm){path(p,ctm);}});
  try {page.runPageContents(device,m.Matrix.identity);device.close();}finally{device.destroy();}
  if(segmentos.length>10000)throw new Error('La página contiene demasiadas líneas para analizar sus tablas.');
  const horizontales=segmentos.filter(s=>cerca(s.y0,s.y1)),verticales=segmentos.filter(s=>cerca(s.x0,s.x1));
  // Agrupar bordes conectados: dos tablas independientes no comparten sus columnas.
  const grupos:Segmento[][]=[];
  const pendientes=new Set(segmentos);
  while(pendientes.size) {
    const primero=pendientes.values().next().value!;pendientes.delete(primero);
    const grupo=[primero];
    for(let i=0;i<grupo.length;i++)for(const s of pendientes) {
      const g=grupo[i];
      if(s.x0<=g.x1+2&&s.x1>=g.x0-2&&s.y0<=g.y1+2&&s.y1>=g.y0-2){grupo.push(s);pendientes.delete(s);}
    }
    grupos.push(grupo);
  }
  const resultado:TablaPdf[]=[];
  for(const grupo of grupos) {
    const hs=grupo.filter(s=>horizontales.includes(s)),vs=grupo.filter(s=>verticales.includes(s));
    const xs=unicos(vs.map(s=>s.x0)),ys=unicos(hs.map(s=>s.y0));
    if(xs.length<3||ys.length<3||xs.length*ys.length>10000)continue;
    const filas:string[][]=Array.from({length:ys.length-1},()=>Array(xs.length-1).fill(''));
    const ocupadas=new Set<string>();let maxLineas=0,intentos=0,celdas=0;
    const cubre=(segments:Segmento[],pos:number,inicio:number,fin:number,horizontal:boolean)=>{
      const partes=segments.filter(s=>cerca(horizontal?s.y0:s.x0,pos)).map(s=>horizontal?[s.x0,s.x1]:[s.y0,s.y1]).sort((a,b)=>a[0]-b[0]);
      let hasta=inicio;
      for(const [a,b] of partes){if(b<hasta-2)continue;if(a>hasta+2)return false;hasta=Math.max(hasta,b);if(hasta>=fin-2)return true;}
      return false;
    };
    for(let y=0;y<ys.length-1;y++) {
      for(let x=0;x<xs.length-1;x++) {
        if(ocupadas.has(`${x}:${y}`))continue;
        let derecha=0,abajo=0;
        buscar:for(let yy=y+1;yy<ys.length;yy++)for(let xx=x+1;xx<xs.length;xx++) {
          if(++intentos>100000)throw new Error('La rejilla es demasiado compleja. Divide el PDF antes de extraerla.');
          if(cubre(hs,ys[y],xs[x],xs[xx],true)&&cubre(hs,ys[yy],xs[x],xs[xx],true)&&cubre(vs,xs[x],ys[y],ys[yy],false)&&cubre(vs,xs[xx],ys[y],ys[yy],false)) {
            let libre=true;for(let a=y;a<yy;a++)for(let b=x;b<xx;b++)if(ocupadas.has(`${b}:${a}`))libre=false;
            if(libre){derecha=xx;abajo=yy;break buscar;}
          }
        }
        if(!derecha)continue;
        for(let a=y;a<abajo;a++)for(let b=x;b<derecha;b++)ocupadas.add(`${b}:${a}`);
        celdas++;
        const caja:MuPDF.Rect=[xs[x],ys[y],xs[derecha],ys[abajo]];
        const contenido=lineas.filter(l=>dentro(l,caja)).sort((a,b)=>a.caja[1]-b.caja[1]||a.caja[0]-b.caja[0]);
        maxLineas=Math.max(maxLineas,contenido.length);
        filas[y][x]=contenido.map(texto).join(' ').replace(/\s+/g,' ').trim();
      }
    }
    if(celdas<3||filas.flat().filter(Boolean).length<3||maxLineas>6)continue;
    resultado.push({pagina:numero,caja:[xs[0],ys[0],xs.at(-1)!,ys.at(-1)!],filas});
  }
  return resultado.sort((a,b)=>a.caja[1]-b.caja[1]||a.caja[0]-b.caja[0]);
}

export function estructuraPdf(m:typeof MuPDF,doc:MuPDF.PDFDocument,imagenes=false,avance:(n:number,total:number)=>void=()=>{}):PaginaPdf[] {
  const paginas:PaginaPdf[]=[];
  let caracteres=0,totalImagenes=0,totalTablas=0;
  for(let n=0;n<doc.countPages();n++) {
    const page=doc.loadPage(n),lineas:LineaPdf[]=[],imgs:ImagenPdf[]=[];
    try {
      const structured=page.toStructuredText('preserve-whitespace,dehyphenate'+(imagenes?',preserve-images':''));
      let linea:LineaPdf|undefined;
      try {structured.walk({
        beginLine(caja){linea={caja:[...caja],tramos:[]};lineas.push(linea);},
        onChar(c,_o,font,size){
          if(!linea)return;
          if(++caracteres>2_000_000)throw new Error('El PDF contiene demasiado texto. Divídelo primero.');
          const estilo={tamano:Math.round(size*10)/10,negrita:font.isBold(),cursiva:font.isItalic(),mono:font.isMono()};
          const anterior=linea.tramos.at(-1);
          if(anterior&&Object.entries(estilo).every(([k,v])=>anterior[k as keyof TramoPdf]===v))anterior.texto+=c;
          else linea.tramos.push({texto:c,...estilo});
        },
        onImageBlock(caja,transform,image){
          if(!imagenes)return;
          if(image.getWidth()*image.getHeight()>MAXIMO_PIXELES)throw new Error('Una imagen supera 20 megapíxeles.');
          const width=caja[2]-caja[0],height=caja[3]-caja[1];
          if(width<=0||height<=0)return;
          const sx=Math.hypot(transform[0],transform[1]),sy=Math.hypot(transform[2],transform[3]);
          const scale=Math.min(Math.max(image.getWidth()/Math.max(sx,0.001),image.getHeight()/Math.max(sy,0.001)),Math.sqrt(MAXIMO_PIXELES/(width*height)));
          const bounds:MuPDF.Rect=[Math.floor(caja[0]*scale),Math.floor(caja[1]*scale),Math.ceil(caja[2]*scale),Math.ceil(caja[3]*scale)];
          const pix=new m.Pixmap(m.ColorSpace.DeviceRGB,bounds,true);pix.clear(0);
          try {
            const draw=new m.DrawDevice(m.Matrix.scale(scale,scale),pix);
            try{draw.fillImage(image,transform,1);draw.close();}finally{draw.destroy();}
            const datos=pix.asPNG().slice();totalImagenes+=datos.length;
            if(totalImagenes>100*1024*1024)throw new Error('Las imágenes del documento superan 100 MB.');
            imgs.push({caja:[...caja],datos});
          }finally{pix.destroy();}
        },
      });}finally{structured.destroy();}
      const tablas=rejillas(m,page,lineas,n+1);totalTablas+=tablas.length;
      if(totalTablas>300)throw new Error('El PDF contiene más de 300 tablas. Divídelo primero.');
      paginas.push({numero:n+1,caja:page.getBounds(),lineas:lineas.filter(l=>texto(l).trim()),tablas,imagenes:imgs});
    }finally{page.destroy();}
    avance(n+1,doc.countPages());
  }
  return paginas;
}

export const escaparMarkdown=(s:string)=>s.replace(/[\\`*_\[\]<>|]/g,'\\$&');
export function tablaMarkdown(filas:string[][]):string {
  if(!filas.length)return '';
  const fila=(f:string[])=>'| '+f.map(s=>escaparMarkdown(s).replace(/\r?\n/g,' ')).join(' | ')+' |';
  return [fila(filas[0]),fila(filas[0].map(()=>'---')),...filas.slice(1).map(fila)].join('\n');
}
export function markdownEstructurado(paginas:PaginaPdf[]):{texto:string;imagenes:Record<string,Uint8Array<ArrayBuffer>>} {
  const pesos=new Map<number,number>();
  for(const p of paginas)for(const l of p.lineas)for(const t of l.tramos)pesos.set(t.tamano,(pesos.get(t.tamano)??0)+t.texto.length);
  const cuerpo=[...pesos].sort((a,b)=>b[1]-a[1])[0]?.[0]??12;
  const tamanos=[...pesos.keys()].filter(s=>s>cuerpo*1.15).sort((a,b)=>b-a);
  const salida:string[]=[],imagenes:Record<string,Uint8Array<ArrayBuffer>>={};
  for(const p of paginas) {
    const elementos:Array<{y:number;x:number;contenido:string}>=[];
    for(const t of p.tablas)elementos.push({y:t.caja[1],x:t.caja[0],contenido:tablaMarkdown(t.filas)});
    for(const l of p.lineas) {
      if(p.tablas.some(t=>dentro(l,t.caja)))continue;
      const tamano=Math.max(...l.tramos.map(t=>t.tamano));
      let contenido=l.tramos.map(t=>{
        const s=escaparMarkdown(t.texto);
        return t.mono?'`'+t.texto.replace(/`/g,'')+'`':t.negrita&&t.cursiva?'***'+s+'***':t.negrita?'**'+s+'**':t.cursiva?'*'+s+'*':s;
      }).join('').trim();
      const nivel=tamanos.indexOf(tamano);
      if(nivel>=0)contenido='#'.repeat(Math.min(nivel+1,6))+' '+contenido;
      else contenido=contenido.replace(/^[•◦▪‣●]\s+/,'- ');
      elementos.push({y:l.caja[1],x:l.caja[0],contenido});
    }
    for(const img of p.imagenes) {
      const nombre=`imagen-${Object.keys(imagenes).length+1}.png`;imagenes[nombre]=img.datos;
      elementos.push({y:img.caja[1],x:img.caja[0],contenido:`![Imagen](${nombre})`});
    }
    salida.push(...elementos.sort((a,b)=>a.y-b.y||a.x-b.x).map(e=>e.contenido));
  }
  return {texto:salida.join('\n\n'),imagenes};
}
