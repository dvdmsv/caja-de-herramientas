/**
 * Un trabajo de motor cada vez, por orden de llegada.
 *
 * En el teléfono sólo cabe un motor en marcha: cada worker de WebAssembly
 * reserva su propia memoria, y Ghostscript, Office o la firma ocupan el puente
 * nativo. Antes, la petición que llegaba con otra en marcha se rechazaba con
 * «Espera a que termine la operación actual», y eso pasaba con sólo pulsar el
 * botón principal mientras se dibujaba la vista previa de la marca de agua: en
 * el servidor van en paralelo, y la página no tiene por qué saber que aquí no.
 *
 * Así que se espera el turno. Una petición cancelada mientras espera (la
 * página cerrada, «Empezar de cero») sale de la cola sin llegar a ejecutarse
 * y no retrasa a las que vienen detrás.
 */
export class Turno {
  private ultimo: Promise<void> = Promise.resolve();

  ejecutar<T>(signal: AbortSignal, tarea: () => Promise<T>, cancelada: () => unknown): Promise<T> {
    const anterior = this.ultimo;
    let soltar!: () => void;
    const mio = new Promise<void>(listo => (soltar = listo));
    // El siguiente espera al anterior *y* a éste: si éste se cancela antes de
    // empezar, suelta su parte, pero el anterior sigue contando.
    this.ultimo = anterior.then(() => mio);

    const esperar = new Promise<void>((listo, fallo) => {
      if (signal.aborted) { fallo(cancelada()); return; }
      const alCancelar = () => fallo(cancelada());
      signal.addEventListener('abort', alCancelar, { once: true });
      void anterior.then(() => {
        signal.removeEventListener('abort', alCancelar);
        listo();
      });
    });
    return esperar.then(tarea).finally(soltar);
  }
}
