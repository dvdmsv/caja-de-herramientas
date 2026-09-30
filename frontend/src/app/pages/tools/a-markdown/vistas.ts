import { VistaPrevia } from '../../../core/api.service';

/**
 * «Copiar todos»: los documentos juntos, cada uno bajo su propio título, igual
 * que el archivo de «Unir todo en un solo archivo». Lo hace también el backend
 * (`_unidos`, `backend/api/tools/a_markdown.py`): si cambia uno, el otro.
 *
 * `null` si a alguno le falta el texto porque no cabía en la respuesta: copiar
 * sólo una parte sin que se note sería peor que no ofrecerlo.
 */
export function markdownUnido(vistas: VistaPrevia[]): string | null {
  if (vistas.some(vista => vista.texto === null)) {
    return null;
  }
  return vistas.map(vista => `# ${vista.nombre}\n\n${vista.texto}`).join('\n\n');
}
