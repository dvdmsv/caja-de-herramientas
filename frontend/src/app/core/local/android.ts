import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { App } from '@capacitor/app';
import type { NgZone } from '@angular/core';
import type { Router } from '@angular/router';
import type { Observable } from 'rxjs';
import { avisoError } from '../../shared/notify';
import { rutaDeAtajo } from './atajos';

const Documentos = registerPlugin<{
  guardar(opciones: { ruta: string; nombre: string; tipo: string }): Promise<{ guardado: boolean }>;
  compartir(opciones: { ruta: string; nombre: string; tipo: string }): Promise<void>;
}>('Documentos');
const Imagenes = registerPlugin<{ heicAJpeg(opciones: { ruta: string }): Promise<{ ruta: string }> }>('Imagenes');
interface Llegado { ruta?: string; nombre: string; tipo?: string; grande?: boolean; error?: boolean }
const Llegadas = registerPlugin<{
  tomar(): Promise<{ archivos: Llegado[] }>;
  soltar(opciones: { rutas: string[] }): Promise<void>;
  addListener(evento: 'llegada', escuchar: () => void): Promise<unknown>;
}>('Llegadas');
const Atajos = registerPlugin<{ fijar(opciones: { atajos: { slug: string; nombre: string }[] }): Promise<void> }>('Atajos');

/** Guardar y compartir abren una ventana del sistema: una cada vez. */
let ocupado = false;
/** Si la carpeta temporal de las exportaciones ya está creada en este arranque. */
let carpetaDeExportacion = false;

/**
 * Deja el `Blob` en `cache/exportaciones` para que lo use el lado nativo, y lo
 * borra al acabar. Va por bloques de 512 KB para no construir el base64 del
 * archivo entero en memoria.
 */
async function enCache<T>(blob: Blob, usar: (uri: string) => Promise<T>): Promise<T> {
  const path = `exportaciones/${crypto.randomUUID()}`;
  try {
    // Una vez por arranque: crearla cuando ya existe también acaba como error en la consola.
    if (!carpetaDeExportacion) {
      await Filesystem.mkdir({ path: 'exportaciones', directory: Directory.Cache, recursive: true }).catch(() => undefined);
      carpetaDeExportacion = true;
    }
    for (let inicio = 0; inicio < blob.size; inicio += 512 * 1024) {
      const datos = await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result).split(',')[1]);
        lector.onerror = () => reject(new Error('No se ha podido preparar el archivo.'));
        lector.readAsDataURL(blob.slice(inicio, inicio + 512 * 1024));
      });
      if (inicio === 0) await Filesystem.writeFile({ path, directory: Directory.Cache, data: datos });
      else await Filesystem.appendFile({ path, directory: Directory.Cache, data: datos });
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    return await usar(uri);
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}

/** Lee un archivo que ha dejado el lado nativo en la caché, sin pasarlo por base64. */
async function leerNativo(uri: string, nombre: string, tipo = ''): Promise<File> {
  const respuesta = await fetch(Capacitor.convertFileSrc(uri));
  if (!respuesta.ok) throw new Error(`No se ha podido leer ${nombre}.`);
  return new File([await respuesta.blob()], nombre, { type: tipo });
}

async function conVentana(accion: () => Promise<void>): Promise<void> {
  if (ocupado) throw new Error('Termina antes con el archivo anterior.');
  ocupado = true;
  try { await accion(); } finally { ocupado = false; }
}

export async function guardarEnAndroid(blob: Blob, nombre: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    // Permite comprobar la compilación Android también en un navegador local.
    const url = URL.createObjectURL(blob), enlace = document.createElement('a');
    enlace.href = url; enlace.download = nombre; enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  await conVentana(() => enCache(blob, async ruta => {
    await Documentos.guardar({ ruta, nombre, tipo: blob.type || 'application/octet-stream' });
  }));
}

