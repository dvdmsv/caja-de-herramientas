/** Cuántas herramientas recuerda el inicio en "Usadas hace poco". */
export const MAXIMO_RECIENTES = 4;

export const CLAVE_RECIENTES = 'recientes';

/** La lista tras usar una herramienta: la última, delante y sin repetir. */
export function anotarReciente(lista: string[], slug: string): string[] {
  return [slug, ...lista.filter(s => s !== slug)].slice(0, MAXIMO_RECIENTES);
}

/** Lo guardado, tolerando que falte o esté corrupto. */
export function leerRecientes(guardado: string | null): string[] {
  try {
    const valor = JSON.parse(guardado ?? '[]');
    return Array.isArray(valor) ? valor.filter((s): s is string => typeof s === 'string').slice(0, MAXIMO_RECIENTES) : [];
  } catch {
    return [];
  }
}
