import { alternarFavorito, leerFavoritos } from './favoritos';

describe('herramientas favoritas', () => {
  it('se añaden al final, en el orden en que se marcan, y se quitan al volver a pulsar', () => {
    let lista: string[] = [];
    ['firmar', 'unir-pdf', 'ocr-pdf'].forEach(slug => (lista = alternarFavorito(lista, slug)));
    expect(lista).toEqual(['firmar', 'unir-pdf', 'ocr-pdf']);

    lista = alternarFavorito(lista, 'unir-pdf');
    expect(lista).toEqual(['firmar', 'ocr-pdf']);
    expect(alternarFavorito(lista, 'unir-pdf')).toEqual(['firmar', 'ocr-pdf', 'unir-pdf']);
  });

  it('no cambia la lista que recibe', () => {
    const lista = ['firmar'];
    alternarFavorito(lista, 'unir-pdf');
    alternarFavorito(lista, 'firmar');
    expect(lista).toEqual(['firmar']);
  });

  it('lo guardado roto, de otro tipo o repetido no rompe nada', () => {
    expect(leerFavoritos(null)).toEqual([]);
    expect(leerFavoritos('{no es json')).toEqual([]);
    expect(leerFavoritos('{"a":1}')).toEqual([]);
    expect(leerFavoritos('["unir-pdf", 3, "firmar", "unir-pdf"]')).toEqual(['unir-pdf', 'firmar']);
  });
});
