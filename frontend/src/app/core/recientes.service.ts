import { Injectable } from '@angular/core';

import { CLAVE_RECIENTES, anotarReciente, leerRecientes } from './recientes';

/**
 * Las últimas herramientas usadas en este navegador, para el inicio.
 *
 * Si el almacenamiento no está disponible (navegación privada, cookies
 * bloqueadas), simplemente no se recuerda nada.
 */
@Injectable({ providedIn: 'root' })
export class RecientesService {
  lista(): string[] {
    try {
      return leerRecientes(localStorage.getItem(CLAVE_RECIENTES));
    } catch {
      return [];
    }
  }

  anotar(slug: string): void {
    try {
      localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(anotarReciente(this.lista(), slug)));
    } catch {
      // Sin almacenamiento no hay recientes; la herramienta funciona igual.
    }
  }
}
