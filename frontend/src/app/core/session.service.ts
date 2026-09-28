import { Injectable } from '@angular/core';

import { puente } from './escritorio';
import { nuevoId } from './ids';

const CLAVE = 'toolbox.session';

/**
 * Identidad anónima del navegador.
 *
 * El servidor guarda los archivos en una carpeta por sesión, así que este id es
 * lo único que separa tus archivos de los de otra persona. Se genera en el
 * cliente y se conserva entre visitas; no identifica a nadie.
 *
 * En la aplicación de Windows, en cambio, **cada ventana lleva la suya**
 * (`sessionStorage`, que no se comparte entre ventanas): con una sesión común,
 * dos ventanas trabajarían sobre los mismos archivos y «Empezar de cero» en una
 * se llevaría los de la otra. Allí no hay visitas que recordar: el backend borra
 * las sesiones anteriores al arrancar.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly almacen = (): Storage => (puente() ? sessionStorage : localStorage);

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
      return this.almacen().getItem(CLAVE);
    } catch {
      return null; // modo privado o almacenamiento bloqueado
    }
  }

  private guardar(id: string): void {
    try {
      this.almacen().setItem(CLAVE, id);
    } catch {
      /* sin persistencia: la sesión durará lo que dure la pestaña */
    }
  }
}
