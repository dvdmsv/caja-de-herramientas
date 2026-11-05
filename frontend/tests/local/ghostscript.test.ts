import {it,expect,vi} from 'vitest';
import {convertirGrises,type PuenteGhostscript} from '../../src/app/core/local/ghostscript';

function puente(salida=new Uint8Array([37,80,68,70,45])) {
  const entrada:Uint8Array[]=[];
  const p:PuenteGhostscript={
    crear:vi.fn(async()=>({id:'trabajo'})),
    escribir:vi.fn(async({data})=>{entrada.push(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}),
    grises:vi.fn(async()=>({size:salida.length})),
    leer:vi.fn(async({offset})=>({data:btoa(String.fromCharCode(...salida.subarray(offset,offset+4096)))})),
    liberar:vi.fn(async()=>{}),
  };
  return {p,entrada};
}
it('transfiere por bloques y recupera todos los bytes del resultado',async()=>{
  const bytes=Uint8Array.from({length:700000},(_,i)=>i%251),{p,entrada}=puente(bytes);
  const result=await convertirGrises([{name:'Plano.PDF',blob:new Blob([bytes])}],new AbortController().signal,()=>{},p);
  expect(entrada.map(x=>x.length)).toEqual([524288,175712]);
  expect(new Uint8Array(await new Blob(entrada).arrayBuffer())).toEqual(bytes);
  expect(new Uint8Array(await result[0].blob.arrayBuffer())).toEqual(bytes);
  expect(result[0].name).toBe('Plano-grises.pdf');expect(p.liberar).toHaveBeenCalledWith({id:'trabajo'});
});
it('cancela una conversión en curso y libera los temporales',async()=>{
  const {p}=puente(),c=new AbortController();
  p.grises=vi.fn(async()=>{c.abort();return {size:5};});
  await expect(convertirGrises([{name:'a.pdf',blob:new Blob(['%PDF-'])}],c.signal,()=>{},p)).rejects.toThrow('cancelada');
  expect(p.liberar).toHaveBeenCalled();expect(p.leer).not.toHaveBeenCalled();
});
it('no devuelve un lote parcial si falla un archivo y siempre libera',async()=>{
  const {p}=puente();p.grises=vi.fn().mockResolvedValueOnce({size:5}).mockRejectedValueOnce(new Error('PDF dañado'));
  await expect(convertirGrises(['a','b'].map(n=>({name:n+'.pdf',blob:new Blob(['%PDF-'])})),new AbortController().signal,()=>{},p)).rejects.toThrow('dañado');
  expect(p.liberar).toHaveBeenCalledTimes(2);
});
it('rechaza tamaños de salida inválidos y lecturas truncadas',async()=>{
  const {p}=puente(),e=[{name:'a.pdf',blob:new Blob(['%PDF-'])}];
  p.grises=async()=>({size:251*1024*1024});
  await expect(convertirGrises(e,new AbortController().signal,()=>{},p)).rejects.toThrow('250 MB');
  p.grises=async()=>({size:5});p.leer=async()=>({data:''});
  await expect(convertirGrises(e,new AbortController().signal,()=>{},p)).rejects.toThrow('completo');
});
it('valida el lote antes de crear archivos nativos',async()=>{
  const {p}=puente();
  await expect(convertirGrises([{name:'a.txt',blob:new Blob(['texto'])}],new AbortController().signal,()=>{},p)).rejects.toThrow('PDF');
  expect(p.crear).not.toHaveBeenCalled();
});
