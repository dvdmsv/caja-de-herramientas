import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { ApiService, UsoSesion } from './api.service';

/**
 * Cuánto ocupa la sesión en el servidor, para poder enseñarlo.
 *
 * Lo comparten la cola de archivos —que lo pinta— y las páginas de herramienta,
 * que avisan cuando algo ha cambiado: al subir, al terminar un trabajo y al
 * empezar de cero. No se consulta sola cada poco: preguntar por preguntar
 * gastaría más de lo que informa.
 */
@Injectable({ providedIn: 'root' })
export class UsoService {
  private readonly api = inject(ApiService);
  private readonly estado = new BehaviorSubject<UsoSesion | null>(null);

  readonly uso: Observable<UsoSesion | null> = this.estado.asObservable();

  refrescar(): void {
    this.api.usoDeLaSesion().subscribe({
      next: uso => this.estado.next(uso),
      // Si falla, simplemente no se enseña: es un dato de cortesía, no algo
      // sin lo que la herramienta no pueda funcionar.
      error: () => this.estado.next(null),
    });
  }

  olvidar(): void {
    this.estado.next(null);
  }
}
