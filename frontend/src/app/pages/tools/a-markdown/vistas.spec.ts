import { VistaPrevia } from '../../../core/api.service';
import { markdownUnido } from './vistas';

const vista = (nombre: string, texto: string | null): VistaPrevia =>
  ({ nombre, texto, caracteres: texto?.length ?? 99, palabras: 1 });

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
