import { leerPreferencia, resolverTema, siguientePreferencia } from './tema';

describe('tema', () => {
  it('sin preferencia guardada, o con una desconocida, sigue al sistema', () => {
    expect(leerPreferencia(null)).toBe('sistema');
    expect(leerPreferencia('morado')).toBe('sistema');
    expect(leerPreferencia('oscuro')).toBe('oscuro');
  });

  it('"sistema" obedece al sistema; las otras dos lo ignoran', () => {
    expect(resolverTema('sistema', true)).toBe('dark');
    expect(resolverTema('sistema', false)).toBe('light');
    expect(resolverTema('claro', true)).toBe('light');
    expect(resolverTema('oscuro', false)).toBe('dark');
  });

  it('el botón recorre las tres y vuelve a empezar', () => {
    expect(siguientePreferencia('sistema')).toBe('claro');
    expect(siguientePreferencia('claro')).toBe('oscuro');
    expect(siguientePreferencia('oscuro')).toBe('sistema');
  });
});
