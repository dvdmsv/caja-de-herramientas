/**
 * Armar una expresión regular por piezas, sin saber escribirlas.
 *
 * Quien tiene que tachar un número de expediente sabe describirlo —«empieza por
 * EXP, un guion y cuatro cifras»— y no sabe escribir `EXP-\d{4}`. Esto hace esa
 * traducción y deja el resultado **editable a mano**: es un punto de partida,
 * no una jaula. La interfaz está en `shared/constructor-regex/`.
 *
 * **Lo que esto no hace es comprobar la expresión**, y es a propósito. Quien
 * busca de verdad es Python (`backend/api/patrones.py`), y sus reglas no son las
 * de JavaScript: una expresión que aquí pareciera correcta podría comportarse de
 * otra manera allí. Por eso la prueba del constructor la hace el servidor
 * (`/anonimizar-pdf/probar`), con el mismo motor que luego tacha.
 *
 * Y por eso mismo lo que se genera se queda en el subconjunto que las dos
 * entienden igual: clases de caracteres, `(?:…)`, `?`, `+`, `{n}`, `{n,m}` y las
 * miradas alrededor de ancho fijo, que es lo único que admite el `re` de Python.
 * Nada de miradas de ancho variable, modo no codicioso ni anclas: además de lo
 * anterior, en un documento no le dicen nada a quien usa esto.
 */

export type TipoPieza =
  | 'texto' | 'cifras' | 'letras' | 'mayusculas' | 'minusculas' | 'alfanumerico'
  | 'espacio' | 'cualquiera' | 'caracteres' | 'palabras';

export type ModoRepeticion = 'una' | 'opcional' | 'varias' | 'exacta' | 'entre';

export interface Repeticion {
  modo: ModoRepeticion;
  /** «exacta»: cuántas; «entre»: desde cuántas. */
  n?: number;
  /** «entre»: hasta cuántas. */
  m?: number;
}

export interface Pieza {
  tipo: TipoPieza;
  /**
   * `texto`: lo que hay que encontrar tal cual. `caracteres`: cuáles valen
   * («-/.»). `palabras`: las que valen, separadas por comas («S.L., S.A.»).
   */
  valor?: string;
  repeticion: Repeticion;
}

/** Los tipos que se ofrecen, en el orden del desplegable. */
export const TIPOS: { id: TipoPieza; nombre: string; ayuda: string }[] = [
  { id: 'texto', nombre: 'Un texto fijo', ayuda: 'Tal cual lo escribas: EXP, Ref., Nº' },
  { id: 'cifras', nombre: 'Cifras', ayuda: 'Del 0 al 9' },
  { id: 'letras', nombre: 'Letras', ayuda: 'Mayúsculas o minúsculas, con tildes y ñ' },
  { id: 'mayusculas', nombre: 'Letras mayúsculas', ayuda: 'A, B, C… con tildes y Ñ' },
  { id: 'minusculas', nombre: 'Letras minúsculas', ayuda: 'a, b, c… con tildes y ñ' },
  { id: 'alfanumerico', nombre: 'Letras o cifras', ayuda: 'Cualquiera de las dos' },
  { id: 'espacio', nombre: 'Un espacio', ayuda: 'El hueco entre dos palabras' },
  { id: 'caracteres', nombre: 'Uno de estos caracteres', ayuda: 'Por ejemplo - / . para un separador' },
  { id: 'palabras', nombre: 'Una de estas palabras', ayuda: 'Separadas por comas: S.L., S.A.' },
  { id: 'cualquiera', nombre: 'Cualquier carácter', ayuda: 'Lo que sea, salvo un salto de línea' },
];

export const MODOS: { id: ModoRepeticion; nombre: string }[] = [
  { id: 'una', nombre: 'Una vez' },
  { id: 'opcional', nombre: 'Puede estar o no' },
  { id: 'varias', nombre: 'Una o más veces' },
  { id: 'exacta', nombre: 'Exactamente…' },
  { id: 'entre', nombre: 'Entre… y…' },
];

/** Tope de los números de una repetición: más no sirve para un dato de un documento. */
export const MAXIMO_VECES = 99;

const LETRAS = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';

/**
 * Lo que hay que poner delante de un carácter para que valga por sí mismo.
 *
 * Sin esto, un expediente que lleve un punto —«EXP.2026»— generaría un `.`, que
 * en una expresión significa «cualquier cosa» y tacharía de más.
 */
export function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

/** Lo mismo dentro de `[…]`, donde sólo significan algo `]`, `\`, `^` y `-`. */
function escaparEnClase(texto: string): string {
  return texto.replace(/[\]\\^-]/g, '\\$&');
}

/** Las palabras de una pieza `palabras`, limpias y sin repetir. */
export function palabrasDe(valor = ''): string[] {
  return [...new Set(valor.split(',').map(palabra => palabra.trim()).filter(Boolean))];
}

/** Los caracteres de una pieza `caracteres`, sin repetir. */
function caracteresDe(valor = ''): string[] {
  return [...new Set(Array.from(valor))].filter(caracter => caracter.trim() !== '' || caracter === ' ');
}

