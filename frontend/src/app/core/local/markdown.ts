import MarkdownIt, { type Token } from 'markdown-it';
import hljs from 'highlight.js';
import { estilosMarkdown as estilos } from './markdown-estilos';
import type { PeticionMotor, ResultadoMotor } from './tipos';

export function cuerpoMarkdown(texto:string,saltos=true,portada=false):string {
  const md=new MarkdownIt('commonmark',{html:true,breaks:saltos,highlight:(code,lang)=>{
    return hljs.getLanguage(lang)?hljs.highlight(code,{language:lang,ignoreIllegals:true}).value:'';
  }}).enable(['table','strikethrough']);
  const tokens=md.parse(texto,{});
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],first=token.children?.[0];
    if(token.type==='inline'&&i>=2&&tokens[i-2].type==='list_item_open'&&first?.type==='text') {
      const match=/^\[([ xX])\]\s+/.exec(first.content);
      if(match) {
        first.content=first.content.slice(match[0].length);
        const boxes=md.parseInline(`<span class="casilla${match[1]===' '?'':' marcada'}"></span>`,{})[0].children!;
        token.children!.unshift(...boxes);tokens[i-2].attrJoin('class','tarea');
      }
    }
    if(token.type==='table_open') {
      const end=tokens.findIndex((t,j)=>j>i&&t.type==='table_close');
      if(end>i)marcarTabla(tokens.slice(i,end+1));
    }
  }
  const html=md.renderer.render(tokens,md.options,{});
  if(!portada)return html;
  const salto=/<div[^>]*page-break-after:\s*always[^>]*>\s*<\/div>/i;
  const match=salto.exec(html);
  if(!match)return html;
  const antes:string[]=[];
  for(const token of tokens) {
    if(token.type==='html_block'&&salto.test(token.content))break;
    if(token.nesting===1||['fence','code_block','hr','html_block'].includes(token.type))antes.push(token.type);
  }
  if(!antes.includes('heading_open')||antes.some(t=>!['heading_open','paragraph_open'].includes(t))||antes.length>6)return html;
  return `<section class="portada">${html.slice(0,match.index)}</section>${html.slice(match.index+match[0].length)}`;
}
function marcarTabla(tokens:Token[]):void {
  const filas:{tr:Token;celdas:{token:Token;texto:string}[]}[]=[];
  tokens.forEach((t,i)=>{
    if(t.type==='tr_open')filas.push({tr:t,celdas:[]});
    else if(['td_open','th_open'].includes(t.type)&&filas.length)filas.at(-1)!.celdas.push({token:t,texto:(tokens[i+1]?.content??'').trim()});
  });
  if(!filas.length)return;
  const cuerpo=filas.slice(1),columnas=Math.max(...filas.map(f=>f.celdas.length));
  cuerpo.forEach((f,i)=>{
    const llenas=f.celdas.filter(c=>c.texto);
    if(llenas.length&&llenas.every(c=>/^(\*\*.+\*\*|__.+__)$/.test(c.texto)))f.tr.attrJoin('class',i===cuerpo.length-1&&i>0?'total':'etiquetas');
  });
  const etiqueta=(f:typeof filas[number])=>String(f.tr.attrGet('class')??'').includes('etiquetas');
  for(let c=0;c<columnas;c++) {
    const valores=cuerpo.filter(f=>!etiqueta(f)).map(f=>f.celdas[c]?.texto.replace(/^[*_ ]+|[*_ ]+$/g,'')??'').filter(Boolean);
    if(valores.length&&valores.filter(v=>/^[−\-+]?\s*[\d.,\s]*\d\s*(€|%|\$|£)?$/.test(v)).length>=valores.length*0.7)
      filas.filter(f=>!etiqueta(f)&&f.celdas[c]).forEach(f=>f.celdas[c].token.attrJoin('class','numero'));
  }
  const numerica=cuerpo.some(f=>String(f.celdas.at(-1)?.token.attrGet('class')??'').includes('numero'));
  if(columnas===2&&numerica&&filas.every(f=>f.celdas.every(c=>c.texto.length<=32)))tokens[0].attrJoin('class','cuadro');
  else if(cuerpo.some(etiqueta))tokens[0].attrJoin('class','formulario');
}
export function documentoMarkdown(texto:string,o:Record<string,unknown>):string {
  const familia=String(o['familia']??'sans'),acento=String(o['acento']??'azul'),tema=String(o['tema']??'claro');
  if(!Object.hasOwn(estilos.FAMILIAS,familia)||!Object.hasOwn(estilos.COLORES_ACENTO,acento)||!Object.hasOwn(estilos.PALETAS,tema))throw new Error('El tema, la fuente o el acento no son válidos.');
  const p=estilos.PALETAS[tema as keyof typeof estilos.PALETAS],c=estilos.COLORES_ACENTO[acento as keyof typeof estilos.COLORES_ACENTO];
  const mezclar=(a:string,b:string,f:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-f)+parseInt(b.slice(i,i+2),16)*f).toString(16).padStart(2,'0')).join('');
  const variables:Record<string,string>={...p,acento:tema==='claro'?c.base:mezclar(c.base,'#ffffff',0.15),acento_texto:tema==='claro'?c.oscuro:mezclar(c.base,'#ffffff',0.55),tenue:tema==='claro'?c.tenue:mezclar(c.base,p.fondo,0.78),letra:estilos.FAMILIAS[familia as keyof typeof estilos.FAMILIAS],mono:estilos.MONO};
  const css=':root{'+Object.entries(variables).map(([k,v])=>`--${k.replaceAll('_','-')}:${v};`).join('')+`color-scheme:${tema==='oscuro'?'dark':'light'};}`;
  const body=cuerpoMarkdown(texto,o['saltos']!==false).replace(/<\s*(?:meta|base|link)\b[^>]*>/gi,'');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>${css}${estilos.ESTILOS}${tema==='oscuro'?estilos.RESALTADO_OSCURO:estilos.RESALTADO_CLARO}</style></head><body><main>${body}</main></body></html>`;
}
export async function visorMarkdown(p:PeticionMotor):Promise<ResultadoMotor> {
  let texto:string;
  if(p.opciones['texto']!==undefined&&p.opciones['texto']!==null) {
    if(typeof p.opciones['texto']!=='string')throw new Error('El texto no es válido.');
    if(p.archivos.length)throw new Error('Envía el texto o el archivo, no los dos.');
    texto=p.opciones['texto'];
  } else {
    if(p.archivos.length!==1||!p.archivos[0].name.toLowerCase().endsWith('.md'))throw new Error('Selecciona un archivo Markdown (.md).');
    const bytes=await p.archivos[0].blob.arrayBuffer();
    try {texto=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch {texto=new TextDecoder('windows-1252').decode(bytes);}
  }
  if(!texto.trim())throw new Error('No hay nada que ver: el texto está vacío.');
  if(texto.length>2_000_000)throw new Error('El texto supera dos millones de caracteres.');
  return {archivos:[],datos:{html:documentoMarkdown(texto,p.opciones),palabras:(texto.match(/[\p{L}\p{N}_]+/gu)??[]).length}};
}
