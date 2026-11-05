import {Capacitor,registerPlugin} from '@capacitor/core';
import type {EntradaMotor,OpcionesMotor} from './tipos';
import type {PuenteGhostscript} from './ghostscript';

export interface PuenteFirmas extends PuenteGhostscript {
  certificado(o:OpcionesMotor):Promise<Record<string,unknown>>;
  elegirCertificado():Promise<{certificado:string}>;
  firmas(o:{id:string}):Promise<{firmas:unknown[]}>;
  firmar(o:OpcionesMotor&{id:string}):Promise<{size:number}>;
  tiempo(o:{id:string}):Promise<{size:number}>;
  metadatos(o:{id:string;ajustes:OpcionesMotor}):Promise<{size?:number;campos:unknown[];ubicacion:boolean;mime:string}>;
  office(o:{id:string;extension:string}):Promise<{size:number}>;
}
export const FirmasAndroid=registerPlugin<PuenteFirmas>('Ghostscript');
export async function base64(blob:Blob):Promise<string> {
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
  for(let n=0;n<bytes.length;n+=8192)text+=String.fromCharCode(...bytes.subarray(n,n+8192));
  return btoa(text);
}
export async function operarFirma(entrada:EntradaMotor,modo:'inspeccionar'|'firmar'|'tiempo'|'metadatos'|'office',opciones:OpcionesMotor,signal:AbortSignal,puente?:PuenteFirmas):Promise<{firmas?:unknown[];archivo?:EntradaMotor;metadatos?:{campos:unknown[];ubicacion:boolean}}> {
  if(!puente&&Capacitor.getPlatform()!=='android')throw new Error('Esta operación requiere la aplicación Android.');
  if((!['metadatos','office'].includes(modo)&&!/\.pdf$/i.test(entrada.name))||!entrada.blob.size||entrada.blob.size>50*1024*1024)throw new Error('Selecciona un archivo de hasta 50 MB.');
  const extension=entrada.name.split('.').at(-1)?.toLowerCase()??'';
  if(modo==='office'&&!['docx','doc','odt','rtf','txt','xlsx','xls','ods','pptx','ppt','odp'].includes(extension))throw new Error('El formato Office no está admitido.');
  const check=()=>{if(signal.aborted)throw new Error('Operación cancelada.');};
  check();const motor=puente??FirmasAndroid,{id}=await motor.crear();
  const cancelar=()=>{void motor.liberar({id}).catch(()=>{});};
  signal.addEventListener('abort',cancelar,{once:true});
  try {
    check();
    for(let offset=0;offset<entrada.blob.size;offset+=512*1024){check();await motor.escribir({id,data:await base64(entrada.blob.slice(offset,offset+512*1024))});}
    check();
    if(modo==='inspeccionar'){const result=await motor.firmas({id});check();return result;}
    const metadata=modo==='metadatos'?await motor.metadatos({id,ajustes:opciones}):undefined;
    if(metadata&&opciones['inspeccionar']){check();return {metadatos:metadata};}
    const result=metadata??(modo==='office'?await motor.office({id,extension}):modo==='tiempo'?await motor.tiempo({id}):await motor.firmar({...opciones,id}));
    check();
    if(result.size===undefined||!Number.isSafeInteger(result.size)||result.size<=0||result.size>250*1024*1024)throw new Error('El resultado supera el tamaño permitido.');
    const chunks:Uint8Array<ArrayBuffer>[]=[];
    for(let offset=0;offset<result.size;) {
      check();const chunk=await motor.leer({id,offset}),bytes=Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0));
      if(!bytes.length||bytes.length>512*1024||offset+bytes.length>result.size)throw new Error('No se ha podido leer el resultado completo.');
      chunks.push(bytes);offset+=bytes.length;
    }
    const nombre=modo==='office'?entrada.name.replace(/\.[^.]+$/,'.pdf'):modo==='metadatos'?entrada.name.replace(/(\.[^.]+)$/,'-metadatos$1'):entrada.name.replace(/\.pdf$/i,modo==='tiempo'?'-marca-de-tiempo.pdf':'-firmado.pdf');
    check();return {archivo:{name:nombre,blob:new Blob(chunks,{type:metadata?.mime??'application/pdf'})}};
  }finally{signal.removeEventListener('abort',cancelar);await motor.liberar({id});}
}
