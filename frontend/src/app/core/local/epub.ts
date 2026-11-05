import type * as MuPDF from 'mupdf';
import { unzipSync, strFromU8 } from 'fflate';
import type { PeticionMotor, ResultadoMotor } from './tipos';
import { base, escribirIndice, guardarPdf } from './pdf';
import { CUOTA_LOCAL } from './catalogo';

export function comprobarEpub(bytes: Uint8Array): void {
  let total = 0, cantidad = 0;
  const extraidos = unzipSync(bytes, { filter: entrada => {
    total += entrada.originalSize;
    if (++cantidad > 10000 || !Number.isSafeInteger(total) || total > CUOTA_LOCAL) throw new Error('El EPUB descomprimido supera el límite permitido.');
    return entrada.name === 'META-INF/encryption.xml';
  } });
  const cifrado = extraidos['META-INF/encryption.xml'];
  if (!cifrado) return;
  const xml = strFromU8(cifrado);
  const algoritmos = [...xml.matchAll(/\bAlgorithm\s*=\s*(["'])(.*?)\1/gs)].map(m => m[2]);
  const permitidos = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];
  if (!algoritmos.length || algoritmos.some(a => !permitidos.includes(a) && !a.startsWith('http://www.w3.org/2000/09/xmldsig#'))) {
    throw new Error('El libro está protegido con DRM. No se puede convertir.');
  }
}

export async function convertirEpub(m: typeof MuPDF, p: PeticionMotor,
                                    avance: (hechos: number, total: number) => void): Promise<ResultadoMotor> {
  const entrada = p.archivos[0];
  if (!entrada || !/\.epub$/i.test(entrada.name)) throw new Error('Selecciona un libro EPUB.');
  const tamanos: Record<string, [number,number,number]> = { a5: [420,595,10.5], a4: [595,842,11.5], lector: [90/25.4*72,122/25.4*72,9.5] };
  const letras: Record<string,number> = { pequena: 0.85, normal: 1, grande: 1.2 };
  const medidas = tamanos[String(p.opciones['pagina'] ?? 'a5')], factor = letras[String(p.opciones['letra'] ?? 'normal')];
  if (!medidas || !factor) throw new Error('El tamaño de página o letra no es válido.');
  const bytes = new Uint8Array(await entrada.blob.arrayBuffer());
  comprobarEpub(bytes);
  const libro = m.Document.openDocument(bytes, 'application/epub+zip');
  const buffer = new m.Buffer();
  try {
    libro.layout(medidas[0], medidas[1], medidas[2]*factor);
    const total = libro.countPages();
    if (!total) throw new Error('El libro no tiene contenido.');
    const escritor = new m.DocumentWriter(buffer, 'pdf', 'compress');
    try {
      for (let n=0;n<total;n++) {
        const pagina = libro.loadPage(n);
        try {
          const dispositivo = escritor.beginPage(pagina.getBounds());
          try { pagina.run(dispositivo, m.Matrix.identity); }
          finally { dispositivo.destroy(); }
          escritor.endPage();
        } finally { pagina.destroy(); }
        if (buffer.length > CUOTA_LOCAL) throw new Error('El resultado supera el límite de almacenamiento.');
        avance(n+1,total);
      }
      escritor.close();
    } finally { escritor.destroy(); }
    const doc = new m.PDFDocument(buffer);
    try {
      escribirIndice(doc, libro.loadOutline() ?? []);
      for(const clave of ['Title','Author','Subject']) {
        const valor = libro.getMetaData('info:'+clave);
        if(valor) doc.setMetaData('info:'+clave,valor);
      }
      const blob = guardarPdf(doc);
      if(blob.size > CUOTA_LOCAL) throw new Error('El resultado supera el límite de almacenamiento.');
      return { archivos: [{ name: base(entrada.name)+'.pdf', blob }] };
    } finally { doc.destroy(); }
  } finally { libro.destroy(); buffer.destroy(); }
}
