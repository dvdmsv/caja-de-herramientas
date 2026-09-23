/**
 * Qué es una pantalla de móvil, dicho en un solo sitio.
 *
 * Los CSS no pueden importar esto, así que repiten las consultas a mano: si
 * cambias una, busca su texto en los `.css` y cámbiala también allí.
 *
 * - `ESTRECHA` es el móvil en vertical: una sola columna, la acción principal
 *   fija abajo y las barras largas partidas en dos.
 * - `COMPACTA` suma el móvil **apaisado**, que tiene ancho de tableta pero
 *   unos 360 px de alto. Por el ancho parecería un escritorio, y un panel
 *   lateral abierto de serie le deja al documento dos tercios de nada.
 * - `TACTIL` no va de tamaño sino de dedo: textos que dicen «toca» en vez de
 *   «arrastra» y áreas de toque de 44 px. Una tableta grande es táctil sin ser
 *   compacta.
 */
export const ESTRECHA = '(max-width: 575.98px)';
export const COMPACTA = '(max-width: 767.98px), (max-height: 499.98px) and (pointer: coarse)';
export const TACTIL = '(pointer: coarse)';

/**
 * Si la ventana cumple la consulta ahora mismo. Sin `matchMedia` (jsdom en los
 * tests) responde que no: se pinta como en escritorio, que es lo de siempre.
 */
export function cumple(consulta: string): boolean {
  return window.matchMedia?.(consulta).matches ?? false;
}
