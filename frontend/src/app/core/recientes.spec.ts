import { anotarReciente, leerRecientes } from './recientes';

describe('herramientas recientes', () => {
  it('la última va delante, sin repetirse, y sólo se recuerdan cuatro', () => {
    let lista: string[] = [];
    ['a', 'b', 'c', 'a', 'd', 'e'].forEach(slug => (lista = anotarReciente(lista, slug)));
    expect(lista).toEqual(['e', 'd', 'a', 'c']);
  });

  it('lo guardado roto o de otro tipo no rompe nada', () => {
    expect(leerRecientes(null)).toEqual([]);
    expect(leerRecientes('{no es json')).toEqual([]);
    expect(leerRecientes('{"a":1}')).toEqual([]);
    expect(leerRecientes('["unir-pdf", 3, "firmar"]')).toEqual(['unir-pdf', 'firmar']);
  });
});
