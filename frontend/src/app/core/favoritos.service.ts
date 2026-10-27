import { Injectable } from '@angular/core';

import { CLAVE_FAVORITOS, alternarFavorito, leerFavoritos } from './favoritos';
import { Herramienta, buscarPorSlug } from './tools';

/**
 * Las herramientas que la persona ha marcado con la estrella, en este navegador.
 *
 * La lista va en un campo y no en una señal: la detección de cambios es
 * `Eager`, así que quien la lea en su plantilla ve el cambio en el siguiente
 * ciclo. Escucha el evento `storage` para que marcar en una ventana se vea en
 * las demás; en la aplicación de Windows comparten origen desde que el puerto
 * es fijo (`escritorio.puerto_preferido`).
 *
 * Sin almacenamiento (navegación privada, cookies bloqueadas) la estrella
 * funciona mientras dura la página y no se recuerda nada.
 */
@Injectable({ providedIn: 'root' })
export class FavoritosService {
  private slugs: string[] = this.leer();

  constructor() {
    window.addEventListener('storage', evento => {
      if (evento.key === CLAVE_FAVORITOS || evento.key === null) {
        this.slugs = this.leer();
      }
    });
  }

  /** Las favoritas que existen y están disponibles, en el orden en que se marcaron. */
  get herramientas(): Herramienta[] {
    return this.slugs
      .map(slug => buscarPorSlug(slug))
      .filter((h): h is Herramienta => !!h && h.disponible);
  }

  es(slug: string): boolean {
    return this.slugs.includes(slug);
  }

  alternar(slug: string): void {
    this.slugs = alternarFavorito(this.slugs, slug);
    try {
      localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(this.slugs));
    } catch {
      // Sin almacenamiento sólo dura lo que la página.
    }
  }

  private leer(): string[] {
    try {
      return leerFavoritos(localStorage.getItem(CLAVE_FAVORITOS));
    } catch {
      return [];
    }
  }
}
