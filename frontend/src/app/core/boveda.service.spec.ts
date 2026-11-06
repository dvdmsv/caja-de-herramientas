import { BovedaService } from './boveda.service';
import { BovedaIlegible, ContrasenaIncorrecta } from './boveda/cifrado';
import { BOVEDA_DE_LA_0_3_0 } from './boveda/boveda-de-prueba';

/** Un disco de mentira detrás de un Tauri de mentira: lo comparten las «ventanas». */
let disco: string | null;

function ventana(): BovedaService {
  const boveda = new BovedaService();
  boveda.iteraciones = 1000;
  return boveda;
}

const firma = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const certificado = {
  nombre: 'El de la FNMT', titular: 'PEPA PÉREZ', emisor: 'FNMT', hasta: '2028-01-01', p12: 'MIIKpAIBAzCC', contrasena: '1234',
};

describe('la bóveda', () => {
  beforeEach(() => {
    disco = null;
    (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
      invoke: async (comando: string, argumentos?: { contenido?: string }) => {
        if (comando === 'leer_boveda') return disco;
        if (comando === 'guardar_boveda') disco = argumentos!.contenido!;
        if (comando === 'borrar_boveda') disco = null;
        if (comando === 'guardar_como') return 'C:\\copias\\boveda.json';
        return null;
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('fuera de la aplicación no existe', () => {
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
    const boveda = new BovedaService();
    expect(boveda.disponible).toBe(false);
    expect(boveda.estado).toBe('no-disponible');
  });

  it('se crea, se cierra y sólo se abre con su contraseña', async () => {
    const boveda = ventana();
    await boveda.comprobar();
    expect(boveda.estado).toBe('sin-crear');

    await boveda.crear('contraseña maestra');
    await boveda.guardarCertificado(certificado);
    await boveda.guardarFirma(firma(), 'La de siempre');
    boveda.cerrar();
    expect(boveda.estado).toBe('cerrada');
    expect(boveda.contenido.certificados).toEqual([]);

    await expect(boveda.abrir('otra cualquiera')).rejects.toBeInstanceOf(ContrasenaIncorrecta);
    expect(boveda.estado).toBe('cerrada');

    await boveda.abrir('contraseña maestra');
    expect(boveda.contenido.certificados.map(c => c.titular)).toEqual(['PEPA PÉREZ']);
    expect(boveda.usarCertificado(boveda.contenido.certificados[0]))
      .toEqual({ nombre: 'El de la FNMT', p12: 'MIIKpAIBAzCC', contrasena: '1234' });
    const archivo = boveda.firmaComoArchivo(boveda.contenido.firmas[0]);
    expect(archivo.name).toBe('La de siempre.png');
    expect(new Uint8Array(await archivo.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('en el disco no queda nada legible', async () => {
    const boveda = ventana();
    await boveda.crear('contraseña maestra');
    await boveda.guardarCertificado(certificado);

    expect(disco).not.toContain('PEPA');
    expect(disco).not.toContain('FNMT');
    expect(disco).not.toContain('MII');
    expect(disco).not.toContain('1234');
  });

  it('dos ventanas abiertas no se pisan lo que guarda cada una', async () => {
    const una = ventana();
    const otra = ventana();
    await una.crear('contraseña maestra');
    await otra.comprobar();
    await otra.abrir('contraseña maestra');

    await una.guardarCertificado(certificado);
    // La otra no lo ha visto aún, pero al guardar relee y lo conserva.
    await otra.guardarFirma(firma(), 'Firma');

    expect(otra.contenido.certificados).toHaveLength(1);
    expect(otra.contenido.firmas).toHaveLength(1);
  });

  it('si otra ventana cambia la contraseña, ésta se cierra al guardar y lo dice', async () => {
    const una = ventana();
    const otra = ventana();
    await una.crear('contraseña maestra');
    await otra.abrir('contraseña maestra');

    await una.cambiarContrasena('otra contraseña nueva');
    await expect(otra.guardarFirma(firma(), 'Firma')).rejects.toThrow(/otra ventana/);
    expect(otra.estado).toBe('cerrada');

    await otra.abrir('otra contraseña nueva');
    expect(otra.abierta).toBe(true);
  });

  it('no se crea dos veces ni con una contraseña corta', async () => {
    const boveda = ventana();
    await expect(boveda.crear('corta')).rejects.toThrow(/8 caracteres/);
    await boveda.crear('contraseña maestra');
    await expect(ventana().crear('otra contraseña más')).rejects.toThrow(/Ya hay una bóveda/);
  });

  it('borrarla la deja sin crear, también en otra ventana', async () => {
    const una = ventana();
    const otra = ventana();
    await una.crear('contraseña maestra');
    await otra.abrir('contraseña maestra');

    await una.borrar();
    expect(una.estado).toBe('sin-crear');
    await otra.comprobar();
    expect(otra.estado).toBe('sin-crear');
    expect(otra.contenido.firmas).toEqual([]);
  });

  it('renombrar y quitar se guardan', async () => {
    const boveda = ventana();
    await boveda.crear('contraseña maestra');
    await boveda.guardarFirma(firma(), 'Firma');
    const id = boveda.contenido.firmas[0].id;

    await boveda.renombrar(id, 'La buena');
    boveda.cerrar();
    await boveda.abrir('contraseña maestra');
    expect(boveda.contenido.firmas[0].nombre).toBe('La buena');

    await boveda.quitar(id);
    expect(boveda.contenido.firmas).toEqual([]);
  });

  describe('secretos', () => {
    const ficha = { nombre: 'GitHub', secreto: 'hunter2', usuario: 'pepa', web: 'github.com', notas: 'códigos: 998877' };

    it('se guardan, se cambian y se quitan, y nada se lee en el disco', async () => {
      const boveda = ventana();
      await boveda.crear('contraseña maestra');

      await boveda.guardarSecreto(ficha);
      for (const legible of ['GitHub', 'hunter2', 'pepa', 'github', '998877']) {
        expect(disco).not.toContain(legible);
      }

      const { id, anadido } = boveda.contenido.secretos[0];
      await boveda.actualizarSecreto(id, { nombre: 'GitHub', secreto: 'otra' });
      boveda.cerrar();
      expect(boveda.contenido.secretos).toEqual([]);

      await boveda.abrir('contraseña maestra');
      expect(boveda.contenido.secretos[0]).toMatchObject({ id, anadido, secreto: 'otra' });
      expect(boveda.contenido.secretos[0].usuario).toBeUndefined();

      await boveda.quitar(id);
      expect(boveda.contenido.secretos).toEqual([]);
    });

    it('dos ventanas no se pisan los secretos', async () => {
      const una = ventana();
      const otra = ventana();
      await una.crear('contraseña maestra');
      await otra.abrir('contraseña maestra');

      await una.guardarSecreto(ficha);
      await otra.guardarFirma(firma(), 'Firma');

      expect(otra.contenido.secretos.map(s => s.nombre)).toEqual(['GitHub']);
    });

    it('ver una ficha aplaza el cierre', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const boveda = ventana();
        await boveda.crear('contraseña maestra');
        vi.advanceTimersByTime(14 * 60 * 1000);
        boveda.seguirUsando();
        vi.advanceTimersByTime(14 * 60 * 1000);
        expect(boveda.abierta).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('una bóveda de la 0.3.0', () => {
    it('se abre con lo que tenía, y al guardar pasa a formato 2 sin perder nada', async () => {
      disco = BOVEDA_DE_LA_0_3_0;
      const boveda = ventana();

      await boveda.abrir('contraseña de la 0.3.0');
      expect(boveda.contenido.certificados.map(c => c.titular)).toEqual(['PEPA PÉREZ']);
      expect(boveda.contenido.secretos).toEqual([]);
      expect(JSON.parse(disco!).formato).toBe(1);

      await boveda.guardarSecreto({ nombre: 'GitHub', secreto: 'hunter2' });
      expect(JSON.parse(disco!).formato).toBe(2);
      boveda.cerrar();

      await boveda.abrir('contraseña de la 0.3.0');
      expect(boveda.contenido.certificados.map(c => c.titular)).toEqual(['PEPA PÉREZ']);
      expect(boveda.contenido.firmas.map(f => f.nombre)).toEqual(['La de siempre']);
      expect(boveda.contenido.secretos.map(s => s.nombre)).toEqual(['GitHub']);
    });
  });

  describe('la copia de seguridad', () => {
    it('sale cifrada, y restaurarla deja la bóveda abierta con su contraseña', async () => {
      const boveda = ventana();
      await boveda.crear('contraseña maestra');
      await boveda.guardarSecreto({ nombre: 'GitHub', secreto: 'hunter2' });

      const copia = await boveda.exportar();
      expect(copia).toBe(disco);
      expect(copia).not.toContain('hunter2');

      await boveda.borrar();
      expect(boveda.estado).toBe('sin-crear');

      await boveda.importar(copia, 'contraseña maestra');
      expect(boveda.abierta).toBe(true);
      expect(boveda.contenido.secretos.map(s => s.nombre)).toEqual(['GitHub']);
      expect(disco).toBe(copia);
    });

    it('con otra contraseña, o si no es una copia, no toca la bóveda que hay', async () => {
      const boveda = ventana();
      await boveda.crear('contraseña maestra');
      const copia = await boveda.exportar();
      await boveda.guardarSecreto({ nombre: 'La que hay', secreto: 'x' });
      const antes = disco;

      await expect(boveda.importar(copia, 'otra cualquiera')).rejects.toBeInstanceOf(ContrasenaIncorrecta);
      await expect(boveda.importar('no es una copia', 'contraseña maestra')).rejects.toBeInstanceOf(BovedaIlegible);

      expect(disco).toBe(antes);
      expect(boveda.contenido.secretos.map(s => s.nombre)).toEqual(['La que hay']);
    });

    it('se guarda con el diálogo de Windows', async () => {
      const boveda = ventana();
      await boveda.crear('contraseña maestra');
      expect(await boveda.guardarCopia()).toBe('C:\\copias\\boveda.json');
    });

    it('sin bóveda no hay nada que exportar', async () => {
      await expect(ventana().exportar()).rejects.toThrow(/No hay ninguna/);
    });
  });

  it('se cierra sola tras un rato sin usarla', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const boveda = ventana();
      await boveda.crear('contraseña maestra');
      vi.advanceTimersByTime(14 * 60 * 1000);
      boveda.firmaComoArchivo({ id: 'x', nombre: 'x', tipo: 'image/png', imagen: '', anadida: '' });
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(boveda.abierta).toBe(true);
      vi.advanceTimersByTime(60 * 1000 + 1);
      expect(boveda.estado).toBe('cerrada');
    } finally {
      vi.useRealTimers();
    }
  });
});
