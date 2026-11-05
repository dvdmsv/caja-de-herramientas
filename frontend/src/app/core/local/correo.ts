import PostalMime from 'postal-mime';
import MsgReader from '@kenjiuno/msgreader';
import type * as MuPDF from 'mupdf';
import type {PeticionMotor,ResultadoMotor,EntradaMotor} from './tipos';
import {convertirTexto,sanearHtml} from './documentos-texto';
import {CUOTA_LOCAL} from './catalogo';
const escapar=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function correoPdf(m:typeof MuPDF,p:PeticionMotor,avance:(n:number,total:number)=>void):Promise<ResultadoMotor> {
  if(!p.archivos.length)throw new Error('Selecciona un correo EML o MSG.');
  const archivos:EntradaMotor[]=[];let peso=0;
  for(const [i,entrada] of p.archivos.entries()) {
    const {documento,adjuntos}=await leerCorreo(entrada);
    const result=await convertirTexto(m,{slug:'html-a-pdf',archivos:[{name:entrada.name.replace(/\.[^.]+$/,'.html'),blob:new Blob([documento])}],opciones:{}},()=>{});
    for(const a of [...result.archivos,...adjuntos]) {peso+=a.blob.size;if(peso>CUOTA_LOCAL)throw new Error('Los correos y adjuntos superan 250 MB.');archivos.push(a);}
    avance(i+1,p.archivos.length);
  }
  return {archivos};
}

export async function leerCorreo(entrada:EntradaMotor):Promise<{documento:string;adjuntos:EntradaMotor[]}> {
    const bytes=await entrada.blob.arrayBuffer();let asunto='',de='',para='',cc='',fecha='',html='';
    const adjuntos:EntradaMotor[]=[];
    if(/\.eml$/i.test(entrada.name)) {
      const cabeceras=new TextDecoder().decode(bytes.slice(0,256*1024)).split(/\r?\n\r?\n/,1)[0];
      if(!/^(?:from|to|subject|date|message-id|mime-version|content-type):/im.test(cabeceras))throw new Error('El archivo no contiene cabeceras de correo válidas.');
      const mail=await PostalMime.parse(bytes);
      const direccion=(a:any):string=>a?.group?a.group.map(direccion).join(', '):[a?.name,a?.address].filter(Boolean).join(' ');
      asunto=mail.subject??'';de=direccion(mail.from);para=(mail.to??[]).map(direccion).join(', ');cc=(mail.cc??[]).map(direccion).join(', ');fecha=mail.date??'';
      html=mail.html??`<pre>${escapar(mail.text??'')}</pre>`;
      for(const a of mail.attachments) {
        const data=typeof a.content==='string'?new TextEncoder().encode(a.content):new Uint8Array(a.content);
        adjuntos.push({name:a.filename??'adjunto',blob:new Blob([data.slice()],{type:a.mimeType})});
      }
    } else if(/\.msg$/i.test(entrada.name)) {
      const reader=new MsgReader(bytes),mail=reader.getFileData();
      if(mail.dataType!=='msg')throw new Error('No se ha podido leer el correo MSG.');
      const fields=mail as unknown as Record<string,unknown>;
      asunto=mail.subject??'';de=[mail.senderName,mail.senderEmail].filter(Boolean).join(' ');
      const destinatarios=(tipo:string)=>(mail.recipients??[]).filter(r=>(r as any).recipType===tipo).map(r=>[(r as any).name,(r as any).email].filter(Boolean).join(' ')).join(', ');
      para=destinatarios('to');cc=destinatarios('cc');fecha=String(fields['clientSubmitTime']??fields['messageDeliveryTime']??'');
      html=mail.bodyHtml??(mail.html?new TextDecoder().decode(mail.html):`<pre>${escapar(mail.body??'')}</pre>`);
      for(const a of mail.attachments??[]) {const data=reader.getAttachment(a);adjuntos.push({name:data.fileName,blob:new Blob([new Uint8Array(data.content).slice()])});}
    } else throw new Error('Selecciona un correo EML o MSG.');
    if(adjuntos.length>200)throw new Error('El correo supera 200 adjuntos.');
    // Los nombres de los adjuntos son datos del mensaje, nunca rutas de disco.
    const usados=new Set([entrada.name.replace(/\.[^.]+$/,'.pdf'),entrada.name.replace(/\.[^.]+$/,'.md')]);
    for(const a of adjuntos) {
      const limpio=a.name.replace(/.*[\\/]/,'').replace(/[\x00-\x1f]/g,'').trim()||'adjunto';
      const punto=limpio.lastIndexOf('.'),base=punto>0?limpio.slice(0,punto):limpio,ext=punto>0?limpio.slice(punto):'';
      a.name=limpio;let copia=2;while(usados.has(a.name))a.name=base+'-'+(copia++)+ext;usados.add(a.name);
    }
    const cabecera=`<h1>${escapar(asunto||'Sin asunto')}</h1><p><b>De:</b> ${escapar(de)}</p><p><b>Para:</b> ${escapar(para)}</p><p><b>CC:</b> ${escapar(cc)}</p><p><b>Fecha:</b> ${escapar(fecha)}</p>`;
    const lista=adjuntos.length?'<h2>Adjuntos</h2><ul>'+adjuntos.map(a=>`<li>${escapar(a.name)}</li>`).join('')+'</ul>':'';
    const documento=sanearHtml(`<html><body>${cabecera}<hr>${html}${lista}</body></html>`);
    return {documento,adjuntos};
}
