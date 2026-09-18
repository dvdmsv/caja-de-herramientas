import { Injectable } from '@angular/core';

import { nuevoId } from './ids';

const CLAVE = 'toolbox.session';

/**
 * Identidad anónima del navegador.
 *
 * El servidor guarda los archivos en una carpeta por sesión, así que este id es
 * lo único que separa tus archivos de los de otra persona. Se genera en el
 * cliente y se conserva entre visitas; no identifica a nadie.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly id: string = this.cargarOCrear();

  /** Descarta el id actual y empieza de cero (los archivos del servidor quedan huérfanos y caducan solos). */
  renovar(): string {
    const nuevo = nuevoId();
    this.guardar(nuevo);
    return nuevo;
  }

  private cargarOCrear(): string {
    const guardado = this.leer();
    if (guardado && /^[0-9a-f]{32}$/.test(guardado)) {
      return guardado;
    }
    const nuevo = nuevoId();
    this.guardar(nuevo);
    return nuevo;
  }

  private leer(): string | null {
    try {
      return localStorage.getItem(CLAVE);
    } catch {
      return null; // modo privado o almacenamiento bloqueado
    }
  }

  private guardar(id: string): void {
    try {
      localStorage.setItem(CLAVE, id);
    } catch {
      /* sin persistencia: la sesión durará lo que dure la pestaña */
    }
  }
}
