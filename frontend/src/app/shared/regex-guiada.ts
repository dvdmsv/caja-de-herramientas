/**
 * Armar una expresión regular por partes, sin saber escribirlas.
 *
 * Quien tiene que tachar un número de expediente sabe describirlo —«empieza por
 * EXP, un guion y cuatro cifras»— y no sabe escribir `EXP-\d{4}`. Esto hace esa
 * traducción y deja el resultado **editable a mano**: es un punto de partida,
 * no una jaula.
 *
 * **Lo que esto no hace es comprobar la expresión**, y es a propósito. Quien
 * busca de verdad es Python (`backend/api/patrones.py`), y sus reglas no son las
 * de JavaScript: una expresión que aquí pareciera correcta podría comportarse de
 * otra manera allí, y ese desacuerdo sería peor que no decir nada. El probador
 * bueno ya existe y es la inspección, que cuenta las coincidencias con el motor
 * de verdad antes de tachar nada.
 *
 * Por eso lo que se genera se queda en el subconjunto que las dos entienden
 * igual: `\d`, clases de caracteres, `{n}`, `{n,m}` y las miradas alrededor de
 * ancho fijo, que es lo único que admite el `re` de Python.
 */

export type ClasePieza = 'texto' | 'digitos' | 'letras' | 'alfanumerico' | 'separador';

export interface Pieza {
  clase: ClasePieza;
  /** Para `texto`: lo que hay que encontrar tal cual. Para `separador`: cuál. */
  valor?: string;
  /** Para las piezas que se repiten: cuántas veces, de `min` a `max`. */
  min?: number;
  max?: number;
}

/** Los separadores que se ofrecen, con lo que significan en la expresión. */
export const SEPARADORES: Record<string, string> = {
  espacio: ' ',
  guion: '-',
  barra: '/',
  punto: '.',
};

/** Cómo se nombra cada uno al leerlo, con su artículo. */
const NOMBRES_SEPARADOR: Record<string, string> = {
  espacio: 'un espacio',
  guion: 'un guion',
  barra: 'una barra',
  punto: 'un punto',
};

/**
 * Lo que hay que poner delante de un carácter para que valga por sí mismo.
 *
 * Sin esto, un expediente que lleve un punto —«EXP.2026»— generaría un `.`, que
 * en una expresión significa «cualquier cosa» y tacharía de más.
 */
export function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

function repeticion(min?: number, max?: number): string {
  const desde = Math.max(1, min ?? 1);
  if (max === undefined || max === desde) {
    return desde === 1 ? '' : `{${desde}}`;
  }
  return `{${desde},${Math.max(desde, max)}}`;
}

function deUnaPieza(pieza: Pieza): string {
  switch (pieza.clase) {
    case 'texto':
      return escapar(pieza.valor ?? '');
    case 'digitos':
      return `\\d${repeticion(pieza.min, pieza.max)}`;
    case 'letras':
      return `[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]${repeticion(pieza.min, pieza.max)}`;
    case 'alfanumerico':
      return `[0-9A-Za-z]${repeticion(pieza.min, pieza.max)}`;
    case 'separador': {
      const suelto = SEPARADORES[pieza.valor ?? 'guion'] ?? '-';
      return escapar(suelto);
    }
  }
}

/**
 * La expresión completa.
 *
 * `palabraEntera` la encierra entre miradas de ancho fijo, no entre `\b`: es la
 * misma forma que usan los patrones que ya trae el proyecto y evita que
 * «AB-2026» se encuentre dentro de «XAB-20260».
 */
export function construir(piezas: Pieza[], palabraEntera = true): string {
  const cuerpo = piezas.map(deUnaPieza).join('');
  if (!cuerpo) {
    return '';
  }
  return palabraEntera ? `(?<![0-9A-Za-z])${cuerpo}(?![0-9A-Za-z])` : cuerpo;
}

/** Cómo se lee una pieza en la lista, para poder repasarla sin leer la expresión. */
export function describir(pieza: Pieza): string {
  const cuantas = (singular: string, plural: string) => {
    const desde = Math.max(1, pieza.min ?? 1);
    const hasta = pieza.max;
    if (hasta === undefined || hasta === desde) {
      return desde === 1 ? `1 ${singular}` : `${desde} ${plural}`;
    }
    return `de ${desde} a ${hasta} ${plural}`;
  };

  switch (pieza.clase) {
    case 'texto':
      return `el texto «${pieza.valor}»`;
    case 'digitos':
      return cuantas('cifra', 'cifras');
    case 'letras':
      return cuantas('letra', 'letras');
    case 'alfanumerico':
      return cuantas('letra o cifra', 'letras o cifras');
    case 'separador':
      return NOMBRES_SEPARADOR[pieza.valor ?? 'guion'] ?? 'un separador';
  }
}
