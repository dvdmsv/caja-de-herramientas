import { DE_SERIE, accionesMarcadas, candidatas, extensionesDe } from './menu-contextual';
import { buscarPorSlug } from './tools';

describe('menú contextual', () => {
  it('cada acción sale sobre lo que acepta su herramienta, ni más ni menos', () => {
    expect(extensionesDe(buscarPorSlug('comprimir-pdf')!)).toEqual(['pdf']);
    expect(extensionesDe(buscarPorSlug('correo-a-pdf')!)).toEqual(['eml', 'msg']);

    // Las imágenes, también por extensión, HEIC incluido.
    const imagen = extensionesDe(buscarPorSlug('comprimir-imagen')!);
    expect(imagen).toContain('jpg');
    expect(imagen).toContain('heic');
    expect(imagen).not.toContain('pdf');

    // Una que acepta PDF e imágenes, las dos cosas.
    const firmar = extensionesDe(buscarPorSlug('firmar')!);
    expect(firmar).toContain('pdf');
    expect(firmar).toContain('png');
  });

  it('no ofrece las herramientas que no reciben archivos', () => {
    const slugs = candidatas().map(h => h.slug);
    expect(slugs).not.toContain('generar-qr');
    expect(slugs).not.toContain('crear-certificado');
    expect(slugs).toContain('unir-pdf');
  });

  it('las marcadas de serie existen y se pueden ofrecer', () => {
    const ofrecibles = new Set(candidatas().map(h => h.slug));
    for (const slug of DE_SERIE) {
      expect(ofrecibles.has(slug), slug).toBe(true);
    }
  });

  it('a Rust le llegan sólo las marcadas, con su nombre y extensiones, en el orden del catálogo', () => {
    const acciones = accionesMarcadas(['comprimir-imagen', 'unir-pdf', 'no-existe']);

    expect(acciones.map(a => a.slug)).toEqual(['unir-pdf', 'comprimir-imagen']);
    expect(acciones[0]).toEqual({ slug: 'unir-pdf', nombre: 'Unir PDF', extensiones: ['pdf'] });
  });

  it('todo lo que llega a Rust pasa su validación antes de tocar el registro', () => {
    for (const accion of accionesMarcadas(candidatas().map(h => h.slug))) {
      expect(accion.slug).toMatch(/^[a-z0-9-]+$/);
      for (const ext of accion.extensiones) {
        expect(ext).toMatch(/^[a-z0-9]+$/);
      }
    }
  });
});
