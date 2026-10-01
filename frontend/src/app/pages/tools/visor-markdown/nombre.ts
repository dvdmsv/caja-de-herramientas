/** Más largo, el nombre ya no se lee en la lista de descargas ni en el Explorador. */
const LARGO_MAXIMO = 60;

/**
 * Con qué nombre se descarga un texto pegado, sin extensión: su primer título,
 * que es como lo llamaría quien lo escribió, o «texto» si no lo tiene.
 *
 * Se le quitan las marcas de Markdown y lo que Windows no admite en un nombre
 * de archivo (`<>:"/\|?*`): el «Guardar como» de la aplicación lo rechazaría, y
 * el navegador lo cambia por guiones bajos a su manera.
 */
export function nombreDelTexto(texto: string): string {
  const titulo = /^ {0,3}#{1,6}[ \t]+(.+)$/m.exec(texto)?.[1] ?? '';
  const nombre = titulo
    .replace(/[ \t]#+[ \t]*$/, '')            // el cierre opcional: «# Título #»
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // de un enlace, sólo su texto
    .replace(/[*_`[\]]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, LARGO_MAXIMO)
    .replace(/[. ]+$/, '')
    .trim();
  return nombre || 'texto';
}
