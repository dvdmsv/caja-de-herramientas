import { ArchivoRechazado, ArchivoServidor } from '../core/api.service';

/**
 * A qué archivo de la cola le toca cada identificador del servidor.
 *
 * El servidor guarda los archivos uno a uno y puede admitir unos y rechazar
 * otros, así que devuelve los admitidos **en orden pero sin huecos**, y aparte
 * la lista de rechazados con la posición que ocupaba cada uno. Emparejarlos es
 * recorrer la cola saltándose esas posiciones.
 *
 * Es una función aparte, y no unas líneas dentro del componente, porque si el
 * emparejamiento se desalinea **no se ve ningún error**: se ve que has
 * comprimido otro documento. Eso tiene que estar probado.
 */
export interface RepartoSubida<T> {
  /** Cada archivo de la cola admitido, con el identificador que le corresponde. */
  admitidos: { item: T; id: string }[];
  /** Los que el servidor no ha querido, con su motivo. */
  descartados: { item: T; error: string }[];
}

export function repartirSubida<T>(
  enviados: T[],
  admitidos: ArchivoServidor[],
  rechazados: ArchivoRechazado[],
): RepartoSubida<T> {
  const posicionesRechazadas = new Set(rechazados.map(rechazado => rechazado.indice));
  const reparto: RepartoSubida<T> = { admitidos: [], descartados: [] };

  let siguiente = 0;
  enviados.forEach((item, posicion) => {
    if (posicionesRechazadas.has(posicion)) {
      return;
    }
    // Si el servidor devolviera menos de los que dijo admitir, este archivo se
    // queda sin identificador en vez de tomar prestado el del siguiente.
    const archivo = admitidos[siguiente++];
    if (archivo) {
      reparto.admitidos.push({ item, id: archivo.id });
    }
  });

  rechazados.forEach(rechazado => {
    const item = enviados[rechazado.indice];
    if (item !== undefined) {
      reparto.descartados.push({ item, error: rechazado.error });
    }
  });

  return reparto;
}
