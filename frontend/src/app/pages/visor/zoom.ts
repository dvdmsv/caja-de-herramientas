import { Disposicion } from './disposicion';

/**
 * Las cuentas del zoom con gesto (pellizco, Ctrl+rueda): que el punto que está
 * bajo los dedos o el cursor siga ahí después de ampliar.
 *
 * No basta con multiplicar el desplazamiento por el factor: entre página y
 * página hay una separación que no crece con el zoom, y las filas se centran
 * en el ancho disponible. Así que el punto se traduce a «tal proporción de tal
 * página» con la disposición de antes y se vuelve a buscar en la de después.
 */

export interface Punto {
  x: number;
  y: number;
}

/**
 * Dónde cae, en la disposición nueva, el punto `p` de la vieja. Ambos en
 * coordenadas del lienzo de lectura (lo desplazado más lo que hay en pantalla).
 */
export function anclar(antes: Disposicion, despues: Disposicion, p: Punto): Punto {
  const i = filaEn(antes, p.y);
  const fila = antes.filas[i];
  const nueva = despues.filas[i];
  if (!fila || !nueva) {
    // Fuera de las páginas (o el documento ha cambiado): en proporción del total.
    const fy = antes.altoTotal ? p.y / antes.altoTotal : 0;
    const fx = antes.anchoTotal ? p.x / antes.anchoTotal : 0;
    return { x: fx * despues.anchoTotal, y: fy * despues.altoTotal };
  }
  // Por debajo de la fila (en su separación) se queda pegado a su borde.
  const fy = Math.min(1, Math.max(0, (p.y - fila.top) / fila.alto));
  const y = nueva.top + fy * nueva.alto;

  // La página de la fila bajo el punto; a la derecha de todas, la última.
  let j = fila.paginas.findIndex(pagina => p.x < pagina.izquierda + pagina.ancho);
  if (j < 0) {
    j = fila.paginas.length - 1;
  }
  const pagina = fila.paginas[j];
  const nuevaPagina = nueva.paginas[j] ?? nueva.paginas[nueva.paginas.length - 1];
  const fx = (p.x - pagina.izquierda) / pagina.ancho;
  return { x: nuevaPagina.izquierda + fx * nuevaPagina.ancho, y };
}

/** La fila que contiene la altura `y`, o la última que empieza antes. */
function filaEn(disposicion: Disposicion, y: number): number {
  let bajo = 0;
  let alto = disposicion.filas.length - 1;
  let encontrada = -1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    if (disposicion.filas[medio].top <= y) {
      encontrada = medio;
      bajo = medio + 1;
    } else {
      alto = medio - 1;
    }
  }
  return encontrada;
}

/**
 * Cuánto amplía un giro de rueda con Ctrl. Exponencial, para que acercar y
 * alejar lo mismo deje el zoom donde estaba. Los ratones de rueda por pasos
 * mandan unos 100 por paso (un 18 %); un panel táctil, que en Chrome pellizca
 * como Ctrl+rueda, manda muchos y pequeños, y el gesto sale continuo.
 */
export function factorDeRueda(deltaY: number, modo: number): number {
  // deltaMode 1 son líneas: se pasan a píxeles como hace el navegador.
  const pixeles = modo === 1 ? deltaY * 16 : deltaY;
  return Math.exp(-pixeles * 0.0017);
}

/** El factor que deja la escala dentro de sus límites. */
export function factorPermitido(escala: number, factor: number, minima: number,
                                maxima: number): number {
  return Math.min(maxima, Math.max(minima, escala * factor)) / escala;
}
