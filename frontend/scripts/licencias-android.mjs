import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const piezas = ['tesseract.js', 'tesseract.js-core', 'xml-js', 'xlsx', 'docx', 'buffer', 'postal-mime', '@kenjiuno/msgreader', 'mupdf', '@capacitor/core', '@capacitor/android', '@capacitor/app',
  '@capacitor/filesystem', 'fflate', 'qrcode', 'zxing-wasm', 'markdown-it', 'highlight.js', 'parse5', 'pdfjs-dist'];
const avisos = ['Caja de herramientas para Android\nCódigo fuente: https://github.com/dvdmsv/caja-de-herramientas\nLicencia: AGPL-3.0-or-later\n'];
for (const nombre of piezas) {
  const raiz = join('node_modules', nombre);
  const paquete = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8'));
  const archivos = (await readdir(raiz, { withFileTypes: true }))
    .filter(a => a.isFile() && /^(license|licence|copying|notice)(\.|$)/i.test(a.name));
  if (!archivos.length) throw new Error(`No se encuentra la licencia de ${nombre}`);
  avisos.push(`\n${nombre} ${paquete.version}\n`);
  for (const archivo of archivos) avisos.push(await readFile(join(raiz, archivo.name), 'utf8'));
}
avisos.push('Bouncy Castle bcprov/bcpkix/bcutil 1.79 (componentes Android)');
avisos.push(await readFile('src/assets/legal/BOUNCY-CASTLE.txt', 'utf8'));
avisos.push(await readFile('src/assets/legal/GHOSTSCRIPT.txt', 'utf8'));
avisos.push(await readFile('src/assets/legal/QPDF.txt', 'utf8'));
avisos.push(await readFile('src/assets/legal/TESSDATA.txt', 'utf8'));
avisos.push(await readFile('src/assets/legal/METADATOS.txt', 'utf8'));
for (const name of (await readdir('src/assets/legal')).filter(n => /^(PDFBOX|LIBREOFFICE)/.test(n))) {
  avisos.push(await readFile(join('src/assets/legal', name), 'utf8'));
}
avisos.push(await readFile('dist/android/3rdpartylicenses.txt', 'utf8'));
const destino = 'dist/android/browser/assets/legal';
await mkdir(destino, { recursive: true });
await writeFile(join(destino, 'AVISOS.txt'), avisos.join('\n'));