/** La hoja de compartir de Android, para mandar un resultado a otra app sin guardarlo antes. */
export async function compartirEnAndroid(blob: Blob, nombre: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    await navigator.share?.({ files: [new File([blob], nombre, { type: blob.type })] });
    return;
  }
  await conVentana(() => enCache(blob, ruta =>
    Documentos.compartir({ ruta, nombre, tipo: blob.type || tipoPorNombre(nombre) })));
}

/** La app que recibe decide qué ofrecer por el tipo: un PDF sin él no se abre como PDF. */
function tipoPorNombre(nombre: string): string {
  const tipos: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', svg: 'image/svg+xml', zip: 'application/zip', md: 'text/markdown', txt: 'text/plain',
    csv: 'text/csv', json: 'application/json', epub: 'application/epub+zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    p12: 'application/x-pkcs12', crt: 'application/x-x509-ca-cert' };
  return tipos[nombre.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
}

export const ES_HEIC = /\.hei[cf]$/i;

/** HEIC/HEIF a JPEG con el decodificador de Android: el WebView no los lee. */
export async function heicAJpeg(archivo: File): Promise<File> {
  if (Capacitor.getPlatform() !== 'android') throw new Error('Las fotos HEIC sólo se abren en la aplicación de Android.');
  return enCache(archivo, async ruta => {
    const convertida = await Imagenes.heicAJpeg({ ruta });
    try { return await leerNativo(convertida.ruta, archivo.name.replace(ES_HEIC, '.jpg'), 'image/jpeg'); }
    finally { await Filesystem.deleteFile({ path: convertida.ruta }).catch(() => undefined); }
  });
}

/** Lo que está abierto encima de la página: un diálogo, la vista previa, un menú o una hoja. */
function capaAbierta(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.swal2-popup:not(.swal2-toast), [role=dialog][aria-modal=true], [aria-expanded=true]');
}

/**
 * Atrás de Android, como en cualquier aplicación: primero cierra lo que haya
 * abierto encima; si no, vuelve a la pantalla anterior; y desde el inicio
 * minimiza. Antes iba siempre al inicio, y con la vista previa de un resultado
 * abierta se perdía la pantalla de resultados.
 *
 * Para cerrar manda un Escape, que todas las capas ya atienden por el teclado.
 * Si después la capa sigue ahí —algo marcado como desplegado que no se cierra
 * con Escape—, se navega igual: Atrás nunca se queda sin hacer nada.
 */
async function atras(router: Router): Promise<void> {
  const capa = capaAbierta();
  if (capa) {
    capa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(listo => setTimeout(listo, 50));
    if (capaAbierta() !== capa) return;
  }
  if (router.url === '/') { void App.minimizeApp(); return; }
  // Angular numera sus navegaciones en `history.state`: la primera es la 1.
  // Más allá hay una pantalla anterior de esta aplicación a la que volver.
  if ((history.state?.navigationId ?? 1) > 1) history.back();
  else void router.navigateByUrl('/');
}

/** Lo que llega de otras apps («Abrir con», «Compartir»), ya copiado por LlegadasPlugin. */
async function recogerLlegadas(entregar: (archivos: File[]) => Promise<void>): Promise<void> {
  const { archivos } = await Llegadas.tomar();
  if (!archivos.length) return;
  const legibles = archivos.filter(a => a.ruta);
  try {
    const leidos = await Promise.all(legibles.map(a => leerNativo(a.ruta!, a.nombre, a.tipo)));
    if (leidos.length) await entregar(leidos);
  } finally {
    await Llegadas.soltar({ rutas: legibles.map(a => a.ruta!) }).catch(() => undefined);
  }
  const grandes = archivos.filter(a => a.grande).map(a => a.nombre);
  const fallidos = archivos.filter(a => a.error).map(a => a.nombre);
  if (grandes.length) avisoError(`En Android puedes abrir archivos de hasta 50 MB. No se ha abierto: ${grandes.join(', ')}.`);
  if (fallidos.length) avisoError(`La otra aplicación no ha dejado leer: ${fallidos.join(', ')}.`);
}

export interface Arranque {
  router: Router;
  zona: NgZone;
  /** Lleva a la portada o a su herramienta lo que llega de fuera (`EscritorioService.entregar`). */
  entregar(archivos: File[]): Promise<void>;
  /** Las favoritas, para los atajos del icono, y cuándo cambian. */
  favoritas(): { slug: string; nombre: string }[];
  cambianFavoritas: Observable<void>;
}

export async function iniciarAndroid({ router, zona, entregar, favoritas, cambianFavoritas }: Arranque): Promise<void> {
  document.documentElement.classList.add('android-local');
  if (Capacitor.getPlatform() !== 'android') return;
  // En la app, pellizcar no amplía la interfaz entera: medido en el visor, el
  // WebView llegaba a ×5 con la barra de herramientas fuera de la pantalla y
  // sin forma de volver. Las páginas las amplía el visor por su cuenta
  // (`gesto-zoom.ts`) y la letra sigue el tamaño de fuente del sistema. En la
  // web no se toca: ahí el zoom del navegador es de quien lee.
  document.querySelector('meta[name=viewport]')?.setAttribute('content',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  // Lo que llega del lado nativo no pasa por zone.js: sin volver a la zona,
  // la página no se repintaría.
  const enZona = <T>(f: () => Promise<T>) => zona.run(f);
  // Una exportación interrumpida por el sistema no debe acumular documentos en caché.
  // Se mira antes si existe: el puente registra como error cualquier fallo de
  // plugin, aunque aquí se capture, y en un arranque normal no hay carpeta.
  const cache = await Filesystem.readdir({ path: '', directory: Directory.Cache }).catch(() => ({ files: [] }));
  if (cache.files.some(f => f.name === 'exportaciones')) {
    await Filesystem.rmdir({ path: 'exportaciones', directory: Directory.Cache, recursive: true }).catch(() => undefined);
  }
  await App.addListener('backButton', () => void enZona(() => atras(router)));
  // Si se ha abierto desde «Compartir», el aviso ya está esperando: lo entrega
  // en cuanto hay alguien escuchando (`retainUntilConsumed`).
  await Llegadas.addListener('llegada', () => void enZona(() => recogerLlegadas(entregar))
    .catch(error => avisoError(error instanceof Error ? error.message : String(error))));
  const irA = (url: string) => {
    const ruta = rutaDeAtajo(url);
    if (ruta) void enZona(() => router.navigateByUrl(ruta));
  };
  await App.addListener('appUrlOpen', ({ url }) => irA(url));
  // `getLaunchUrl` devuelve la URL con que se abrió la actividad cada vez que
  // se le pregunta, y la página se recarga si el sistema mata el WebView: sin
  // recordarla, cada recarga volvía a saltar a la herramienta del atajo.
  // `sessionStorage` vive lo que el proceso, igual que esa URL.
  const lanzada = await App.getLaunchUrl().catch(() => undefined);
  if (lanzada?.url && sessionStorage.getItem('caja-arranque') !== lanzada.url) {
    sessionStorage.setItem('caja-arranque', lanzada.url);
    irA(lanzada.url);
  }
  const fijarAtajos = () => void Atajos.fijar({ atajos: favoritas() }).catch(() => undefined);
  fijarAtajos();
  cambianFavoritas.subscribe(fijarAtajos);
}

const Certificados = registerPlugin<{
  crear(opciones: Record<string, unknown>): Promise<{ p12: string; crt: string }>;
}>('Certificados');

export async function crearCertificadoAndroid(opciones: Record<string, unknown>) {
  if (Capacitor.getPlatform() !== 'android') throw new Error('La creación de certificados requiere la aplicación instalada en Android.');
  const r = await Certificados.crear(opciones);
  const binario = atob(r.p12), bytes = Uint8Array.from(binario, c => c.charCodeAt(0));
  return [
    { name: 'certificado.p12', blob: new Blob([bytes], { type: 'application/x-pkcs12' }) },
    { name: 'certificado.crt', blob: new Blob([r.crt], { type: 'application/x-pem-file' }) },
  ];
}