/** `n` y `m` puestos en razón: enteros, de 1 al tope y `m` no por debajo de `n`. */
export function recortar(repeticion: Repeticion): Repeticion {
  const entero = (valor: number | undefined, defecto: number) =>
    Math.min(MAXIMO_VECES, Math.max(1, Math.round(Number.isFinite(valor) ? valor! : defecto)));
  const n = entero(repeticion.n, 1);
  return { modo: repeticion.modo, n, m: Math.max(n, entero(repeticion.m, n)) };
}

function cuantificador(repeticion: Repeticion): string {
  const { modo, n, m } = recortar(repeticion);
  switch (modo) {
    case 'una': return '';
    case 'opcional': return '?';
    case 'varias': return '+';
    case 'exacta': return n === 1 ? '' : `{${n}}`;
    case 'entre': return n === m ? (n === 1 ? '' : `{${n}}`) : `{${n},${m}}`;
  }
}

/** El átomo de una pieza, sin repetición; `null` si aún no tiene con qué. */
function atomo(pieza: Pieza): { expresion: string; simple: boolean } | null {
  switch (pieza.tipo) {
    case 'texto': {
      const texto = pieza.valor ?? '';
      // Un texto de un solo carácter se repite solo; uno más largo necesita un
      // grupo, o «EXP+» repetiría sólo la P.
      return texto ? { expresion: escapar(texto), simple: Array.from(texto).length === 1 } : null;
    }
    case 'cifras': return { expresion: '\\d', simple: true };
    case 'letras': return { expresion: `[${LETRAS}]`, simple: true };
    case 'mayusculas': return { expresion: '[A-ZÁÉÍÓÚÜÑ]', simple: true };
    case 'minusculas': return { expresion: '[a-záéíóúüñ]', simple: true };
    case 'alfanumerico': return { expresion: `[0-9${LETRAS}]`, simple: true };
    case 'espacio': return { expresion: ' ', simple: true };
    case 'cualquiera': return { expresion: '.', simple: true };
    case 'caracteres': {
      const caracteres = caracteresDe(pieza.valor);
      if (caracteres.length === 0) {
        return null;
      }
      return caracteres.length === 1
        ? { expresion: escapar(caracteres[0]), simple: true }
        : { expresion: `[${escaparEnClase(caracteres.join(''))}]`, simple: true };
    }
    case 'palabras': {
      // De más larga a más corta: con «SL|SLU», la primera se quedaría con el
      // principio de «SLU» y dejaría fuera la U.
      const palabras = palabrasDe(pieza.valor).sort((a, b) => b.length - a.length);
      if (palabras.length === 0) {
        return null;
      }
      return palabras.length === 1 && Array.from(palabras[0]).length === 1
        ? { expresion: escapar(palabras[0]), simple: true }
        : { expresion: `(?:${palabras.map(escapar).join('|')})`, simple: true };
    }
  }
}

/** El trozo de expresión de una pieza, con su repetición; vacío si está a medias. */
export function fragmento(pieza: Pieza): string {
  const base = atomo(pieza);
  if (!base) {
    return '';
  }
  const veces = cuantificador(pieza.repeticion);
  if (!veces) {
    return base.expresion;
  }
  return base.simple ? `${base.expresion}${veces}` : `(?:${base.expresion})${veces}`;
}

/** Los trozos de cada pieza, en orden: para pintar la expresión coloreada. */
export function fragmentos(piezas: Pieza[]): string[] {
  return piezas.map(fragmento);
}

/** Lo que rodea el cuerpo cuando se buscan palabras enteras. */
export const ANTES_DE_PALABRA = '(?<![0-9A-Za-z])';
export const DESPUES_DE_PALABRA = '(?![0-9A-Za-z])';

/**
 * La expresión completa.
 *
 * `palabraEntera` la encierra entre miradas de ancho fijo, no entre `\b`: es la
 * misma forma que usan los patrones que ya trae el proyecto y evita que
 * «AB-2026» se encuentre dentro de «XAB-20260».
 */
export function construir(piezas: Pieza[], palabraEntera = true): string {
  const cuerpo = fragmentos(piezas).join('');
  if (!cuerpo) {
    return '';
  }
  return palabraEntera ? `${ANTES_DE_PALABRA}${cuerpo}${DESPUES_DE_PALABRA}` : cuerpo;
}

