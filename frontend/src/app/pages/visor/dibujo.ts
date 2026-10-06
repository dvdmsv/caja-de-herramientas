import { Punto } from './cambios';

/**
 * La geometría de las anotaciones que se dibujan en el visor, sin DOM.
 *
 * La capa de dibujo (`capa-dibujo.component.ts`) pinta en el espacio de la
 * página **sin el giro del usuario**, en píxeles, y gira el conjunto con una
 * transformación (`transformacionDeGiro`). Así un sello o una firma se ven
 * derechos respecto a su página y giran con ella, que es lo que hará el PDF.
 */

/**
 * Lleva el espacio de la página sin girar (ancho × alto sin girar) al de lo
 * que se ve, para una página girada `giro` grados en sentido horario.
 * `ancho` y `alto` son los de lo que se ve.
 */
export function transformacionDeGiro(giro: number, ancho: number, alto: number): string {
  switch (((giro % 360) + 360) % 360) {
    case 90:
      return `translate(${ancho} 0) rotate(90)`;
    case 180:
      return `translate(${ancho} ${alto}) rotate(180)`;
    case 270:
      return `translate(0 ${alto}) rotate(270)`;
    default:
      return '';
  }
}

/** El tamaño de la página sin girar, a partir del de lo que se ve. */
export function tamanoSinGirar(giro: number, ancho: number, alto: number): [number, number] {
  return Math.abs(giro % 180) === 90 ? [alto, ancho] : [ancho, alto];
}

/**
 * Simplifica un trazo a mano (Ramer–Douglas–Peucker): quita los puntos que no
 * se apartan de la recta más de `tolerancia`. Un trazo de un segundo trae
 * sesenta puntos y con dos o tres píxeles de tolerancia queda en una docena
 * sin que se note: menos que guardar, mandar y dibujar.
 */
export function simplificar(puntos: Punto[], tolerancia: number): Punto[] {
  if (puntos.length < 3) {
    return puntos;
  }
  const [x0, y0] = puntos[0];
  const [x1, y1] = puntos[puntos.length - 1];
  const largo = Math.hypot(x1 - x0, y1 - y0);
  let lejano = 0;
  let distancia = -1;
  for (let i = 1; i < puntos.length - 1; i++) {
    const [x, y] = puntos[i];
    const d = largo === 0
      ? Math.hypot(x - x0, y - y0)
      : Math.abs((y1 - y0) * x - (x1 - x0) * y + x1 * y0 - y1 * x0) / largo;
    if (d > distancia) {
      distancia = d;
      lejano = i;
    }
  }
  if (distancia <= tolerancia) {
    return [puntos[0], puntos[puntos.length - 1]];
  }
  const izquierda = simplificar(puntos.slice(0, lejano + 1), tolerancia);
  const derecha = simplificar(puntos.slice(lejano), tolerancia);
  return [...izquierda.slice(0, -1), ...derecha];
}

/** Un trazo en píxeles como `d` de un `<path>`. */
export function camino(puntos: Punto[], ancho: number, alto: number): string {
  return puntos
    .map(([x, y], i) => `${i ? 'L' : 'M'}${(x * ancho).toFixed(1)} ${(y * alto).toFixed(1)}`)
    .join(' ');
}

/**
 * Las dos rayas de la punta de una flecha que va de (x0, y0) a (x1, y1), como
 * `d` de un `<path>`: abierta, como la `OpenArrow` que escribe PyMuPDF.
 */
export function puntaDeFlecha(x0: number, y0: number, x1: number, y1: number,
                              largo: number): string {
  const angulo = Math.atan2(y1 - y0, x1 - x0);
  const abertura = Math.PI / 6;
  const ala = (desvio: number) => {
    const a = angulo + Math.PI + desvio;
    return `${(x1 + largo * Math.cos(a)).toFixed(1)} ${(y1 + largo * Math.sin(a)).toFixed(1)}`;
  };
  return `M${ala(abertura)} L${x1.toFixed(1)} ${y1.toFixed(1)} L${ala(-abertura)}`;
}

/** Proporción del alto del sello que ocupa la letra, la misma que usa `visor_anotaciones.py`. */
export const LETRA_DEL_SELLO = 0.5;

/**
 * El tamaño de un sello nuevo, en proporciones de la página sin girar: un alto
 * fijo y el ancho que pide su texto. Las mayúsculas de Helvetica miden de media
 * unos dos tercios del cuerpo.
 */
export function tamanoDeSello(texto: string, ancho: number, alto: number): [number, number] {
  const altoPx = alto * 0.045;
  const anchoPx = Math.max(altoPx * 2, texto.length * altoPx * LETRA_DEL_SELLO * 0.72 + altoPx);
  return [Math.min(0.9, anchoPx / ancho), altoPx / alto];
}

/** La fecha de hoy como la escribe un sello: «6/10/2026». */
export function fechaDeSello(hoy = new Date()): string {
  return hoy.toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
