// El teléfono por adb. Cuál: CAJA_TELEFONO=ip:puerto (depuración inalámbrica) o
// el número de serie de uno por USB. Siempre con -s: puede haber más dispositivos.
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

export const PAQUETE = 'io.github.dvdmsv.cajadeherramientas';
const ADB = process.env.ADB ?? path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const TELEFONO = process.env.CAJA_TELEFONO;
if (!TELEFONO) throw new Error('Falta CAJA_TELEFONO=ip:puerto (o el número de serie por USB).');

export function adb(...args) {
  return execFileSync(ADB, ['-s', TELEFONO, ...args], { maxBuffer: 64 * 1024 * 1024 });
}
// Con `|| true`: `pidof` y `grep` salen con 1 cuando no encuentran, y eso no es un fallo.
export const shell = orden => adb('shell', `${orden} || true`).toString().trim();
export const esperar = ms => new Promise(r => setTimeout(r, ms));

/** Abre la app y lleva su WebView (depurable en las compilaciones debug) al puerto local. */
export async function enlazar(puerto = 9333) {
  shell(`am start -n ${PAQUETE}/.MainActivity`);
  for (let i = 0; i < 30; i++) {
    const pid = shell(`pidof ${PAQUETE}`);
    if (pid && shell('cat /proc/net/unix').includes(`webview_devtools_remote_${pid}`)) {
      try { execFileSync(ADB, ['-s', TELEFONO, 'forward', '--remove', `tcp:${puerto}`], { stdio: 'ignore' }); } catch { /* no estaba */ }
      adb('forward', `tcp:${puerto}`, `localabstract:webview_devtools_remote_${pid}`);
      return pid;
    }
    await esperar(1000);
  }
  throw new Error('La app no ha abierto su WebView. ¿Es una compilación debug?');
}

/** Lo que de verdad se ve: la captura por CDP no recoge los lienzos. */
export function pantalla(destino) {
  return import('fs').then(fs => fs.writeFileSync(destino, adb('exec-out', 'screencap', '-p')));
}

/** Los elementos de la pantalla nativa (selector de archivos, hoja de compartir) con su centro. */
export function elementosNativos() {
  shell('uiautomator dump /sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml').toString();
  shell('rm /sdcard/ui.xml');
  return [...xml.matchAll(/(?:text|content-desc)="([^"]+)"[^]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
    .map(([, texto, x1, y1, x2, y2]) => ({ texto, x: (+x1 + +x2) >> 1, y: (+y1 + +y2) >> 1 }));
}

/** Pulsa (o mantiene pulsado) el primer elemento nativo con ese texto. */
export function pulsar(texto, largo = false) {
  const e = elementosNativos().find(e => e.texto === texto);
  if (!e) return false;
  shell(largo ? `input swipe ${e.x} ${e.y} ${e.x} ${e.y} 900` : `input tap ${e.x} ${e.y}`);
  return true;
}

/** Textos visibles de la pantalla nativa, para saber qué hay delante. */
export const textosNativos = () => elementosNativos().map(e => e.texto);

export const actividadDelante = () => /topResumedActivity=\S+ \S+ (\S+)/.exec(shell('dumpsys activity activities | grep topResumedActivity'))?.[1];
