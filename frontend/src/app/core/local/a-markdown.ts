import type * as MuPDF from 'mupdf';
import {parseFragment} from 'parse5';
import {xml2js,type Element} from 'xml-js';
import {unzipSync,strFromU8} from 'fflate';
import * as XLSX from 'xlsx';
import {abrirPdf,base} from './pdf';
import {estructuraPdf,markdownEstructurado,tablaMarkdown,escaparMarkdown} from './estructura-pdf';
import {leerCorreo} from './correo';
import {comprobarEpub} from './epub';
import type {PeticionMotor,ResultadoMotor,EntradaMotor} from './tipos';

function htmlMarkdown(html:string):string {
  function render(n:any):string {
    if(n.nodeName==='#text')return escaparMarkdown(n.value??'');
    const tag=n.tagName??'';
    if(['script','style','iframe','object','embed'].includes(tag))return '';
    const children=n.childNodes??[],text=children.map(render).join('');
    if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+text.trim()+'\n\n';
    if(['p','div','section','article','blockquote'].includes(tag))return '\n\n'+text+'\n\n';
    if(tag==='br')return '\n';
    if(tag==='li')return '\n- '+text.trim();
    if(['strong','b'].includes(tag))return '**'+text+'**';
    if(['em','i'].includes(tag))return '*'+text+'*';
    if(tag==='code')return '`'+text.replace(/`/g,'')+'`';
    if(tag==='table') {
      const filas:string[][]=[];
      const visitar=(el:any)=>{if(el.tagName==='tr')filas.push((el.childNodes??[]).filter((c:any)=>['td','th'].includes(c.tagName)).map((c:any)=>(c.childNodes??[]).map(render).join('').trim()));else for(const c of el.childNodes??[])visitar(c);};
      visitar(n);return '\n\n'+tablaMarkdown(filas)+'\n\n';
    }
    if(tag==='a') {
      const href=n.attrs?.find((a:any)=>a.name==='href')?.value??'';
      return /^(https?:|mailto:)/i.test(href)?`[${text}](${href.replace(/[()\s]/g,(c:string)=>encodeURIComponent(c))})`:text;
    }
    return text;
  }
  return render(parseFragment(html)).replace(/\n{3,}/g,'\n\n').trim();
}
function zip(bytes:Uint8Array):Record<string,Uint8Array> {
  let size=0,count=0;
  return unzipSync(bytes,{filter(e){size+=e.originalSize;if(++count>10000||size>250*1024*1024)throw new Error('El documento descomprimido supera los límites.');return /\.(xml|rels|xhtml|html|opf)$/i.test(e.name);}});
}
const nombre=(e:Element)=>e.name?.split(':').at(-1)??'';
const hijos=(e:Element)=>e.elements??[];
const textoXml=(e:Element):string=>e.type==='text'?String(e.text??''):hijos(e).map(textoXml).join('');
function todos(e:Element,name:string):Element[]{return hijos(e).flatMap(c=>nombre(c)===name?[c]:todos(c,name));}
function leerXml(bytes:Uint8Array):Element {
  const s=strFromU8(bytes);
  if(/<!DOCTYPE|<!ENTITY/i.test(s))throw new Error('El documento contiene declaraciones XML no admitidas.');
  return xml2js(s,{compact:false,ignoreDeclaration:true,ignoreComment:true}) as Element;
}
interface ContextoOffice {estilos:Map<string,Element>;numeracion?:Element;cuentas:Map<string,number>;estilo?:string}
const atributo=(e:Element|undefined,name:string)=>e?.attributes?.['w:'+name]??e?.attributes?.[name];
const hijo=(e:Element|undefined,name:string)=>e?hijos(e).find(c=>nombre(c)===name):undefined;
function cadenaEstilos(ctx:ContextoOffice|undefined,id:string|undefined):Element[] {
  const result:Element[]=[],vistos=new Set<string>();
  while(ctx&&id&&!vistos.has(id)&&result.length<32) {
    vistos.add(id);const style=ctx.estilos.get(id);if(!style)break;result.push(style);id=String(atributo(hijo(style,'basedOn'),'val')??'');
  }
  return result;
}
function booleanoXml(e:Element|undefined,clave:string):boolean|undefined {
  const prop=hijo(e,clave),v=prop?atributo(prop,'val'):atributo(e,clave);
  if(!prop&&v===undefined)return undefined;
  return !['0','false','off'].includes(String(v??'1').toLowerCase());
}
function officeXml(e:Element,ctx?:ContextoOffice):string {
  const tag=nombre(e);
  if(tag==='t')return escaparMarkdown(textoXml(e));
  if(['tab','br'].includes(tag))return tag==='tab'?'\t':'\n';
  if(tag==='r') {
    const text=hijos(e).filter(c=>nombre(c)!=='rPr').map(c=>officeXml(c,ctx)).join('');
    const props=hijos(e).find(c=>nombre(c)==='rPr');
    const estilos=[props,...cadenaEstilos(ctx,String(atributo(hijo(props,'rStyle'),'val')??'')).map(s=>hijo(s,'rPr')),...cadenaEstilos(ctx,ctx?.estilo).map(s=>hijo(s,'rPr'))];
    const bold=estilos.map(s=>booleanoXml(s,'b')).find(v=>v!==undefined)??false;
    const italic=estilos.map(s=>booleanoXml(s,'i')).find(v=>v!==undefined)??false;
    return bold&&italic?'***'+text+'***':bold?'**'+text+'**':italic?'*'+text+'*':text;
  }
  if(tag==='tbl')return '\n\n'+tablaMarkdown(hijos(e).filter(c=>nombre(c)==='tr').map(r=>hijos(r).filter(c=>nombre(c)==='tc').map(c=>officeXml(c,ctx).trim())))+'\n\n';
  if(tag==='p') {
    const props=hijos(e).find(c=>nombre(c)==='pPr');
    const style=String(atributo(hijo(props,'pStyle'),'val')??'');
    const level=/^(?:Heading|T.tulo)([1-6])$/i.exec(String(style??''))?.[1];
    const numProps=[props,...cadenaEstilos(ctx,style).map(s=>hijo(s,'pPr'))].map(s=>hijo(s,'numPr'));
    const numId=numProps.map(s=>atributo(hijo(s,'numId'),'val')).find(v=>v!==undefined);
    const ilvl=Math.min(8,Math.max(0,Number(numProps.map(s=>atributo(hijo(s,'ilvl'),'val')).find(v=>v!==undefined)??0)));
    let prefix=level?'#'.repeat(Number(level))+' ':'';
    if(!level&&numId!==undefined&&String(numId)!=='0'&&ctx) {
      const num=ctx.numeracion?todos(ctx.numeracion,'num').find(n=>String(atributo(n,'numId'))===String(numId)):undefined;
      const abstractId=atributo(hijo(num,'abstractNumId'),'val');
      const abstract=ctx.numeracion?todos(ctx.numeracion,'abstractNum').find(n=>String(atributo(n,'abstractNumId'))===String(abstractId)):undefined;
      const lvl=abstract?todos(abstract,'lvl').find(n=>Number(atributo(n,'ilvl'))===ilvl):undefined;
      const format=String(atributo(hijo(lvl,'numFmt'),'val')??'bullet');
      const override=num?todos(num,'lvlOverride').find(n=>Number(atributo(n,'ilvl'))===ilvl):undefined;
      const start=Number(atributo(hijo(override,'startOverride'),'val')??atributo(hijo(lvl,'start'),'val')??1);
      const key=String(numId)+':'+ilvl,cuenta=ctx.cuentas.get(key)??start;ctx.cuentas.set(key,cuenta+1);
      for(const k of ctx.cuentas.keys())if(k.startsWith(String(numId)+':')&&Number(k.split(':')[1])>ilvl)ctx.cuentas.delete(k);
      prefix='    '.repeat(ilvl)+(format==='bullet'?'- ':cuenta+'. ');
    }
    return '\n\n'+prefix+hijos(e).filter(c=>nombre(c)!=='pPr').map(c=>officeXml(c,ctx?{...ctx,estilo:style}:undefined)).join('')+'\n\n';
  }
  return hijos(e).map(c=>officeXml(c,ctx)).join('');
}

export async function aMarkdown(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona al menos un documento.');
  const unir=p.opciones['unir']??false;
  if(typeof unir!=='boolean')throw new Error('La opción de unir no es válida.');
  const convertidos:Array<{nombre:string;texto:string;original:number}>=[],adjuntos:EntradaMotor[]=[];
  for(const [i,entrada] of p.archivos.entries()) {
    const ext=entrada.name.split('.').at(-1)?.toLowerCase();let texto='';
    if(ext==='pdf') {
      const doc=await abrirPdf(m,entrada);
      try {texto=markdownEstructurado(estructuraPdf(m,doc,false)).texto;}finally{doc.destroy();}
    } else if(ext==='eml'||ext==='msg') {
      const mail=await leerCorreo(entrada);texto=htmlMarkdown(mail.documento);adjuntos.push(...mail.adjuntos);
    } else if(['txt','md','json','xml','html','htm'].includes(ext??'')) {
      const raw=await entrada.blob.text();
      texto=ext==='html'||ext==='htm'?htmlMarkdown(raw):ext==='json'||ext==='xml'?'```'+ext+'\n'+raw+'\n```':raw;
    } else if(['xls','xlsx','csv'].includes(ext??'')) {
      const bytes=new Uint8Array(await entrada.blob.arrayBuffer());
      if(ext==='xlsx')zip(bytes);
      let csv='';
      if(ext==='csv'){try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{csv=new TextDecoder('windows-1252').decode(bytes);}}
      const book=ext==='csv'?XLSX.read(csv.replace(/^\uFEFF/,''),{type:'string',cellFormula:false,cellHTML:false}):XLSX.read(bytes,{type:'array',cellFormula:false,cellHTML:false});
      texto=book.SheetNames.map(name=>'# '+escaparMarkdown(name)+'\n\n'+tablaMarkdown((XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false}) as unknown[][]).map(f=>f.map(String)))).join('\n\n');
    } else if(['docx','pptx','epub'].includes(ext??'')) {
      const bytes=new Uint8Array(await entrada.blob.arrayBuffer());
      if(ext==='epub')comprobarEpub(bytes);
      const files=zip(bytes);
      if(ext==='docx') {
        if(!files['word/document.xml'])throw new Error('El documento Word está dañado.');
        const styles=files['word/styles.xml']?todos(leerXml(files['word/styles.xml']),'style'):[];
        const ctx:ContextoOffice={estilos:new Map(styles.map(s=>[String(atributo(s,'styleId')),s])),cuentas:new Map(),numeracion:files['word/numbering.xml']?leerXml(files['word/numbering.xml']):undefined};
        texto=officeXml(leerXml(files['word/document.xml']),ctx);
      } else if(ext==='pptx') {
        if(!files['ppt/presentation.xml']||!files['ppt/_rels/presentation.xml.rels'])throw new Error('La presentación está dañada.');
        const relaciones=new Map(todos(leerXml(files['ppt/_rels/presentation.xml.rels']),'Relationship').filter(r=>r.attributes?.['TargetMode']!=='External').map(r=>[String(r.attributes?.['Id']),String(r.attributes?.['Target'])]));
        const slides=todos(leerXml(files['ppt/presentation.xml']),'sldId').map(s=>{
          const destino=relaciones.get(String(s.attributes?.['r:id']));
          if(!destino)throw new Error('Falta una diapositiva de la presentación.');
          const path=decodeURIComponent(new URL(destino,'https://local.invalid/ppt/').pathname.slice(1));
          if(!files[path])throw new Error('Falta una diapositiva de la presentación.');return path;
        });
        texto=slides.map((n,i)=>`# Diapositiva ${i+1}\n\n`+officeXml(leerXml(files[n]))).join('\n\n');
      } else {
        const container=files['META-INF/container.xml'];
        if(!container)throw new Error('El EPUB no contiene su índice de archivos.');
        const opf=String(todos(leerXml(container),'rootfile')[0]?.attributes?.['full-path']??'');
        if(!files[opf])throw new Error('El EPUB no contiene su paquete.');
        const root=leerXml(files[opf]),manifest=new Map(todos(root,'item').map(e=>[String(e.attributes?.['id']),String(e.attributes?.['href'])]));
        const prefix=opf.includes('/')?opf.slice(0,opf.lastIndexOf('/')+1):'';
        texto=todos(root,'itemref').map(ref=>{
          const href=manifest.get(String(ref.attributes?.['idref']));
          const path=new URL(href??'', 'https://local.invalid/'+prefix).pathname.slice(1);
          const content=files[decodeURIComponent(path)];
          if(!content)throw new Error('Falta un capítulo del EPUB.');
          return htmlMarkdown(strFromU8(content));
        }).join('\n\n');
      }
    } else throw new Error('Este formato no está admitido para convertir a Markdown.');
    texto=texto.replace(/\n{3,}/g,'\n\n').trim();
    if(!texto)throw new Error(`"${entrada.name}" no tiene texto que extraer. Si es un escaneado, usa PDF con OCR.`);
    convertidos.push({nombre:entrada.name,texto,original:entrada.blob.size});avance(i+1,p.archivos.length);
  }
  const salidas=unir&&convertidos.length>1?[{nombre:'documentos.md',texto:convertidos.map(c=>'# '+c.nombre+'\n\n'+c.texto).join('\n\n'),original:convertidos.reduce((n,c)=>n+c.original,0)}]:convertidos;
  const archivos=salidas.map(c=>({name:base(c.nombre)+'.md',blob:new Blob([c.texto+'\n'],{type:'text/markdown;charset=utf-8'})}));
  let quedan=1024*1024;
  const vistas_previas=salidas.map((c,i)=>{
    const caracteres=Array.from(c.texto).length,cabe=caracteres<=quedan;if(cabe)quedan-=caracteres;
    return {nombre:c.nombre,texto:cabe?c.texto:null,caracteres,palabras:c.texto.split(/\s+/).length,original:c.original,markdown:archivos[i].blob.size};
  });
  archivos.push(...adjuntos);
  if(archivos.reduce((n,a)=>n+a.blob.size,0)>250*1024*1024)throw new Error('Los resultados superan 250 MB.');
  return {archivos,datos:{vistas_previas}};
}
