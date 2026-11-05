import { Capacitor, registerPlugin } from '@capacitor/core';
import { CUOTA_LOCAL, MAXIMO_ARCHIVO } from './catalogo';
import type { EntradaMotor } from './tipos';

export interface PuenteGhostscript {
  crear(): Promise<{id:string}>;
  escribir(o:{id:string;data:string}):Promise<void>;
  grises(o:{id:string}):Promise<{size:number}>;
  pdfa?(o:{id:string;perfil:'1b'|'2b'}):Promise<{size:number}>;
  linearizar?(o:{id:string}):Promise<{size:number}>;
  leer(o:{id:string;offset:number}):Promise<{data:string}>;
  liberar(o:{id:string}):Promise<void>;
}
const Ghostscript=registerPlugin<PuenteGhostscript>('Ghostscript');

/** Bloques de 512 KB; nunca se pasa el PDF entero como base64 por el puente. */
export async function convertirGrises(entradas:EntradaMotor[],signal:AbortSignal,
  avance:(hechos:number,total:number)=>void,puente?:PuenteGhostscript,operacion:'grises'|'linearizar'|'pdfa1'|'pdfa2'='grises'):Promise<EntradaMotor[]> {
  if(!puente&&Capacitor.getPlatform()!=='android')throw new Error('La conversión a grises requiere la aplicación instalada en Android.');
  const motor=puente??Ghostscript;
  if(!entradas.length)throw new Error('Selecciona al menos un PDF.');
  for(const e of entradas) {
    if(!/\.pdf$/i.test(e.name))throw new Error('Selecciona archivos PDF.');
    if(!e.blob.size||e.blob.size>MAXIMO_ARCHIVO)throw new Error('Selecciona un PDF de hasta 50 MB.');
  }
  const comprobar=()=>{if(signal.aborted)throw new Error('Operación cancelada.');};
  let totalBytes=0;
  const resultados:EntradaMotor[]=[];
  for(const [i,e] of entradas.entries()) {
    comprobar();
    const {id}=await motor.crear();
    const cancelar=()=>{void motor.liberar({id}).catch(()=>undefined);};
    signal.addEventListener('abort',cancelar,{once:true});
    try {
      comprobar();
      for(let offset=0;offset<e.blob.size;offset+=512*1024) {
        comprobar();
        const bytes=new Uint8Array(await e.blob.slice(offset,offset+512*1024).arrayBuffer());
        let binario='';
        for(let n=0;n<bytes.length;n+=8192)binario+=String.fromCharCode(...bytes.subarray(n,n+8192));
        comprobar();await motor.escribir({id,data:btoa(binario)});
      }
      comprobar();
      const ejecutar=operacion==='grises'?motor.grises:operacion==='linearizar'?motor.linearizar:motor.pdfa?({id}:{id:string})=>motor.pdfa!({id,perfil:operacion==='pdfa1'?'1b':'2b'}):undefined;
      if(!ejecutar)throw new Error('El motor de optimización web no está instalado.');
      const {size}=await ejecutar.call(motor,{id});
      comprobar();
      if(!Number.isSafeInteger(size)||size<=0||size+totalBytes>CUOTA_LOCAL)throw new Error('Los resultados superan 250 MB o están vacíos.');
      const bloques:Uint8Array<ArrayBuffer>[]=[];
      for(let offset=0;offset<size;) {
        comprobar();const {data}=await motor.leer({id,offset});
        const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
        if(!bytes.length||bytes.length>512*1024||offset+bytes.length>size)throw new Error('No se ha podido leer el resultado completo.');
        bloques.push(bytes);offset+=bytes.length;
      }
      comprobar();
      resultados.push({name:operacion==='grises'?e.name.replace(/\.pdf$/i,'-grises.pdf'):operacion.startsWith('pdfa')?e.name.replace(/\.pdf$/i,'-pdfa.pdf'):e.name,blob:new Blob(bloques,{type:'application/pdf'})});
      totalBytes+=size;avance(i+1,entradas.length);
    } finally {
      signal.removeEventListener('abort',cancelar);
      await motor.liberar({id});
    }
  }
  return resultados;
}
