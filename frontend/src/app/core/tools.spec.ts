import { routes } from '../app.routes';
import { CATEGORIAS, HERRAMIENTAS, claveDeCategoria, rutaDe } from './tools';

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
});
