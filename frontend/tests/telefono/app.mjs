// La app instalada, manejada por su WebView con Playwright (CDP), y los
// resultados sacados de IndexedDB para comprobarlos en el ordenador.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const esperar = ms => new Promise(r => setTimeout(r, ms));

const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright-core');

export const MUESTRAS = process.env.CAJA_MUESTRAS ?? new URL('./muestras/', import.meta.url).pathname;
export const SALIDAS = process.env.CAJA_SALIDAS ?? new URL('./salidas/', import.meta.url).pathname;
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', md: 'text/markdown', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', eml: 'message/rfc822',
  epub: 'application/epub+zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain',
  heic: 'image/heic', p12: 'application/x-pkcs12' };

export const archivo = nombre => ({ name: path.basename(nombre), buffer: fs.readFileSync(path.join(MUESTRAS, nombre)),
  mimeType: MIME[nombre.split('.').pop()] ?? 'application/octet-stream' });

export async function conectar(puerto = 9333) {
  const navegador = await chromium.connectOverCDP(`http://localhost:${puerto}`);
  const pagina = navegador.contexts()[0].pages()[0];
  const errores = [];
  pagina.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  pagina.on('pageerror', e => errores.push(e.message));
  return { navegador, pagina, errores };
}

export async function abrir(pagina, slug) {
  await pagina.goto('https://localhost/herramientas/' + slug);
  await pagina.waitForSelector('app-tool-page', { timeout: 15000 });
}

export async function subir(pagina, nombres, cola = 0) {
  if (nombres.length) await pagina.locator('app-file-queue input[type=file]').nth(cola).setInputFiles(nombres.map(archivo));
}

export const estado = pagina => pagina.evaluate(() => ({
  resultados: [...document.querySelectorAll('app-result-list li.resultado .resultado__nombre')].map(e => e.textContent.trim()),
  avisos: [...document.querySelectorAll('.swal2-container .swal2-title, .swal2-container .swal2-html-container, .alert-danger, .alert-warning')]
    .filter(e => e.offsetParent !== null).map(e => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean),
  habilitado: !document.querySelector('.accion-principal')?.disabled,
  procesando: !!document.querySelector('.accion-principal .spinner-border'),
  motivo: document.querySelector('#motivo-bloqueo')?.textContent.trim(),
}));

/** Pulsa la acción principal en cuanto se puede y espera a que acabe. */
export async function ejecutar(pagina, maximoSeg = 300) {
  for (let i = 0; i < 60 && !(await estado(pagina)).habilitado; i++) await esperar(500);
  const antes = await estado(pagina);
  if (!antes.habilitado) return { ...antes, error: 'botón deshabilitado' };
  const t0 = Date.now();
  await pagina.locator('.accion-principal').click();
  await esperar(800);
  while (Date.now() - t0 < maximoSeg * 1000) {
    const e = await estado(pagina);
    if (!e.procesando) return { ...e, segundos: +((Date.now() - t0) / 1000).toFixed(1) };
    await esperar(700);
  }
  return { ...(await estado(pagina)), error: 'plazo agotado' };
}

export const idsActuales = pagina => pagina.evaluate(async () => {
  const db = await new Promise(ok => { const r = indexedDB.open('caja-android', 1); r.onsuccess = () => ok(r.result); });
  return new Promise(ok => { const r = db.transaction('archivos').objectStore('archivos').getAllKeys(); r.onsuccess = () => ok(r.result); });
});

/** Copia a SALIDAS/<carpeta> los archivos generados que no estaban en `vistos`. */
export async function extraer(pagina, carpeta, vistos) {
  const datos = await pagina.evaluate(async vistos => {
    const db = await new Promise(ok => { const r = indexedDB.open('caja-android', 1); r.onsuccess = () => ok(r.result); });
    const todos = await new Promise(ok => { const r = db.transaction('archivos').objectStore('archivos').getAll(); r.onsuccess = () => ok(r.result); });
    return Promise.all(todos.filter(a => a.generated && !vistos.includes(a.id)).map(async a => {
      const b = new Uint8Array(await a.blob.arrayBuffer()); let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { id: a.id, name: a.name, b64: btoa(s) };
    }));
  }, vistos);
  const dir = path.join(SALIDAS, carpeta);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of datos) { fs.writeFileSync(path.join(dir, d.name), Buffer.from(d.b64, 'base64')); vistos.push(d.id); }
  return datos.map(d => d.name);
}
