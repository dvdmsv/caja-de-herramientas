import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, tap } from 'rxjs';

import { ApiService, UsoSesion } from './api.service';

/**
 * Cuánto ocupa la sesión en el servidor, para poder enseñarlo en todo momento.
 *
 * Lo pinta el indicador de la barra superior, que pregunta al arrancar, y lo
 * refrescan las páginas de herramienta cuando algo ha cambiado: al subir y al
 * terminar un trabajo. También se pregunta al volver a la pestaña, porque la
 * sesión puede haber caducado mientras tanto. No se consulta sola cada poco:
 * preguntar por preguntar gastaría más de lo que informa.
 */
@Injectable({ providedIn: 'root' })
export class UsoService {
  private readonly api = inject(ApiService);
  private readonly estado = new BehaviorSubject<UsoSesion | null>(null);
  private readonly vaciadaAhora = new Subject<void>();

  readonly uso: Observable<UsoSesion | null> = this.estado.asObservable();

  /**
   * Avisa de que la sesión se ha vaciado, venga de donde venga la orden. Las
   * páginas de herramienta lo escuchan para soltar sus colas: si se vacía
   * desde la barra, sus archivos ya no existen en el servidor.
   */
  readonly vaciada: Observable<void> = this.vaciadaAhora.asObservable();

  constructor() {
    const documento = inject(DOCUMENT);
    documento.addEventListener('visibilitychange', () => {
      if (documento.visibilityState === 'visible') {
        this.refrescar();
      }
    });
  }

  refrescar(): void {
    this.api.usoDeLaSesion().subscribe({
      next: uso => this.estado.next(uso),
      // Si falla, simplemente no se enseña: es un dato de cortesía, no algo
      // sin lo que la herramienta no pueda funcionar.
      error: () => this.estado.next(null),
    });
  }

  /** Borra todos los archivos de la sesión en el servidor. */
  vaciar(): Observable<void> {
    return this.api.limpiarSesion().pipe(tap(() => {
      this.olvidar();
      this.vaciadaAhora.next();
    }));
  }

  /** La sesión se ha quedado vacía: se sabe sin preguntar. El tope no cambia. */
  private olvidar(): void {
    const actual = this.estado.value;
    this.estado.next(actual ? { ...actual, usado: 0, caduca: null } : null);
  }
}
