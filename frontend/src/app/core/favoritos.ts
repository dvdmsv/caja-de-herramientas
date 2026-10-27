export const CLAVE_FAVORITOS = 'favoritos';

/** La lista tras pulsar la estrella: se añade al final o se quita. */
export function alternarFavorito(lista: string[], slug: string): string[] {
  return lista.includes(slug) ? lista.filter(s => s !== slug) : [...lista, slug];
}

/** Lo guardado, tolerando que falte o esté corrupto, y sin repetidos. */
export function leerFavoritos(guardado: string | null): string[] {
  try {
    const valor = JSON.parse(guardado ?? '[]');
    if (!Array.isArray(valor)) {
      return [];
    }
    return [...new Set(valor.filter((s): s is string => typeof s === 'string'))];
  } catch {
    return [];
  }
}
