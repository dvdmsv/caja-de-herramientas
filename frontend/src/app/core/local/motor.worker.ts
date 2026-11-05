/// <reference lib="webworker" />
import { convertirEpub } from './epub';
import { firmarLocal } from './firma';
import { leerCodigos } from './codigos';
import type * as MuPDF from 'mupdf';
import { crearZip } from './zip';
import { ejecutarPdf } from './pdf';
import { ejecutarImagen, lienzo } from './imagenes';
import { generarQr } from './qr';
import type { PeticionMotor, ResultadoMotor } from './tipos';

addEventListener('message', async ({ data }: MessageEvent<PeticionMotor>) => {
  try {
    const avance = (hechos: number, total: number) => postMessage({ tipo: 'progreso', hechos, total });
    let resultado: ResultadoMotor;
    if (data.slug === 'anonimizar-pdf/probar') resultado = { archivos: [], datos: (await import('./patrones')).probarPatron(data.opciones) };
    else if (data.slug === 'visor-markdown/previsualizar') resultado = await (await import('./markdown')).visorMarkdown(data);
    else if (data.slug === 'generar-qr') resultado = await generarQr(data.opciones);
    else if (data.slug === 'zip') {
      resultado = await crearZip(data.archivos, String(data.opciones['name'] || 'resultados.zip'));
    } else {
      // Se sirve desde la APK, junto al .wasm; nunca se descarga de un CDN.
      const url = new URL('/assets/mupdf/mupdf.js', self.location.origin).href;
      const m: typeof MuPDF = await import(/* @vite-ignore */ url);
      if (data.recursos?.['imagen_id']) {
        const recurso = data.recursos['imagen_id'];
        recurso.blob = await (await lienzo(recurso.blob)).convertToBlob({ type: 'image/png' });
      }
      resultado = data.slug.startsWith('limpiar-metadatos') ? await (await import('./metadatos-pdf')).metadatosPdf(m, data, avance) : data.slug.startsWith('marca-de-tiempo') ? await (await import('./marca-tiempo')).fechaVisible(m, data, avance) : data.slug.startsWith('firmar-certificado/') ? await (await import('./apariencia-certificado')).aparienciaCertificado(m, data) : data.slug.startsWith('pdf-a-pdfa/') ? await (await import('./pdfa')).comprobarPdfa(m, data) : data.slug === 'ocr-pdf' ? await (await import('./ocr-pdf')).ocrPdf(m, data, avance) : data.slug === 'a-markdown' ? await (await import('./a-markdown')).aMarkdown(m, data, avance) : data.slug === 'pdf-a-word' ? await (await import('./pdf-a-word')).pdfWord(m, data, avance) : data.slug.startsWith('pdf-a-epub') ? await (await import('./pdf-a-epub')).pdfEpub(m, data, avance) : data.slug.startsWith('extraer-tablas') ? await (await import('./extraer-tablas')).extraerTablas(m, data, avance) : data.slug === 'correo-a-pdf' ? await (await import('./correo')).correoPdf(m, data, avance) : ['comprimir-pdf', 'comprimir-pdf/minimo', 'comprimir-pdf/paso'].includes(data.slug) ? await (await import('./comprimir-pdf')).comprimirPdf(m, data, avance) : ['anonimizar-pdf', 'anonimizar-pdf/inspeccionar'].includes(data.slug) ? await (await import('./anonimizar')).anonimizar(m, data, avance) : data.slug === 'comparar-pdf' ? await (await import('./comparar-pdf')).compararPdf(m, data, avance) : ['markdown-a-pdf', 'html-a-pdf'].includes(data.slug) ? await (await import('./documentos-texto')).convertirTexto(m, data, avance) : ['firmar', 'firmar/preparar'].includes(data.slug) ? await firmarLocal(m, data, avance) : data.slug === 'leer-codigo/inspeccionar' ? await leerCodigos(m, data, avance) : data.slug === 'epub-a-pdf' ? await convertirEpub(m, data, avance) : ['efecto-escaner', 'efecto-escaner/previsualizar', 'imagen-a-pdf', 'convertir-imagen', 'comprimir-imagen', 'editar-imagen'].includes(data.slug)
        ? await ejecutarImagen(m, data, avance) : await ejecutarPdf(m, data, avance);
    }
    postMessage({ tipo: 'resultado', resultado });
  } catch (error) {
    postMessage({ tipo: 'error', mensaje: error instanceof Error ? error.message : 'No se ha podido procesar el archivo.' });
  }
});
