/**
 * Identificadores que el navegador genera y el servidor valida.
 *
 * El formato es uuid v4 sin guiones, que es exactamente lo que espera el
 * backend (`storage.ID_RE`) tanto para la sesión como para un trabajo. Está
 * aquí y no dentro de `SessionService` porque lo usan los dos.
 */
export function nuevoId(): string {
  // `randomUUID` sólo existe en contextos seguros (https o localhost).
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
