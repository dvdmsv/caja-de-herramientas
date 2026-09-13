import { routes } from '../app.routes';
import { CATEGORIAS, HERRAMIENTAS, buscar, claveDeCategoria, destinosPara, rutaDe } from './tools';

/**
 * El catálogo y las rutas se declaran por separado (Angular necesita imports
 * estáticos para la carga diferida), así que aquí se comprueba que no se
 * desincronizan al añadir una herramienta nueva.
 */
describe('catálogo de herramientas', () => {
  it('no repite slugs', () => {
    const slugs = HERRAMIENTAS.map(h => h.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('cada herramienta disponible tiene su ruta registrada', () => {
    const declaradas = new Set(routes.map(r => `/${r.path}`));
    HERRAMIENTAS.filter(h => h.disponible).forEach(herramienta => {
      expect(declaradas.has(rutaDe(herramienta)), `falta la ruta de "${herramienta.nombre}" en app.routes.ts`)
        .toBe(true);
    });
  });

  it('ninguna herramienta pendiente tiene ruta (evita páginas a medias)', () => {
    const declaradas = new Set(routes.map(r => `/${r.path}`));
    HERRAMIENTAS.filter(h => !h.disponible).forEach(herramienta => {
      expect(declaradas.has(rutaDe(herramienta))).toBe(false);
    });
  });

  it('cada categoría tiene su clave de CSS, sin acentos ni mayúsculas', () => {
    const claves = CATEGORIAS.map(claveDeCategoria);
    expect(claves).toEqual(['pdf', 'imagenes', 'documentos']);
  });

  it('toda herramienta que recibe archivos declara cuáles (sólo QR y certificado no reciben)', () => {
    const sinArchivos = HERRAMIENTAS.filter(h => !h.acepta).map(h => h.slug).sort();
    expect(sinArchivos).toEqual(['crear-certificado', 'generar-qr']);
  });
});

describe('buscador', () => {
  const slugs = (texto: string) => buscar(texto).map(h => h.slug);

  it('encuentra por sinónimo, sin acentos ni mayúsculas', () => {
    expect(slugs('juntar')).toContain('unir-pdf');
    expect(slugs('CONTRASEÑA')).toContain('proteger-pdf');
    expect(slugs('ubicacion')).toContain('limpiar-metadatos');
  });

  it('pone primero lo que casa por el nombre', () => {
    expect(slugs('comprimir')[0]).toMatch(/^comprimir-/);
  });

  it('todas las palabras tienen que casar', () => {
    expect(slugs('comprimir imagen')).toEqual(['comprimir-imagen']);
    expect(slugs('')).toEqual([]);
    expect(slugs('xyzzy')).toEqual([]);
  });
});

describe('a qué herramientas mandar un archivo', () => {
  const pdf = { name: 'informe.pdf', type: '' };
  const foto = { name: 'foto.jpg', type: '' };
  const slugs = (archivos: { name: string; type: string }[], excepto?: string) =>
    destinosPara(archivos, excepto).map(h => h.slug);

  it('un PDF va a las herramientas de PDF y al visor, no a las de imagen', () => {
    const destinos = slugs([pdf]);
    expect(destinos).toEqual(expect.arrayContaining(['firmar', 'organizar-pdf', 'visor', 'a-markdown']));
    expect(destinos).not.toContain('comprimir-imagen');
  });

  it('no se ofrece la herramienta de la que viene', () => {
    expect(slugs([pdf], 'comprimir-pdf')).not.toContain('comprimir-pdf');
  });

  it('varios archivos sólo van a las herramientas que trabajan con varios', () => {
    const destinos = slugs([pdf, pdf]);
    expect(destinos).toContain('unir-pdf');
    expect(destinos).not.toContain('firmar');
    expect(slugs([pdf, foto])).toEqual(['limpiar-metadatos']);
  });
});
