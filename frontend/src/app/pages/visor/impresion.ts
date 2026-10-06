import { DocumentoPdf } from '../../core/pdf.service';

/**
 * Imprimir el documento desde el visor.
 *
 * Se dibuja cada página en el navegador y se imprimen como imágenes desde un
 * `iframe` oculto. No se manda el PDF al visor de PDF del navegador: en la
 * aplicación de Windows no lo hay, y en un móvil Android tampoco. 150 ppp es lo
 * que piden las impresoras de oficina para que el texto salga limpio sin que
 * cien páginas se coman la memoria.
 *
 * Lo que tenga cambios sin guardar lo prepara antes el servidor (el visor le
 * pide el PDF ya editado), así que lo impreso es exactamente lo que se
 * guardaría: tachados de verdad, textos, campos y páginas giradas o quitadas.
 */

const PPP = 150;

/** Dibuja todas las páginas y devuelve sus imágenes, como direcciones `blob:`. */
export async function paginasParaImprimir(documento: DocumentoPdf,
                                          alProgresar: (hechas: number) => void,
                                          senal: AbortSignal): Promise<string[]> {
  const urls: string[] = [];
  try {
    for (let numero = 1; numero <= documento.paginas; numero++) {
      if (senal.aborted) {
        throw new DOMException('Impresión cancelada', 'AbortError');
      }
      const lienzo = await documento.lienzoDeImpresion(numero, PPP);
      const imagen = await new Promise<Blob>((resolver, rechazar) =>
        lienzo.toBlob(blob => (blob ? resolver(blob) : rechazar(new Error('Sin imagen'))), 'image/png'));
      lienzo.width = 0;
      lienzo.height = 0;
      urls.push(URL.createObjectURL(imagen));
      alProgresar(numero);
    }
    return urls;
  } catch (err) {
    urls.forEach(url => URL.revokeObjectURL(url));
    throw err;
  }
}

/**
 * Abre el diálogo de imprimir con esas imágenes, una por hoja y encajada en
 * ella, y lo limpia todo al cerrarse. Resuelve cuando el diálogo se ha abierto.
 */
export async function imprimirImagenes(urls: string[], titulo: string): Promise<void> {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  Object.assign(marco.style, { position: 'fixed', right: '0', bottom: '0', width: '0',
                               height: '0', border: '0', visibility: 'hidden' });
  document.body.append(marco);

  const limpiar = () => {
    urls.forEach(url => URL.revokeObjectURL(url));
    marco.remove();
  };
  const ventana = marco.contentWindow!;
  const doc = marco.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: 100%; height: 100vh; object-fit: contain;
          break-after: page; page-break-after: always; }
    img:last-child { break-after: auto; page-break-after: auto; }
  </style></head><body></body></html>`);
  doc.close();
  // El título del documento es el nombre que propone «Guardar como PDF».
  doc.title = titulo;
  const imagenes = urls.map(url => {
    const imagen = doc.createElement('img');
    imagen.src = url;
    doc.body.append(imagen);
    return imagen;
  });
  await Promise.all(imagenes.map(imagen => imagen.decode().catch(() => undefined)));

  ventana.addEventListener('afterprint', () => setTimeout(limpiar, 0), { once: true });
  // Por si el navegador no avisa al cerrar el diálogo: que no se queden
  // colgadas cien imágenes en memoria toda la sesión.
  setTimeout(() => marco.isConnected && limpiar(), 10 * 60 * 1000);
  ventana.focus();
  ventana.print();
}
