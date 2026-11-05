import type * as MuPDF from 'mupdf';
import * as XLSX from 'xlsx';
import {abrirPdf,base} from './pdf';
import {estructuraPdf,tablaMarkdown} from './estructura-pdf';
import type {PeticionMotor,ResultadoMotor} from './tipos';

export function importe(texto:string):number|string {
  const r=/^\s*(\()?\s*([-+])?\s*([€$£])?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+)\s*([€$£])?\s*(\))?\s*$/.exec(texto);
  if(!r||Boolean(r[1])!==Boolean(r[6])||(!/[.,]/.test(r[4])&&!r[3]&&!r[5]))return texto;
  const n=Number(r[4].replace(/\./g,'').replace(',','.'))*(r[1]||r[2]==='-'?-1:1);
  return Number.isFinite(n)?n:texto;
}
export async function extraerTablas(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length||!/\.pdf$/i.test(p.archivos[0].name))throw new Error('Selecciona un PDF.');
  const formato=p.opciones['formato']??'xlsx';
  if(!['xlsx','csv','json','markdown'].includes(String(formato)))throw new Error('El formato no es válido.');
  const doc=await abrirPdf(m,p.archivos[0]);
  try {
    const tablas=estructuraPdf(m,doc,false,avance).flatMap(p=>p.tablas);
    if(p.slug.endsWith('/inspeccionar'))return {archivos:[],datos:{total:tablas.length,tablas:tablas.map(t=>({pagina:t.pagina,filas:t.filas.length,columnas:Math.max(...t.filas.map(f=>f.length))}))}};
    if(!tablas.length)throw new Error('No se ha encontrado ninguna tabla dibujada. Si es un escaneado, pásalo antes por PDF con OCR.');
    const nombre=base(p.archivos[0].name);
    if(formato==='csv')return {archivos:tablas.map((t,i)=>({
      name:`${nombre}-pagina-${t.pagina}-tabla-${String(i+1).padStart(String(tablas.length).length,'0')}.csv`,
      blob:new Blob(['\uFEFF'+t.filas.map(f=>f.map(c=>/[;"\r\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c).join(';')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}),
    }))};
    if(formato==='json')return {archivos:[{name:nombre+'-tablas.json',blob:new Blob([JSON.stringify({tablas:tablas.map((t,i)=>({pagina:t.pagina,indice:i+1,filas:t.filas.map(f=>f.map(importe))}))},null,2)+'\n'],{type:'application/json'})}]};
    if(formato==='markdown')return {archivos:[{name:nombre+'-tablas.md',blob:new Blob([tablas.map((t,i)=>`## Tabla ${i+1} · Página ${t.pagina}\n\n${tablaMarkdown(t.filas)}`).join('\n\n')+'\n'],{type:'text/markdown'})}]};
    const libro=XLSX.utils.book_new();
    for(const [i,t] of tablas.entries()) {
      const hoja=XLSX.utils.aoa_to_sheet(t.filas.map(f=>f.map(importe)));
      XLSX.utils.book_append_sheet(libro,hoja,`Página ${t.pagina} · ${i+1}`);
    }
    const datos=XLSX.write(libro,{type:'array',bookType:'xlsx',compression:true}) as ArrayBuffer;
    return {archivos:[{name:nombre+'-tablas.xlsx',blob:new Blob([datos],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}]};
  }finally{doc.destroy();}
}
