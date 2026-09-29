import {
  AvisoActualizacion, ReleaseGitHub, compararVersiones, comoSeActualiza, htmlDelAviso, leerNotas, novedadesEntre, soloLaUltima,
} from './novedades';

// Tal cual están en GitHub: la 0.1.4 con el formato antiguo, la 0.2.0 con el de ahora.
const V014 = `Instalador para Windows 10 y 11 (64 bits). Todavía **sin firmar**.

## Novedades desde v0.1.3

- feat(escritorio): aviso al guardar con «Mostrar en la carpeta»
- ci(escritorio): la página comprueba el puente desde dentro
- fix(escritorio): permisos de los comandos propios y soltar archivos`;

const V020 = `Instalador para Windows 10 y 11 (64 bits). Todavía **sin firmar**.

## Novedades desde v0.1.4

- Añadir una carpeta y guardar todo en una carpeta
- Lotes en las herramientas de un solo PDF

## Arreglos desde v0.1.4

- El visor ya no se queda en blanco`;

const releases: ReleaseGitHub[] = [
  { tag_name: 'v0.2.1', body: '## Novedades desde v0.2.0\n\n- Novedades en el aviso', published_at: '2026-10-01T10:00:00Z' },
  { tag_name: 'v0.2.0', body: V020, published_at: '2026-09-28T10:00:00Z' },
  { tag_name: 'v0.1.4', body: V014 },
  { tag_name: 'v0.3.0-beta', body: '- feat: a medias', prerelease: true },
  { tag_name: 'v0.2.2', body: '', draft: true },
];

const aviso: AvisoActualizacion = { version: '0.2.1', instalada: '0.1.3', notas: null, fecha: null };

describe('novedades de una actualización', () => {
  it('lee el formato de ahora, por apartados', () => {
    expect(leerNotas(V020)).toEqual({
      novedades: ['Añadir una carpeta y guardar todo en una carpeta', 'Lotes en las herramientas de un solo PDF'],
      arreglos: ['El visor ya no se queda en blanco'],
    });
  });

  it('del formato antiguo se queda con feat y fix, sin el prefijo', () => {
    expect(leerNotas(V014)).toEqual({
      novedades: ['Aviso al guardar con «Mostrar en la carpeta»'],
      arreglos: ['Permisos de los comandos propios y soltar archivos'],
    });
  });

  it('sin notas, o con «Mejoras internas», no hay nada que listar', () => {
    expect(leerNotas(null)).toEqual({ novedades: [], arreglos: [] });
    expect(leerNotas('Mejoras internas y de rendimiento.')).toEqual({ novedades: [], arreglos: [] });
  });

  it('compara versiones por números, no por texto', () => {
    expect(compararVersiones('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compararVersiones('v0.2.0', '0.2.0')).toBe(0);
    expect(compararVersiones('0.2', '0.2.1')).toBeLessThan(0);
  });

  it('quien se ha saltado versiones ve las de todas, de la más nueva a la más antigua', () => {
    const versiones = novedadesEntre(releases, '0.1.3', '0.2.1');
    expect(versiones.map(v => v.version)).toEqual(['0.2.1', '0.2.0', '0.1.4']);
    expect(versiones[0].novedades).toEqual(['Novedades en el aviso']);
  });

  it('ni la instalada, ni lo posterior a la nueva, ni borradores ni versiones previas', () => {
    expect(novedadesEntre(releases, '0.2.0', '0.2.1').map(v => v.version)).toEqual(['0.2.1']);
  });

  it('sin GitHub, las de la última, que vienen en latest.json', () => {
    const [ultima] = soloLaUltima({ ...aviso, notas: '## Novedades desde v0.2.0\n\n- Novedades en el aviso' });
    expect(ultima).toMatchObject({ version: '0.2.1', novedades: ['Novedades en el aviso'], arreglos: [] });
  });

  it('el aviso escapa lo que viene de GitHub', () => {
    const html = htmlDelAviso(aviso, [
      { version: '0.2.1', fecha: null, url: null, novedades: ['<img src=x onerror=alert(1)>'], arreglos: [] },
    ], true);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tienes la 0.1.3');
  });

  it('dice cuándo faltan las versiones intermedias, y una versión sin cambios que contar', () => {
    const html = htmlDelAviso(aviso, [{ version: '0.2.1', fecha: null, url: null, novedades: [], arreglos: [] }], false);
    expect(html).toContain('Mejoras internas');
    expect(html).toContain('No se ha podido consultar GitHub');
  });

  it('con paquete dice cuánto se baja; sin él, que es la versión completa', () => {
    expect(comoSeActualiza({ ...aviso, descarga: 12.4 * 1024 * 1024 })).toContain('Descarga: 12 MB');
    expect(comoSeActualiza({ ...aviso, descarga: 3.46 * 1024 * 1024 })).toContain('Descarga: 3,5 MB');
    expect(comoSeActualiza(aviso)).toContain('versión completa');
    expect(htmlDelAviso({ ...aviso, descarga: 1024 * 1024 }, [], true)).toContain('Descarga: 1 MB');
  });

  it('si la vez anterior falló, dice por qué y que va la versión completa', () => {
    const texto = comoSeActualiza({ ...aviso, descarga: 1024, fallo_anterior: 'backend/x: acceso denegado' });
    expect(texto).toContain('backend/x: acceso denegado');
    expect(texto).toContain('versión completa');
    expect(texto).not.toContain('Descarga:');
    expect(htmlDelAviso({ ...aviso, fallo_anterior: '<b>' }, [], true)).toContain('&lt;b&gt;');
  });
});

