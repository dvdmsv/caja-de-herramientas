import { VistaPrevia } from '../../../core/api.service';
import { PesoPipe } from '../../../shared/peso.pipe';

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

/**
 * Cuánto adelgaza: «de 2,3 MB a 14 KB (0,6 %)». Explica por qué pasárselo así
 * a una IA sale tan barato, y delata un PDF que es casi todo imágenes.
 *
 * Un `.txt` o un `.csv` pueden **crecer** (se les añaden títulos y tablas): eso
 * se dice así, y no como un «120 %» que parece un error; si pesa lo mismo,
 * «igual» y no «100 %». Sin original, nada.
 */
export function adelgazamiento(original: number, markdown: number): string | null {
  if (original <= 0) {
    return null;
  }
  const peso = new PesoPipe();
  const de = `de ${peso.transform(original)} a ${peso.transform(markdown)}`;
  if (markdown === original) {
    return `${de} (igual)`;
  }
  const proporcion = (markdown / original) * 100;
  if (proporcion > 100) {
    return `${de} (crece un ${porcentaje(proporcion - 100)})`;
  }
  return proporcion < 0.1 ? `${de} (menos del 0,1 %)` : `${de} (${porcentaje(proporcion)})`;
}

/** Con un decimal por debajo del 10 %, sin decimales por encima. */
function porcentaje(valor: number): string {
  const decimales = valor < 10 ? 1 : 0;
  return `${valor.toLocaleString('es-ES', { maximumFractionDigits: decimales })} %`;
}
