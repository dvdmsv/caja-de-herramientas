import {
  PuenteTauri, esFaltaDePermiso, guardarConDialogo, nombreDeRuta, puente, recogerAbiertos,
  versionDeLaAplicacion, leerMenuContextual, aplicarMenuContextual, textoDelAviso, progresoTarea,
  describirGuardado,
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
    const { falso, llamadas } = tauriFalso({ guardar_como: () => 'C:\\Users\\ana\\Documents\\Informe año 2026.pdf' });

    const guardado = await guardarConDialogo(falso, new Blob(['hola']), 'Informe año 2026.pdf');

    expect(guardado).toBe('C:\\Users\\ana\\Documents\\Informe año 2026.pdf');
    const [llamada] = llamadas;
    expect(llamada.comando).toBe('guardar_como');
    expect(llamada.argumentos).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(llamada.argumentos as Uint8Array)).toBe('hola');
    const cabecera = (llamada.opciones as { headers: Record<string, string> }).headers['x-nombre'];
    expect(cabecera).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(cabecera)).toBe('Informe año 2026.pdf');
  });

  it('cerrar el diálogo no es un error: sólo no se guarda', async () => {
    const { falso } = tauriFalso({ guardar_como: () => null });
    expect(await guardarConDialogo(falso, new Blob(['x']), 'a.pdf')).toBeNull();
  });

  it('recoge lo abierto con «Abrir con…» y el menú, cada llegada con su herramienta', async () => {
    const { falso, llamadas } = tauriFalso({
      archivos_pendientes: () => [
        { herramienta: null, rutas: ['C:\\Users\\ana\\Documents\\contrato firmado.pdf'] },
        { herramienta: 'comprimir-imagen', rutas: ['D:/fotos/IMG_0001.HEIC'] },
      ],
      leer_archivo: () => new TextEncoder().encode('%PDF').buffer,
    });

    const llegadas = await recogerAbiertos(falso);

    expect(llegadas.map(l => l.herramienta)).toEqual([null, 'comprimir-imagen']);
    expect(llegadas.flatMap(l => l.archivos).map(a => a.name)).toEqual(['contrato firmado.pdf', 'IMG_0001.HEIC']);
    expect(llamadas.filter(l => l.comando === 'leer_archivo').map(l => l.argumentos))
      .toEqual([{ ruta: 'C:\\Users\\ana\\Documents\\contrato firmado.pdf' }, { ruta: 'D:/fotos/IMG_0001.HEIC' }]);
  });

  it('el menú del Explorador se pide y se aplica con las acciones tal cual', async () => {
    const { falso, llamadas } = tauriFalso({
      menu_contextual: () => ({ activo: false, acciones: ['unir-pdf'] }),
      aplicar_menu_contextual: (a: unknown) => ({ activo: (a as { activo: boolean }).activo, acciones: ['unir-pdf'] }),
    });

    expect(await leerMenuContextual(falso)).toEqual({ activo: false, acciones: ['unir-pdf'] });
    const accion = { slug: 'unir-pdf', nombre: 'Unir PDF', extensiones: ['pdf'] };
    expect((await aplicarMenuContextual(falso, true, [accion])).activo).toBe(true);
    expect(llamadas[1].argumentos).toEqual({ activo: true, acciones: [accion] });
  });

  it('el aviso dice la herramienta, si ha ido bien y sobre qué', () => {
    expect(textoDelAviso('PDF con OCR', true, ['contrato.pdf']))
      .toEqual({ titulo: 'PDF con OCR: terminado', cuerpo: 'contrato.pdf está listo.' });
    expect(textoDelAviso('Unir PDF', true, ['a.pdf', 'b.pdf', 'c.pdf']).cuerpo).toBe('3 archivos están listos.');
    const fallo = textoDelAviso('PDF con OCR', false, ['contrato.pdf'], 'El reconocimiento ha tardado demasiado.');
    expect(fallo.titulo).toBe('PDF con OCR: no se ha podido completar');
    expect(fallo.cuerpo).toBe('El reconocimiento ha tardado demasiado.');
  });

  it('el progreso de la barra de tareas va sin porcentaje cuando no se sabe', async () => {
    const { falso, llamadas } = tauriFalso({ progreso_tarea: () => null });
    await progresoTarea(falso, null, false);
    await progresoTarea(falso, 40, false);
    expect(llamadas.map(l => l.argumentos)).toEqual([
      { porcentaje: null, terminado: false }, { porcentaje: 40, terminado: false },
    ]);
  });

  it('pregunta la versión a Tauri, que la saca de tauri.conf.json', async () => {
    const { falso, llamadas } = tauriFalso({ 'plugin:app|version': () => '0.1.0' });

    expect(await versionDeLaAplicacion(falso)).toBe('0.1.0');
    expect(llamadas[0].comando).toBe('plugin:app|version');
  });

  it('el aviso de guardado dice el archivo y la carpeta, acortada', () => {
    expect(describirGuardado('C:\\Users\\ana\\Documents\\Contratos\\contrato-comprimido.pdf'))
      .toEqual({ archivo: 'contrato-comprimido.pdf', carpeta: '…\\Documents\\Contratos' });
    expect(describirGuardado('D:\\Descargas\\a.pdf')).toEqual({ archivo: 'a.pdf', carpeta: 'D:\\Descargas' });
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
