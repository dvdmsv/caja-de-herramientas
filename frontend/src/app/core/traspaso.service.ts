import { Injectable } from '@angular/core';

/**
 * Archivos de camino entre dos herramientas.
 *
 * "Usar en…" y el inicio dejan aquí los archivos antes de navegar, y la
 * herramienta de destino los recoge al montarse. Viven sólo en memoria y se
 * entregan una vez: `tomar()` los vacía, para que volver atrás o recargar no los
 * meta de nuevo.
 */
@Injectable({ providedIn: 'root' })
export class TraspasoService {
  private pendientes: File[] = [];

  dejar(archivos: File[]): void {
    this.pendientes = [...archivos];
  }

  tomar(): File[] {
    const archivos = this.pendientes;
    this.pendientes = [];
    return archivos;
  }
}
