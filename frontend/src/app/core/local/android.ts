import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { App } from '@capacitor/app';
import type { Router } from '@angular/router';

const Documentos = registerPlugin<{ guardar(opciones: { ruta: string; nombre: string; tipo: string }): Promise<{ guardado: boolean }> }>('Documentos');
let guardando = false;

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
    await Filesystem.mkdir({ path: 'exportaciones', directory: Directory.Cache, recursive: true }).catch(() => undefined);
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

export async function iniciarAndroid(router: Router): Promise<void> {
  document.documentElement.classList.add('android-local');
  if (Capacitor.getPlatform() !== 'android') return;
  // Una exportación interrumpida por el sistema no debe acumular documentos en caché.
  await Filesystem.rmdir({ path: 'exportaciones', directory: Directory.Cache, recursive: true }).catch(() => undefined);
  await App.addListener('backButton', () => {
    if (router.url !== '/') void router.navigateByUrl('/');
    else void App.minimizeApp();
  });
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
