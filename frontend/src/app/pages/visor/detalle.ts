/**
 * Cuánta resolución se le da a una página, y qué trozo se repasa encima cuando
 * no se le puede dar toda.
 *
 * Una página entera a zoom alto no cabe en un lienzo: un A4 al 400 % en una
 * pantalla de densidad 2 son 9500 × 6700 píxeles, 250 MB. Así que la página se
 * dibuja entera hasta un tope de píxeles —se ve algo blanda— y **encima, sólo
 * el trozo que está en pantalla, a la resolución de verdad** (lo mismo que hace
 * el `PDFPageDetailView` de pdf.js). Todo en píxeles CSS de la página ya
 * colocada, sin DOM, para poder probarlo a solas.
 */

/** Tope de píxeles reales de un lienzo: 4096 × 4096, 64 MB. */
export const MAXIMO_PIXELES = 4096 * 4096;

/**
 * Cuánto se dibuja de más alrededor de lo visible, en proporción a lo visible:
 * desplazarse un poco no deja ver el borde del trozo nítido antes de que se
 * repinte.
 */
export const MARGEN_DETALLE = 0.25;

export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/**
 * La escala a la que se dibuja la página entera.
 *
 * `ancho` y `alto` son los de la página **a escala 1**: si ya llevaran el zoom
 * se contaría dos veces (así estuvo, y un A4 se emborronaba a partir del 220 %).
 * La densidad sí cuenta, porque es lo que de verdad ocupa el lienzo.
 */
export function escalaDelLienzo(ancho: number, alto: number, escala: number,
                                densidad: number): number {
  const pixeles = ancho * alto * (escala * densidad) ** 2;
  return pixeles > MAXIMO_PIXELES ? escala * Math.sqrt(MAXIMO_PIXELES / pixeles) : escala;
}

/**
 * Qué trozo de la página repasar a resolución completa, o `null` si no hace
 * falta: cuando la página entera ya va a su escala, o cuando no se ve.
 *
 * `visible` es la parte de la página que cae en pantalla, en píxeles CSS con el
 * origen en su esquina; `pagina`, su tamaño en pantalla.
 */
export function trozoDeDetalle(visible: Rect | null, pagina: { ancho: number; alto: number },
                               escalaPagina: number, escala: number): Rect | null {
  if (!visible || escalaPagina >= escala || visible.ancho <= 0 || visible.alto <= 0) {
    return null;
  }
  const margenX = visible.ancho * MARGEN_DETALLE;
  const margenY = visible.alto * MARGEN_DETALLE;
  const x = Math.max(0, Math.floor(visible.x - margenX));
  const y = Math.max(0, Math.floor(visible.y - margenY));
  const derecha = Math.min(pagina.ancho, Math.ceil(visible.x + visible.ancho + margenX));
  const abajo = Math.min(pagina.alto, Math.ceil(visible.y + visible.alto + margenY));
  return { x, y, ancho: derecha - x, alto: abajo - y };
}

/** Si lo que se ve sigue dentro del trozo ya dibujado: entonces no se repinta. */
export function cubre(trozo: Rect | null, visible: Rect | null): boolean {
  return !!trozo && !!visible
    && visible.x >= trozo.x && visible.y >= trozo.y
    && visible.x + visible.ancho <= trozo.x + trozo.ancho
    && visible.y + visible.alto <= trozo.y + trozo.alto;
}

/** Una caja de pantalla, como la que da `getBoundingClientRect()`. */
export interface Caja {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** La parte de `pagina` que cae dentro de `ventana`, con el origen en la esquina de la página. */
export function parteVisible(pagina: Caja, ventana: Caja): Rect | null {
  const x0 = Math.max(pagina.left, ventana.left);
  const y0 = Math.max(pagina.top, ventana.top);
  const x1 = Math.min(pagina.right, ventana.right);
  const y1 = Math.min(pagina.bottom, ventana.bottom);
  return x1 > x0 && y1 > y0
    ? { x: x0 - pagina.left, y: y0 - pagina.top, ancho: x1 - x0, alto: y1 - y0 }
    : null;
}
