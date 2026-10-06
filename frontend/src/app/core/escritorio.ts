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

import type { CambiosAjustes, EstadoAjustes } from './ajustes-escritorio';
import { AccionMenu, AjustesMenu } from './menu-contextual';
import type { AvisoActualizacion } from './novedades';

/** Lo poco de `__TAURI_INTERNALS__` que se usa. */
export interface PuenteTauri {
  invoke(comando: string, argumentos?: unknown, opciones?: { headers?: Record<string, string> }): Promise<unknown>;
}

/** El evento con el que main.rs avisa de que han llegado archivos nuevos. */
export const EVENTO_ABIERTOS = 'escritorio:archivos-abiertos';

/** El evento con el que main.rs avisa de que hay una versión nueva. */
export const EVENTO_ACTUALIZACION = 'escritorio:actualizacion';

export function puente(ventana: unknown = globalThis): PuenteTauri | null {
  const internos = (ventana as { __TAURI_INTERNALS__?: Partial<PuenteTauri> }).__TAURI_INTERNALS__;
  return typeof internos?.invoke === 'function' ? (internos as PuenteTauri) : null;
}

/**
 * Guarda con «Guardar como». Devuelve dónde se ha guardado, `null` si la
 * persona ha cerrado el diálogo, y lanza si no se ha podido escribir.
 *
 * El contenido va en bruto y el nombre en una cabecera codificada como en una
 * URL: las cabeceras sólo admiten ASCII y los nombres llevan tildes.
 */
export async function guardarConDialogo(tauri: PuenteTauri, blob: Blob, nombre: string): Promise<string | null> {
  const datos = new Uint8Array(await blob.arrayBuffer());
  const ruta = await tauri.invoke('guardar_como', datos, {
    headers: { 'x-nombre': encodeURIComponent(nombre) },
  });
  return typeof ruta === 'string' ? ruta : null;
}

/** Abre el Explorador con lo último que se ha guardado, seleccionado. */
export async function mostrarGuardado(tauri: PuenteTauri): Promise<void> {
  await tauri.invoke('mostrar_guardado');
}

/**
 * Una ruta de Windows partida para el aviso: el archivo y la carpeta donde ha
 * quedado. La carpeta se acorta a sus dos últimos tramos, que es lo que se
 * reconoce de un vistazo («Documentos\Contratos»), y no la ruta entera.
 */
export function describirGuardado(ruta: string): { archivo: string; carpeta: string } {
  const partes = ruta.split(/[\\/]/).filter(Boolean);
  const archivo = partes.pop() ?? ruta;
  return { archivo, carpeta: acortarCarpeta(partes.join('\\')) };
}

/** Una carpeta, acortada a sus dos últimos tramos: «…\\Documents\\Contratos». */
export function acortarCarpeta(carpeta: string): string {
  const partes = carpeta.split(/[\\/]/).filter(Boolean);
  return partes.length > 2 ? `…\\${partes.slice(-2).join('\\')}` : partes.join('\\');
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
 * Si lo que ha llegado por «Abrir con…» (sin herramienta) va directo al visor:
 * un solo PDF, salvo que se haya pedido en Ajustes → Ventana que vaya a la
 * portada. Varios archivos, u otro formato, van siempre a la portada, que
 * ofrece las herramientas que los aceptan.
 */
export function vaAlVisor(llegada: Llegada, pdfEnLaPortada: boolean): boolean {
  return !llegada.herramienta && !pdfEnLaPortada && llegada.archivos.length === 1
    && /\.pdf$/i.test(llegada.archivos[0].name);
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
    llegadas.push({ herramienta: pendiente.herramienta, archivos: await leerRutas(tauri, pendiente.rutas) });
  }
  return llegadas;
}

/** Lee del disco, por `leer_archivo`, archivos que main.rs ya ha dado por buenos. */
async function leerRutas(tauri: PuenteTauri, rutas: string[]): Promise<File[]> {
  const archivos: File[] = [];
  for (const ruta of rutas) {
    const contenido = (await tauri.invoke('leer_archivo', { ruta })) as ArrayBuffer;
    archivos.push(new File([contenido], nombreDeRuta(ruta)));
  }
  return archivos;
}

/** Lo que trae «Añadir carpeta». */
export interface ArchivosDeCarpeta {
  carpeta: string;
  archivos: File[];
  /** Los que no se han traído por pasar del tope. */
  sobran: number;
}

