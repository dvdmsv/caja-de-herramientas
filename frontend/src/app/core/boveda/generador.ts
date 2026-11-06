import { Aleatorio } from './cifrado';

/** Lo que se le pide al generador de contraseñas. */
export interface OpcionesGenerador {
  longitud: number;
  mayusculas: boolean;
  minusculas: boolean;
  numeros: boolean;
  simbolos: boolean;
}

export const LONGITUD_MINIMA = 8;
export const LONGITUD_MAXIMA = 64;

export const GENERADOR_DE_SERIE: OpcionesGenerador = {
  longitud: 20, mayusculas: true, minusculas: true, numeros: true, simbolos: true,
};

/**
 * Los símbolos, sin comillas ni contrabarras: son los que dan problemas al pegar
 * una contraseña en una terminal o en un archivo de configuración.
 */
const FAMILIAS = {
  mayusculas: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  minusculas: 'abcdefghijklmnopqrstuvwxyz',
  numeros: '0123456789',
  simbolos: '!#$%&()*+,-./:;<=>?@[]^_{|}~',
} as const;

/**
 * Un número de 0 a `tope - 1` sin sesgo. Con un `byte % tope` a secas, los primeros
 * valores salen más veces que los últimos; por eso se tiran los bytes de la parte
 * final, la que no llega a dar una vuelta entera.
 */
function alAzarHasta(tope: number, aleatorio: Aleatorio): number {
  const limite = 256 - (256 % tope);
  for (;;) {
    const byte = aleatorio(1)[0];
    if (byte < limite) {
      return byte % tope;
    }
  }
}

/** Una contraseña con al menos un carácter de cada familia elegida. Sin ninguna elegida, con todas. */
export function generarContrasena(opciones: OpcionesGenerador, aleatorio: Aleatorio): string {
  const nombres = (Object.keys(FAMILIAS) as (keyof typeof FAMILIAS)[]).filter(nombre => opciones[nombre]);
  const familias = (nombres.length ? nombres : Object.keys(FAMILIAS) as (keyof typeof FAMILIAS)[]).map(nombre => FAMILIAS[nombre]);
  const todos = familias.join('');
  const longitud = Math.min(LONGITUD_MAXIMA, Math.max(LONGITUD_MINIMA, Math.round(opciones.longitud)));

  const elegir = (cadena: string): string => cadena[alAzarHasta(cadena.length, aleatorio)];
  const letras = familias.map(elegir);
  while (letras.length < longitud) {
    letras.push(elegir(todos));
  }
  // Barajar, para que los obligatorios no vayan siempre delante.
  for (let i = letras.length - 1; i > 0; i--) {
    const j = alAzarHasta(i + 1, aleatorio);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  return letras.join('');
}
