import { describe, it, expect } from 'vitest';
import { limpiarEscaneo } from '../../src/app/core/local/escaneo';

describe('escaneo local: iluminación, tinta y color', () => {
  const w = 200, h = 240;
  function foto() {
    const a = new Uint8ClampedArray(w*h*4);
    for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=(y*w+x)*4, sombra=1-0.45*(x/w*0.7+y/h*0.3);
      const tinta = x>30 && x<170 && y>30 && y<210 && y%20<2;
      for(let c=0;c<3;c++) a[i+c]=(tinta?35:[238,232,214][c])*sombra;
      a[i+3]=255;
    }
    return a;
  }
  for(const modo of ['blanco-y-negro','gris','color']) it(`blanquea sombras y conserva tinta en ${modo}`,()=>{
    const r=limpiarEscaneo(foto(),w,h,modo,50);
    for(const x of [10,100,190]) for(const c of [0,1,2]) expect(r[(15*w+x)*4+c]).toBeGreaterThanOrEqual(250);
    expect(r[(40*w+80)*4]).toBeLessThan(90);
    expect(r[(15*w+100)*4+3]).toBe(255);
    if(modo==='blanco-y-negro') expect(new Set(r)).toEqual(new Set([0,255]));
  });
  it('no convierte una imagen negra en papel blanco',()=>{
    const a=new Uint8ClampedArray(40*40*4); for(let i=3;i<a.length;i+=4)a[i]=255;
    const r=limpiarEscaneo(a,40,40,'color',100);
    expect(r[0]).toBe(0); expect(r[1]).toBe(0); expect(r[2]).toBe(0);
  });
  it('valida parámetros y tamaño',()=>{
    expect(()=>limpiarEscaneo(foto(),w,h,'otro',50)).toThrow('modo');
    expect(()=>limpiarEscaneo(foto(),w,h,'gris',101)).toThrow('intensidad');
    expect(()=>limpiarEscaneo(new Uint8ClampedArray(4),w,h,'gris',50)).toThrow('dimensiones');
  });
});