/**
 * «Añadir carpeta»: el diálogo de Windows y los archivos de esa carpeta con
 * esas extensiones, sin subcarpetas. `null` si se cierra el diálogo.
 */
export async function elegirCarpeta(tauri: PuenteTauri, extensiones: string[]): Promise<ArchivosDeCarpeta | null> {
  const respuesta = (await tauri.invoke('elegir_carpeta', { extensiones })) as
    { carpeta: string; rutas: string[]; sobran: number } | null;
  if (!respuesta) {
    return null;
  }
  return { carpeta: respuesta.carpeta, archivos: await leerRutas(tauri, respuesta.rutas), sobran: respuesta.sobran };
}

/**
 * «Guardar todo en una carpeta», primer paso: el diálogo para elegirla.
 * Devuelve cuál, o `null` si se cierra.
 */
export async function elegirDestino(tauri: PuenteTauri): Promise<string | null> {
  const carpeta = await tauri.invoke('elegir_destino');
  return typeof carpeta === 'string' ? carpeta : null;
}

/**
 * Escribe un archivo en la carpeta elegida con `elegirDestino`, sin sobrescribir
 * ninguno; devuelve dónde ha quedado. Como `guardarConDialogo`: en bruto y con el
 * nombre en una cabecera.
 */
export async function guardarEnDestino(tauri: PuenteTauri, blob: Blob, nombre: string): Promise<string> {
  const datos = new Uint8Array(await blob.arrayBuffer());
  return String(await tauri.invoke('guardar_en_destino', datos, {
    headers: { 'x-nombre': encodeURIComponent(nombre) },
  }));
}

/** Abre otra ventana de la aplicación, vacía y con su propia sesión. */
export async function nuevaVentana(tauri: PuenteTauri): Promise<void> {
  await tauri.invoke('nueva_ventana');
}

/** La versión nueva que ha encontrado main.rs, una sola vez; `null` si no hay o ya la enseñó otra ventana. */
export async function actualizacionPendiente(tauri: PuenteTauri): Promise<AvisoActualizacion | null> {
  return ((await tauri.invoke('actualizacion_pendiente')) as AvisoActualizacion | null) ?? null;
}

/** Lo que ha decidido la persona en el aviso de actualización. */
export async function responderActualizacion(
  tauri: PuenteTauri, respuesta: 'actualizar' | 'saltar' | 'despues',
): Promise<void> {
  await tauri.invoke('responder_actualizacion', { respuesta });
}

/** Los ajustes de la aplicación y si hay cambios que esperan a volver a abrirla. */
export async function leerAjustes(tauri: PuenteTauri): Promise<EstadoAjustes> {
  return (await tauri.invoke('leer_ajustes')) as EstadoAjustes;
}

/** Guarda los cambios (sólo lo que la página puede tocar; ver `ajustes::mezclar`). */
export async function guardarAjustes(tauri: PuenteTauri, cambios: CambiosAjustes): Promise<EstadoAjustes> {
  return (await tauri.invoke('guardar_ajustes', { cambios })) as EstadoAjustes;
}

/** «Siempre en esta carpeta»: la elige el diálogo de Windows. `null` si se cierra. */
export async function elegirCarpetaDeGuardado(tauri: PuenteTauri): Promise<EstadoAjustes | null> {
  return ((await tauri.invoke('elegir_carpeta_de_guardado')) as EstadoAjustes | null) ?? null;
}

/** «Buscar ahora»: la versión nueva, o `null` si ya se tiene la última. */
export async function buscarActualizacionAhora(tauri: PuenteTauri): Promise<string | null> {
  return ((await tauri.invoke('buscar_actualizacion_ahora')) as string | null) ?? null;
}

export async function abrirCarpetaDeDatos(tauri: PuenteTauri): Promise<void> {
  await tauri.invoke('abrir_carpeta_de_datos');
}

/** El texto de «Copiar información para soporte». */
export async function informacionDeSoporte(tauri: PuenteTauri): Promise<string> {
  return String(await tauri.invoke('informacion_de_soporte'));
}

/** Vuelve a abrir la aplicación, para que valgan los cambios de «Avanzado». */
export async function reiniciar(tauri: PuenteTauri): Promise<void> {
  await tauri.invoke('reiniciar');
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
