import { nombreDelTexto } from './nombre';

describe('nombreDelTexto', () => {
  it('el primer título, del nivel que sea', () => {
    expect(nombreDelTexto('Algo de texto\n\n## Acta de la reunión\n\n# Otro')).toBe('Acta de la reunión');
    expect(nombreDelTexto('# Informe trimestral #\n')).toBe('Informe trimestral');
  });

  it('sin las marcas de Markdown, y de un enlace sólo su texto', () => {
    expect(nombreDelTexto('# **Plan** de _obra_ con `código`')).toBe('Plan de obra con código');
    expect(nombreDelTexto('# Ver [la web](https://ejemplo.es) (borrador)')).toBe('Ver la web (borrador)');
  });

  it('sin lo que Windows no admite en un nombre', () => {
    expect(nombreDelTexto('# Pedido 2026/10: ¿qué falta?')).toBe('Pedido 2026 10 ¿qué falta');
    expect(nombreDelTexto('# Notas\r\n')).toBe('Notas');
  });

  it('cortado a 60 caracteres y sin punto ni espacio al final', () => {
    const nombre = nombreDelTexto('# ' + 'palabra '.repeat(20));
    expect(nombre.length).toBeLessThanOrEqual(60);
    expect(nombre).not.toMatch(/[. ]$/);
    expect(nombreDelTexto('# Fin.')).toBe('Fin');
  });

  it('sin título, o con un título vacío, «texto»', () => {
    expect(nombreDelTexto('Solo un párrafo\n#hashtag')).toBe('texto');
    expect(nombreDelTexto('# ***\n')).toBe('texto');
    expect(nombreDelTexto('')).toBe('texto');
  });
});
