/**
 * El cifrado de la bóveda, con WebCrypto y sin nada más.
 *
 * - **PBKDF2-SHA256** saca la clave de la contraseña maestra, con 600 000
 *   iteraciones (lo que recomienda OWASP para PBKDF2-SHA256) y una sal propia
 *   de cada bóveda. Tarda medio segundo, y es lo que encarece probar
 *   contraseñas contra el archivo robado.
 * - **AES-GCM de 256 bits** cifra **todo el contenido en un solo bloque**, con
 *   un IV nuevo en cada guardado: así no se sabe ni cuántos certificados hay ni
 *   cómo se llaman. GCM autentica, y una contraseña equivocada no da basura:
 *   da un error, que es `ContrasenaIncorrecta`.
 * - La cabecera (formato y parámetros de la clave) va como **datos asociados**:
 *   no está cifrada, pero cambiarla hace fallar el descifrado.
 *
 * Recibe el `SubtleCrypto` para poder probarlo sin navegador. Sólo existe en
 * contexto seguro: la página de la aplicación lo es (127.0.0.1), y la web por
 * HTTP no, que es una de las razones de que la bóveda sea sólo de la aplicación.
 */

export const FORMATO = 1;
export const ITERACIONES = 600_000;

/** Bytes al azar: `crypto.getRandomValues` en la aplicación, otra cosa en los tests. */
export type Aleatorio = (bytes: number) => Uint8Array<ArrayBuffer>;

export const alAzar: Aleatorio = bytes => crypto.getRandomValues(new Uint8Array(bytes));

export interface ParametrosClave {
  nombre: 'PBKDF2-SHA256';
  iteraciones: number;
  /** En base64. */
  sal: string;
}

/** Lo que se guarda en `boveda.json`. */
export interface BovedaCifrada {
  formato: typeof FORMATO;
  clave: ParametrosClave;
  /** En base64. */
  iv: string;
  /** En base64: el contenido cifrado con su etiqueta de autenticación. */
  datos: string;
}

export class ContrasenaIncorrecta extends Error {
  constructor() {
    super('La contraseña no es correcta.');
  }
}

export class BovedaIlegible extends Error {
  constructor() {
    super('El archivo de la bóveda está dañado o es de una versión más nueva de la aplicación.');
  }
}

/** Unos parámetros nuevos, con su sal al azar: al crear o al cambiar la contraseña. */
export function parametrosNuevos(aleatorio: Aleatorio, iteraciones = ITERACIONES): ParametrosClave {
  return { nombre: 'PBKDF2-SHA256', iteraciones, sal: aBase64(aleatorio(16)) };
}

/** La clave, **no extraíble**: ni la propia página puede sacarla de aquí. */
export async function derivarClave(subtle: SubtleCrypto, contrasena: string, parametros: ParametrosClave): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', texto(contrasena), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(parametros.sal), iterations: parametros.iteraciones },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function cifrar(
  subtle: SubtleCrypto, clave: CryptoKey, parametros: ParametrosClave, contenido: unknown,
  aleatorio: Aleatorio,
): Promise<BovedaCifrada> {
  const iv = aleatorio(12);
  const datos = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: cabecera(parametros) }, clave, texto(JSON.stringify(contenido)));
  return { formato: FORMATO, clave: parametros, iv: aBase64(iv), datos: aBase64(new Uint8Array(datos)) };
}

export async function descifrar(subtle: SubtleCrypto, clave: CryptoKey, boveda: BovedaCifrada): Promise<unknown> {
  let claro: ArrayBuffer;
  try {
    claro = await subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(boveda.iv), additionalData: cabecera(boveda.clave) },
      clave, deBase64(boveda.datos));
  } catch {
    // GCM no distingue una contraseña equivocada de un archivo tocado: las dos
    // cosas fallan la autenticación, y las dos son «con esto no se abre».
    throw new ContrasenaIncorrecta();
  }
  return JSON.parse(new TextDecoder().decode(claro));
}

/** El archivo leído del disco, o `BovedaIlegible` si no tiene la forma esperada. */
export function leerBovedaCifrada(guardado: string): BovedaCifrada {
  let valor: Partial<BovedaCifrada>;
  try {
    valor = JSON.parse(guardado);
  } catch {
    throw new BovedaIlegible();
  }
  const clave = valor?.clave;
  const valida = valor?.formato === FORMATO
    && clave?.nombre === 'PBKDF2-SHA256'
    && Number.isInteger(clave.iteraciones) && clave.iteraciones > 0
    && typeof clave.sal === 'string' && typeof valor.iv === 'string' && typeof valor.datos === 'string';
  if (!valida) {
    throw new BovedaIlegible();
  }
  return valor as BovedaCifrada;
}

/** Lo que autentica GCM junto al contenido: el formato y cómo se sacó la clave. */
function cabecera(parametros: ParametrosClave): Uint8Array<ArrayBuffer> {
  return texto(`boveda:${FORMATO}:${parametros.nombre}:${parametros.iteraciones}:${parametros.sal}`);
}

function texto(cadena: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(cadena) as Uint8Array<ArrayBuffer>;
}

/** Por trozos: `String.fromCharCode(...bytes)` de una imagen entera desborda la pila. */
export function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

export function deBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}
