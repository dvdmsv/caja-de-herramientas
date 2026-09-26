/**
 * El menú del Explorador de la aplicación de Windows: qué acciones se pueden
 * ofrecer y sobre qué extensiones sale cada una.
 *
 * Todo sale del catálogo (`core/tools.ts`) y de `encaja()`, así que una acción
 * aparece exactamente sobre los archivos que su herramienta acepta, sin una
 * segunda lista que mantener. Quien escribe en el registro de Windows es Rust
 * (`aplicar_menu_contextual` en main.rs): esto sólo decide qué pedirle.
 */
import { encaja } from '../shared/tipos-archivo';
import { HERRAMIENTAS, Herramienta } from './tools';

/** Lo que se le manda a Rust por cada acción marcada. */
export interface AccionMenu {
  slug: string;
  nombre: string;
  /** Sin punto y en minúsculas: `pdf`, `jpg`… */
  extensiones: string[];
}

/** Lo que guarda Rust y enseña la página de Ajustes. */
export interface AjustesMenu {
  activo: boolean;
  acciones: string[];
}

/**
 * Las extensiones que se prueban contra el `acepta` de cada herramienta. Son
 * las que el Explorador puede asociar; con `encaja()` se queda cada herramienta
 * con las suyas, igual que la cola de subida.
 */
export const EXTENSIONES = [
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif', 'ico',
  'docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp',
  'md', 'epub', 'eml', 'msg', 'json', 'xml', 'html', 'htm',
];

/**
 * Las que vienen marcadas la primera vez que se activa el menú: las de uso más
 * común, para que no salga un submenú de treinta entradas sin haberlo pedido.
 */
export const DE_SERIE = ['comprimir-pdf', 'unir-pdf', 'visor', 'ocr-pdf', 'documento-a-pdf', 'imagen-a-pdf', 'comprimir-imagen'];

export function extensionesDe(herramienta: Herramienta): string[] {
  if (!herramienta.acepta.trim()) {
    return [];
  }
  // Sin tipo MIME, como llega un archivo del Explorador: `encaja` reconoce las
  // imágenes también por la extensión.
  return EXTENSIONES.filter(ext => encaja({ name: `archivo.${ext}`, type: '' }, herramienta.acepta));
}

/** Las herramientas que tiene sentido ofrecer: las disponibles que reciben archivos. */
export function candidatas(herramientas: Herramienta[] = HERRAMIENTAS): Herramienta[] {
  return herramientas.filter(h => h.disponible && extensionesDe(h).length > 0);
}

/** Lo que hay que mandar a Rust para las acciones marcadas, en el orden del catálogo. */
export function accionesMarcadas(marcadas: string[], herramientas: Herramienta[] = HERRAMIENTAS): AccionMenu[] {
  const elegidas = new Set(marcadas);
  return candidatas(herramientas)
    .filter(h => elegidas.has(h.slug))
    .map(h => ({ slug: h.slug, nombre: h.nombre, extensiones: extensionesDe(h) }));
}
