/**
 * Qué se puede enseñar en pantalla y cómo, a partir del nombre del archivo.
 *
 * El servidor no dice el tipo de un resultado —`ArchivoServidor` sólo trae
 * `id`, `name`, `size` y `generated`—, así que la extensión es todo lo que hay.
 */

export type TipoVistaPrevia = 'pdf' | 'imagen' | 'texto';

/**
 * Imágenes que un navegador pinta en un `<img>`.
 *
 * `.tiff` se queda fuera a propósito aunque "Convertir imagen" lo genere:
 * ninguno lo muestra, y ofrecer verlo sólo enseñaría un hueco roto. El `.svg`
 * de "Generar QR" sí entra: en un `<img>` se pinta y no ejecuta nada.
 */
const IMAGENES = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg'];

/** Texto plano. El HTML se enseña como texto, nunca renderizado. */
const TEXTOS = ['.md', '.txt', '.csv', '.json', '.xml', '.html', '.htm'];

/** Cómo se puede enseñar este archivo, o `null` si no se puede. */
export function tipoDeVistaPrevia(nombre: string): TipoVistaPrevia | null {
  const extension = extensionDe(nombre);
  if (extension === '.pdf') {
    return 'pdf';
  }
  if (IMAGENES.includes(extension)) {
    return 'imagen';
  }
  if (TEXTOS.includes(extension)) {
    return 'texto';
  }
  return null;
}

/** Extensión en minúsculas y con punto; cadena vacía si no tiene. */
export function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? nombre.slice(punto).toLowerCase() : '';
}

// --- qué admite una herramienta -----------------------------------------

/** Lo mínimo de un archivo que hace falta para decidir si encaja. */
export interface ArchivoConTipo {
  name: string;
  /** Tipo MIME. Puede venir vacío: el navegador no siempre lo sabe. */
  type: string;
}

/**
 * Si el archivo encaja con un `accept` (extensiones y/o tipos MIME, separados
 * por comas). Un `accept` vacío lo admite todo.
 *
 * Los `image/*` se reconocen también por extensión: un archivo que llega de
 * otra herramienta, o de un sistema que no rellena el tipo, trae `type` vacío.
 */
export function encaja(archivo: ArchivoConTipo, accept: string): boolean {
  if (!accept.trim()) {
    return true;
  }
  const nombre = archivo.name.toLowerCase();
  return accept.split(',').map(p => p.trim().toLowerCase()).filter(Boolean).some(patron => {
    if (patron.startsWith('.')) {
      return nombre.endsWith(patron);
    }
    if (patron === 'image/*') {
      return archivo.type.startsWith('image/') || EXTENSIONES_IMAGEN.includes(extensionDe(nombre));
    }
    if (patron.endsWith('/*')) {
      return archivo.type.startsWith(patron.slice(0, -1));
    }
    return archivo.type === patron;
  });
}

/** Las que Pillow abre en el servidor; más amplia que las que pinta un `<img>`. */
const EXTENSIONES_IMAGEN = [...IMAGENES, '.tif', '.tiff', '.heic', '.heif', '.ico'];

/**
 * Los formatos de un `accept` dichos como los diría una persona:
 * ".pdf" → "PDF", "image/*" → "imágenes", ".pdf,image/*" → "PDF o imágenes".
 */
export function describirFormatos(accept: string): string {
  const partes = accept.split(',').map(p => p.trim()).filter(Boolean).map(patron => {
    if (patron === 'image/*') {
      return 'imágenes';
    }
    return patron.replace(/^\./, '').toUpperCase();
  });
  if (partes.length <= 1) {
    return partes[0] ?? 'cualquier archivo';
  }
  return `${partes.slice(0, -1).join(', ')} o ${partes[partes.length - 1]}`;
}

/** "un PDF", "una imagen", "un PDF o una imagen"… para "Elige … para empezar". */
export function queElegir(accept: string): string {
  const partes = accept.split(',').map(p => p.trim()).filter(Boolean);
  if (partes.length === 0 || partes.length > 3) {
    return 'un archivo';
  }
  const nombres = partes.map(p => (p === 'image/*' ? 'una imagen' : `un ${p.replace(/^\./, '').toUpperCase()}`));
  return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1]}`;
}

/** Lo que se ha dejado fuera al soltar o elegir archivos, y por qué. */
export interface Descartes {
  /** No son del tipo que admite la herramienta. */
  noAdmitidos: string[];
  /** Ya estaban en la lista. */
  repetidos: string[];
  /** La herramienta trabaja con uno solo y se han soltado varios: el que se queda. */
  conservado?: string;
}

/**
 * El aviso para quien suelta algo que no entra, o `null` si no hay nada que
 * decir. Sin él, un archivo rechazado desaparecía sin más y parecía que la
 * página no funcionaba.
 */
export function explicarRechazo(descartes: Descartes, accept: string): string | null {
  const frases: string[] = [];
  const { noAdmitidos, repetidos, conservado } = descartes;

  if (noAdmitidos.length === 1) {
    frases.push(`«${noAdmitidos[0]}» no vale aquí: esta herramienta admite ${describirFormatos(accept)}.`);
  } else if (noAdmitidos.length > 1) {
    frases.push(`${noAdmitidos.length} archivos no valen aquí: esta herramienta admite ${describirFormatos(accept)}.`);
  }

  if (repetidos.length === 1) {
    frases.push(`«${repetidos[0]}» ya estaba en la lista.`);
  } else if (repetidos.length > 1) {
    frases.push(`${repetidos.length} archivos ya estaban en la lista.`);
  }

  if (conservado) {
    frases.push(`Esta herramienta trabaja con un archivo cada vez: se ha quedado «${conservado}».`);
  }

  return frases.length > 0 ? frases.join(' ') : null;
}
