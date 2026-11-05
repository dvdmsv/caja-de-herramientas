import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { App } from '@capacitor/app';
import type { Router } from '@angular/router';

const Documentos = registerPlugin<{ guardar(opciones: { ruta: string; nombre: string; tipo: string }): Promise<{ guardado: boolean }> }>('Documentos');
let guardando = false;
/** Si la carpeta temporal de las exportaciones ya está creada en este arranque. */
let carpetaDeExportacion = false;

/** Transfiere por bloques para no construir un base64 del PDF entero en memoria. */
export async function guardarEnAndroid(blob: Blob, nombre: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    // Permite comprobar la compilación Android también en un navegador local.
    const url = URL.createObjectURL(blob), enlace = document.createElement('a');
    enlace.href = url; enlace.download = nombre; enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (guardando) throw new Error('Termina de guardar el archivo anterior.');
  guardando = true;
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
    await Documentos.guardar({ ruta: uri, nombre, tipo: blob.type || 'application/octet-stream' });
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
    guardando = false;
  }
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

export async function iniciarAndroid(router: Router): Promise<void> {
  document.documentElement.classList.add('android-local');
  if (Capacitor.getPlatform() !== 'android') return;
  // Una exportación interrumpida por el sistema no debe acumular documentos en caché.
  // Se mira antes si existe: el puente registra como error cualquier fallo de
  // plugin, aunque aquí se capture, y en un arranque normal no hay carpeta.
  const cache = await Filesystem.readdir({ path: '', directory: Directory.Cache }).catch(() => ({ files: [] }));
  if (cache.files.some(f => f.name === 'exportaciones')) {
    await Filesystem.rmdir({ path: 'exportaciones', directory: Directory.Cache, recursive: true }).catch(() => undefined);
  }
  await App.addListener('backButton', () => void atras(router));
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
