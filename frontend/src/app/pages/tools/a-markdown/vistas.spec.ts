import { VistaPrevia } from '../../../core/api.service';
import { adelgazamiento, markdownUnido } from './vistas';

const vista = (nombre: string, texto: string | null): VistaPrevia =>
  ({ nombre, texto, caracteres: texto?.length ?? 99, palabras: 1, original: 100, markdown: 10 });

describe('markdownUnido', () => {
  it('como «Unir» en el backend: cada uno bajo su título, separados por una línea en blanco', () => {
    // El mismo texto que devuelve `_unidos` para estos dos (test_a_markdown.py).
    expect(markdownUnido([vista('uno.txt', 'Primero de todos'), vista('dos.txt', 'El segundo documento')]))
      .toBe('# uno.txt\n\nPrimero de todos\n\n# dos.txt\n\nEl segundo documento');
  });

  it('nada si a alguno le falta el texto', () => {
    expect(markdownUnido([vista('uno.txt', 'hola'), vista('grande.pdf', null)])).toBeNull();
  });
});

describe('adelgazamiento', () => {
  const MB = 1024 * 1024;

  it('de cuánto a cuánto, y qué parte queda', () => {
    expect(adelgazamiento(2.3 * MB, 14 * 1024)).toMatch(/^de 2,3 MB a 14(,0)? KB \(0,6 %\)$/);
    expect(adelgazamiento(1000, 250)).toContain('(25 %)');
  });

  it('por debajo del 0,1 %, sin ceros que no dicen nada', () => {
    expect(adelgazamiento(500 * MB, 10 * 1024)).toContain('(menos del 0,1 %)');
  });

  it('si crece o se queda igual, lo dice así', () => {
    expect(adelgazamiento(1000, 1200)).toContain('(crece un 20 %)');
    expect(adelgazamiento(28, 28)).toBe('de 28 B a 28 B (igual)');
  });

  it('sin original, nada', () => {
    expect(adelgazamiento(0, 100)).toBeNull();
  });
});