/** Cómo se lee una pieza, para repasarla sin leer la expresión. */
export function describir(pieza: Pieza): string {
  const { modo, n, m } = recortar(pieza.repeticion);
  const cuantas = (singular: string, plural: string): string => {
    switch (modo) {
      case 'una': return `1 ${singular}`;
      case 'opcional': return `1 ${singular}, si la hay`;
      case 'varias': return `1 o más ${plural}`;
      case 'exacta': return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
      case 'entre': return n === m ? (n === 1 ? `1 ${singular}` : `${n} ${plural}`) : `de ${n} a ${m} ${plural}`;
    }
  };
  const veces = (): string => {
    switch (modo) {
      case 'una': return '';
      case 'opcional': return ', si está';
      case 'varias': return ', una o más veces';
      case 'exacta': return n === 1 ? '' : `, ${n} veces`;
      case 'entre': return n === m ? (n === 1 ? '' : `, ${n} veces`) : `, de ${n} a ${m} veces`;
    }
  };

  switch (pieza.tipo) {
    case 'texto':
      return pieza.valor ? `el texto «${pieza.valor}»${veces()}` : 'un texto (aún sin escribir)';
    case 'cifras': return cuantas('cifra', 'cifras');
    case 'letras': return cuantas('letra', 'letras');
    case 'mayusculas': return cuantas('mayúscula', 'mayúsculas');
    case 'minusculas': return cuantas('minúscula', 'minúsculas');
    case 'alfanumerico': return cuantas('letra o cifra', 'letras o cifras');
    case 'espacio': return cuantas('espacio', 'espacios');
    case 'cualquiera': return cuantas('carácter cualquiera', 'caracteres cualesquiera');
    case 'caracteres': {
      const caracteres = caracteresDe(pieza.valor);
      if (caracteres.length === 0) {
        return 'uno de unos caracteres (aún sin escribir)';
      }
      const lista = caracteres.map(caracter => (caracter === ' ' ? 'espacio' : caracter)).join(' ');
      return caracteres.length === 1 ? `«${lista}»${veces()}` : `uno de ${lista}${veces()}`;
    }
    case 'palabras': {
      const palabras = palabrasDe(pieza.valor);
      if (palabras.length === 0) {
        return 'una de unas palabras (aún sin escribir)';
      }
      const lista = palabras.map(palabra => `«${palabra}»`).join(', ');
      return palabras.length === 1 ? `${lista}${veces()}` : `una de ${lista}${veces()}`;
    }
  }
}

/** La expresión entera en una frase: «Busca el texto «EXP», «-» y 4 cifras». */
export function enPalabras(piezas: Pieza[], palabraEntera = true): string {
  const partes = piezas.map(describir);
  if (partes.length === 0) {
    return '';
  }
  const lista = partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  return `Busca ${lista}${palabraEntera ? ', como palabra suelta' : ''}.`;
}

/** Una pieza nueva, en blanco. */
export function piezaNueva(tipo: TipoPieza = 'cifras'): Pieza {
  const conValor = tipo === 'texto' || tipo === 'caracteres' || tipo === 'palabras';
  return { tipo, valor: conValor ? '' : undefined, repeticion: { modo: 'una', n: 1, m: 1 } };
}

/** Puntos de partida: rellenan la lista, que luego se retoca. */
export const EJEMPLOS: { nombre: string; muestra: string; piezas: Pieza[] }[] = [
  {
    nombre: 'Número de expediente',
    muestra: 'EXP-2026-0001',
    piezas: [
      { tipo: 'texto', valor: 'EXP', repeticion: { modo: 'una' } },
      { tipo: 'caracteres', valor: '-', repeticion: { modo: 'una' } },
      { tipo: 'cifras', repeticion: { modo: 'exacta', n: 4 } },
      { tipo: 'caracteres', valor: '-', repeticion: { modo: 'una' } },
      { tipo: 'cifras', repeticion: { modo: 'exacta', n: 4 } },
    ],
  },
  {
    nombre: 'Fecha',
    muestra: '12/05/2026',
    piezas: [
      { tipo: 'cifras', repeticion: { modo: 'entre', n: 1, m: 2 } },
      { tipo: 'caracteres', valor: '/-.', repeticion: { modo: 'una' } },
      { tipo: 'cifras', repeticion: { modo: 'entre', n: 1, m: 2 } },
      { tipo: 'caracteres', valor: '/-.', repeticion: { modo: 'una' } },
      { tipo: 'cifras', repeticion: { modo: 'exacta', n: 4 } },
    ],
  },
  {
    nombre: 'Referencia',
    muestra: 'AB-1234',
    piezas: [
      { tipo: 'mayusculas', repeticion: { modo: 'exacta', n: 2 } },
      { tipo: 'caracteres', valor: '-', repeticion: { modo: 'una' } },
      { tipo: 'cifras', repeticion: { modo: 'exacta', n: 4 } },
    ],
  },
  {
    nombre: 'Número de socio',
    muestra: '004512',
    piezas: [{ tipo: 'cifras', repeticion: { modo: 'exacta', n: 6 } }],
  },
  {
    nombre: 'Nombre de empresa',
    muestra: 'Talleres Pérez S.L.',
    piezas: [
      { tipo: 'mayusculas', repeticion: { modo: 'una' } },
      { tipo: 'letras', repeticion: { modo: 'varias' } },
      { tipo: 'espacio', repeticion: { modo: 'una' } },
      { tipo: 'mayusculas', repeticion: { modo: 'una' } },
      { tipo: 'letras', repeticion: { modo: 'varias' } },
      { tipo: 'espacio', repeticion: { modo: 'una' } },
      { tipo: 'palabras', valor: 'S.L., S.A., S.L.U., S.Coop.', repeticion: { modo: 'una' } },
    ],
  },
];
