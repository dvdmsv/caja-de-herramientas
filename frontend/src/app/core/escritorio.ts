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

import { AccionMenu, AjustesMenu } from './menu-contextual';

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

/** Lo que llega de una vez: con herramienta, del menú del Explorador; sin ella, de «Abrir con…». */
export interface Llegada {
  herramienta: string | null;
  archivos: File[];
}

/**
 * Lo que ha llegado con «Abrir con…» o el menú del Explorador y aún no se ha
 * recogido. Varios archivos seleccionados juntos llegan en una sola llegada: los
 * agrupa main.rs.
 */
export async function recogerAbiertos(tauri: PuenteTauri): Promise<Llegada[]> {
  const pendientes = (await tauri.invoke('archivos_pendientes')) as { herramienta: string | null; rutas: string[] }[];
  const llegadas: Llegada[] = [];
  for (const pendiente of pendientes) {
    const archivos: File[] = [];
    for (const ruta of pendiente.rutas) {
      const contenido = (await tauri.invoke('leer_archivo', { ruta })) as ArrayBuffer;
      archivos.push(new File([contenido], nombreDeRuta(ruta)));
    }
    llegadas.push({ herramienta: pendiente.herramienta, archivos });
  }
  return llegadas;
}

/** Cómo está el menú del Explorador. */
export async function leerMenuContextual(tauri: PuenteTauri): Promise<AjustesMenu> {
  return (await tauri.invoke('menu_contextual')) as AjustesMenu;
}

/** Lo pone o lo quita, con las acciones dadas; devuelve cómo queda. */
export async function aplicarMenuContextual(
  tauri: PuenteTauri, activo: boolean, acciones: AccionMenu[],
): Promise<AjustesMenu> {
  return (await tauri.invoke('aplicar_menu_contextual', { activo, acciones })) as AjustesMenu;
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

/**
 * Cuánto tiene que durar un trabajo para avisar al terminar. Por debajo, quien
 * lo lanzó sigue delante y el aviso sólo molesta.
 */
export const AVISO_DESDE_MS = 10_000;

/** El progreso en el icono de la barra de tareas; sin porcentaje, «no se sabe». */
export async function progresoTarea(tauri: PuenteTauri, porcentaje: number | null, terminado: boolean): Promise<void> {
  await tauri.invoke('progreso_tarea', { porcentaje, terminado });
}

/** Una notificación de Windows; main.rs no la enseña si la ventana tiene el foco. */
export async function avisarFin(tauri: PuenteTauri, titulo: string, cuerpo: string): Promise<boolean> {
  return (await tauri.invoke('avisar_fin', { titulo, cuerpo })) === true;
}

/** Qué dice el aviso: la herramienta, si ha ido bien y sobre qué archivo. */
export function textoDelAviso(
  herramienta: string, bien: boolean, archivos: string[], mensaje = '',
): { titulo: string; cuerpo: string } {
  const sobre = archivos.length === 0 ? '' : archivos.length === 1 ? archivos[0] : `${archivos.length} archivos`;
  const listo = archivos.length > 1 ? `${sobre} están listos.` : sobre ? `${sobre} está listo.` : 'Ya está listo.';
  return bien
    ? { titulo: `${herramienta}: terminado`, cuerpo: listo }
    : { titulo: `${herramienta}: no se ha podido completar`, cuerpo: mensaje || sobre || 'Mira la aplicación para ver qué ha pasado.' };
}
