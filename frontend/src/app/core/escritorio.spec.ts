import {
  PuenteTauri, esFaltaDePermiso, guardarConDialogo, nombreDeRuta, puente, recogerAbiertos,
  versionDeLaAplicacion,
} from './escritorio';

/** Un Tauri de mentira que apunta lo que le piden. */
function tauriFalso(respuestas: Record<string, (argumentos: unknown) => unknown>) {
  const llamadas: { comando: string; argumentos: unknown; opciones?: unknown }[] = [];
  const falso: PuenteTauri = {
    invoke: async (comando, argumentos, opciones) => {
      llamadas.push({ comando, argumentos, opciones });
      return respuestas[comando](argumentos);
    },
  };
  return { falso, llamadas };
}

describe('escritorio', () => {
  it('fuera de la aplicación no hay puente, y todo sigue como en la web', () => {
    expect(puente({})).toBeNull();
    expect(puente({ __TAURI_INTERNALS__: {} })).toBeNull();
    const invoke = async () => null;
    expect(puente({ __TAURI_INTERNALS__: { invoke } })?.invoke).toBe(invoke);
  });

  it('guarda en bruto, con el nombre en una cabecera que sólo lleva ASCII', async () => {
    const { falso, llamadas } = tauriFalso({ guardar_como: () => true });

    const guardado = await guardarConDialogo(falso, new Blob(['hola']), 'Informe año 2026.pdf');

    expect(guardado).toBe(true);
    const [llamada] = llamadas;
    expect(llamada.comando).toBe('guardar_como');
    expect(llamada.argumentos).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(llamada.argumentos as Uint8Array)).toBe('hola');
    const cabecera = (llamada.opciones as { headers: Record<string, string> }).headers['x-nombre'];
    expect(cabecera).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(cabecera)).toBe('Informe año 2026.pdf');
  });

  it('cerrar el diálogo no es un error: sólo no se guarda', async () => {
    const { falso } = tauriFalso({ guardar_como: () => false });
    expect(await guardarConDialogo(falso, new Blob(['x']), 'a.pdf')).toBe(false);
  });

  it('recoge lo abierto con «Abrir con…» con su nombre', async () => {
    const { falso, llamadas } = tauriFalso({
      archivos_pendientes: () => ['C:\\Users\\ana\\Documents\\contrato firmado.pdf', 'D:/fotos/IMG_0001.HEIC'],
      leer_archivo: () => new TextEncoder().encode('%PDF').buffer,
    });

    const archivos = await recogerAbiertos(falso);

    expect(archivos.map(a => a.name)).toEqual(['contrato firmado.pdf', 'IMG_0001.HEIC']);
    expect(llamadas.filter(l => l.comando === 'leer_archivo').map(l => l.argumentos))
      .toEqual([{ ruta: 'C:\\Users\\ana\\Documents\\contrato firmado.pdf' }, { ruta: 'D:/fotos/IMG_0001.HEIC' }]);
  });

  it('pregunta la versión a Tauri, que la saca de tauri.conf.json', async () => {
    const { falso, llamadas } = tauriFalso({ 'plugin:app|version': () => '0.1.0' });

    expect(await versionDeLaAplicacion(falso)).toBe('0.1.0');
    expect(llamadas[0].comando).toBe('plugin:app|version');
  });

  it('el nombre sale de rutas con barras de los dos lados', () => {
    expect(nombreDeRuta('C:\\a\\b\\c.pdf')).toBe('c.pdf');
    expect(nombreDeRuta('/home/x/y.png')).toBe('y.png');
    expect(nombreDeRuta('solo.pdf')).toBe('solo.pdf');
  });

  it('distingue un rechazo por permisos de un fallo de verdad', () => {
    expect(esFaltaDePermiso('guardar_como not allowed. Command not found')).toBe(true);
    expect(esFaltaDePermiso(new Error('No se ha podido guardar en C:\\x: acceso denegado'))).toBe(false);
  });
});
