/**
 * Un lote: la misma herramienta de un solo archivo, una vez por cada archivo de
 * la cola y con las mismas opciones (`PaginaHerramienta.unoPorUno`).
 *
 * Se hace desde el navegador, archivo a archivo, y no mandando todos los
 * identificadores de golpe: así cada uno sigue siendo un trabajo con sus propios
 * topes de memoria, CPU y plazo. Veinte OCR en una sola petición se pasarían del
 * plazo del worker; veinte peticiones de uno, no.
 *
 * Aquí está lo que no necesita el DOM: sumar lo ahorrado y decir cómo ha ido.
 */

import { ResumenTamano } from '../core/api.service';

/** Por dónde va el lote, para la barra. */
export interface EstadoLote {
  /** Empieza en 1. */
  actual: number;
  total: number;
}

export interface FalloDeLote {
  nombre: string;
  mensaje: string;
}

/** Cuántas veces se reintenta un archivo que el servidor manda esperar (429, 503). */
export const REINTENTOS_POR_ESPERA = 3;

/** Cuánto se espera antes de cada reintento. */
export const ESPERA_ENTRE_REINTENTOS_MS = 5000;

/** Lo ahorrado en todo el lote: la suma de antes y de después de cada archivo. */
export function sumarResumen(
  acumulado: ResumenTamano | null, nuevo: ResumenTamano | null | undefined,
): ResumenTamano | null {
  if (!nuevo) {
    return acumulado;
  }
  if (!acumulado) {
    return { ...nuevo };
  }
  return { antes: acumulado.antes + nuevo.antes, despues: acumulado.despues + nuevo.despues };
}

/** «Archivo 2 de 5», delante de la etapa. */
export function textoDelLote(lote: EstadoLote): string {
  return `Archivo ${lote.actual} de ${lote.total}`;
}

/**
 * Cómo se cuenta el final. `tipo` elige el aviso, con la misma regla que el resto
 * de la aplicación: si todo ha ido bien, uno que se va solo; si algo ha fallado,
 * uno que hay que leer, porque hay archivos que no están entre los resultados.
 */
export function finalDelLote(
  total: number, hechos: number, fallos: FalloDeLote[], cancelado: boolean,
): { tipo: 'exito' | 'info' | 'aviso' | 'error'; texto: string } {
  const detalle = fallos.map(fallo => `No se ha podido con ${fallo.nombre}: ${quitarPunto(fallo.mensaje)}.`).join(' ');
  if (cancelado) {
    const texto = `Lote cancelado: ${hechos} de ${total} ${hechos === 1 ? 'listo' : 'listos'}.`;
    return { tipo: 'info', texto: detalle ? `${texto} ${detalle}` : texto };
  }
  if (fallos.length === 0) {
    return { tipo: 'exito', texto: '' };
  }
  if (hechos === 0) {
    return { tipo: 'error', texto: detalle };
  }
  const listos = `${hechos} de ${total} ${hechos === 1 ? 'listo' : 'listos'}`;
  return { tipo: 'aviso', texto: `${listos}. ${detalle}` };
}

function quitarPunto(texto: string): string {
  return texto.trim().replace(/[.。]+$/, '');
}
