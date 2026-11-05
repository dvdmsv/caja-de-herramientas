export interface Pareja {a:number|null;b:number|null;estado:'igual'|'cambiada'|'añadida'|'quitada'}

/** Coincidencias contiguas más largas, sin descartar líneas repetidas como ruido. */
export function alinear(a:string[],b:string[]):Pareja[] {
  const posiciones=new Map<string,number[]>();
  b.forEach((s,j)=>{const list=posiciones.get(s)??[];list.push(j);posiciones.set(s,list);});
  const pendientes:number[][]=[[0,a.length,0,b.length]],bloques:number[][]=[];
  let trabajo=0;
  while(pendientes.length) {
    const [a0,a1,b0,b1]=pendientes.pop()!;
    let mejor=0,ai=a0,bj=b0,prev=new Map<number,number>();
    for(let i=a0;i<a1;i++) {
      const next=new Map<number,number>();
      for(const j of posiciones.get(a[i])??[]) {
        if(j<b0)continue;if(j>=b1)break;
        if(++trabajo>25_000_000)throw new Error('Hay demasiadas líneas repetidas para comparar este documento. Divide el PDF en tramos.');
        const len=(prev.get(j-1)??0)+1;next.set(j,len);
        if(len>mejor){mejor=len;ai=i-len+1;bj=j-len+1;}
      }
      prev=next;
    }
    if(mejor) {
      bloques.push([ai,bj,mejor]);
      if(a0<ai&&b0<bj)pendientes.push([a0,ai,b0,bj]);
      if(ai+mejor<a1&&bj+mejor<b1)pendientes.push([ai+mejor,a1,bj+mejor,b1]);
    }
  }
  bloques.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);bloques.push([a.length,b.length,0]);
  const parejas:Pareja[]=[];let i=0,j=0;
  for(const [x,y,len] of bloques) {
    while(i<x&&j<y)parejas.push({a:i++,b:j++,estado:'cambiada'});
    while(i<x)parejas.push({a:i++,b:null,estado:'quitada'});
    while(j<y)parejas.push({a:null,b:j++,estado:'añadida'});
    for(let k=0;k<len;k++)parejas.push({a:i++,b:j++,estado:'igual'});
  }
  return parejas;
}
export function huella(texto:string):string{return texto.trim().replace(/\s+/g,' ').toLowerCase();}
export type Zona=[number,number,number,number];
/** Diferencia RGB: también detecta cambios de color con luminancia idéntica. */
export function zonasCambiadas(a:Uint8Array|Uint8ClampedArray,b:Uint8Array|Uint8ClampedArray,w:number,h:number):Zona[] {
  if(a.length!==w*h*3||b.length!==a.length)throw new Error('Las imágenes comparadas no tienen el mismo tamaño RGB.');
  const bandas:Zona[]=[];
  for(let y=0;y<h;y++) {
    let x0=w,x1=-1;
    for(let x=0;x<w;x++) {
      const p=(y*w+x)*3;
      if(Math.max(Math.abs(a[p]-b[p]),Math.abs(a[p+1]-b[p+1]),Math.abs(a[p+2]-b[p+2]))>=40){x0=Math.min(x0,x);x1=x;}
    }
    if(x1<0)continue;
    const last=bandas.at(-1);
    if(last&&y-last[3]<=10){last[0]=Math.min(last[0],x0);last[2]=Math.max(last[2],x1+1);last[3]=y+1;}
    else bandas.push([x0,y,x1+1,y+1]);
  }
  return bandas.filter(z=>z[3]-z[1]>=3);
}
export function recuadrar(data:Uint8Array|Uint8ClampedArray,w:number,h:number,zonas:Zona[]):void {
  for(const [a,b,c,d] of zonas) {
    const x0=Math.max(0,a-4),y0=Math.max(0,b-4),x1=Math.min(w-1,c+4),y1=Math.min(h-1,d+4);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
      const alpha=x<x0+2||x>x1-2||y<y0+2||y>y1-2?1:30/255,i=(y*w+x)*3;
      for(let k=0;k<3;k++)data[i+k]=Math.round(data[i+k]*(1-alpha)+[214,45,45][k]*alpha);
    }
  }
}
