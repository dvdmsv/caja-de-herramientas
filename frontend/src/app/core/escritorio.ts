/**
 * Lo que cambia cuando la página va dentro de la aplicación de escritorio.
 *
 * La misma página sirve para la web y para la aplicación de Windows (la carga
 * el backend en 127.0.0.1 dentro de una ventana de Tauri). Allí hay dos cosas
 * que el navegador no puede hacer y la aplicación sí:
 *
 * - **Guardar con el diálogo de Windows**, eligiendo carpeta y nombre, en vez
 *   de dejar el archivo en Descargas sin preguntar.
 * - **Recibir archivos de «Abrir con…»** del Explorador.
 *
 * Se habla con Tauri por `window.__TAURI_INTERNALS__`, que inyecta él mismo, y
 * no con su biblioteca `@tauri-apps/api`: serían kilobytes para todo el mundo
 * que usa la web por tres llamadas. Los comandos están en
 * `escritorio/src-tauri/src/main.rs`.
 *
 * Fuera de la aplicación no existe el puente y todo sigue como siempre. Y si
 * existe pero rechaza la llamada (otra ventana sin permiso), también: se vuelve
 * a lo del navegador en vez de dejar al usuario sin su archivo.
 */

/** Lo poco de `__TAURI_INTERNALS__` que se usa. */
export interface PuenteTauri {
  invoke(comando: string, argumentos?: unknown, opciones?: { headers?: Record<string, string> }): Promise<unknown>;
}

/** El evento con el que main.rs avisa de que han llegado archivos nuevos. */
export const EVENTO_ABIERTOS = 'escritorio:archivos-abiertos';

export function puente(ventana: unknown = globalThis): PuenteTauri | null {
  const internos = (ventana as { __TAURI_INTERNALS__?: Partial<PuenteTauri> }).__TAURI_INTERNALS__;
  return typeof internos?.invoke === 'function' ? (internos as PuenteTauri) : null;
}

/**
 * Guarda con «Guardar como». Devuelve `true` si lo ha guardado, `false` si la
 * persona ha cerrado el diálogo, y lanza si no se ha podido escribir.
 *
 * El contenido va en bruto y el nombre en una cabecera codificada como en una
 * URL: las cabeceras sólo admiten ASCII y los nombres llevan tildes.
 */
export async function guardarConDialogo(tauri: PuenteTauri, blob: Blob, nombre: string): Promise<boolean> {
  const datos = new Uint8Array(await blob.arrayBuffer());
  const guardado = await tauri.invoke('guardar_como', datos, {
    headers: { 'x-nombre': encodeURIComponent(nombre) },
  });
  return guardado === true;
}

/** La versión instalada, la de `tauri.conf.json`. Sirve para decirla al pedir ayuda. */
export async function versionDeLaAplicacion(tauri: PuenteTauri): Promise<string> {
  return String(await tauri.invoke('plugin:app|version'));
}

/** Los archivos que han llegado con «Abrir con…» y aún no se han recogido. */
export async function recogerAbiertos(tauri: PuenteTauri): Promise<File[]> {
  const rutas = (await tauri.invoke('archivos_pendientes')) as string[];
  const archivos: File[] = [];
  for (const ruta of rutas) {
    const contenido = (await tauri.invoke('leer_archivo', { ruta })) as ArrayBuffer;
    archivos.push(new File([contenido], nombreDeRuta(ruta)));
  }
  return archivos;
}

/**
 * El nombre del archivo en una ruta de Windows. Sin tipo MIME: el catálogo
 * reconoce los formatos también por la extensión (`encaja`).
 */
export function nombreDeRuta(ruta: string): string {
  return ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;
}

/**
 * Si la llamada la ha rechazado Tauri por permisos. Pasa en una ventana que la
 * capacidad no cubre; entonces se hace lo del navegador.
 */
export function esFaltaDePermiso(error: unknown): boolean {
  const texto = String((error as { message?: string })?.message ?? error);
  return /not allowed|permission|denied/i.test(texto);
}
