import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { EVENTO_ABIERTOS, esFaltaDePermiso, guardarConDialogo, puente, recogerAbiertos } from './escritorio';

/**
 * La aplicación de escritorio vista desde Angular (la lógica, en `escritorio.ts`).
 *
 * Los archivos de «Abrir con…» llegan a la portada como si se hubieran soltado
 * en ella: ahí ya se ofrecen las herramientas que los aceptan, y desde ahí
 * siguen por `TraspasoService` como cualquier otro. Por eso ninguna
 * herramienta sabe nada de esto.
 */
@Injectable({ providedIn: 'root' })
export class EscritorioService {
  private readonly tauri = puente();
  private readonly router = inject(Router);
  private readonly zona = inject(NgZone);

  /** Recibidos antes de que la portada estuviera montada para recogerlos. */
  private recibidos: File[] = [];

  /** Para la portada ya montada cuando llegan más. */
  readonly llegan = new Subject<File[]>();

  get activo(): boolean {
    return this.tauri !== null;
  }

  /** Lo llama la raíz al arrancar. Fuera de la aplicación no hace nada. */
  iniciar(): void {
    if (!this.tauri) {
      return;
    }
    // main.rs avisa con un evento del DOM, que zone.js no ve como propio si
    // llega por `eval`: se vuelve a la zona para que se pinte.
    window.addEventListener(EVENTO_ABIERTOS, () => this.zona.run(() => this.recoger()));
    this.recoger();
  }

  /** Lo que haya llegado mientras la portada no estaba. Se entrega una vez. */
  tomar(): File[] {
    const archivos = this.recibidos;
    this.recibidos = [];
    return archivos;
  }

  /**
   * Guarda con el diálogo de Windows. Devuelve `false` si no hay aplicación o
   * si la ventana no tiene permiso: entonces quien llama hace lo del navegador.
   */
  async guardar(blob: Blob, nombre: string): Promise<boolean> {
    if (!this.tauri) {
      return false;
    }
    try {
      await guardarConDialogo(this.tauri, blob, nombre);
      return true;
    } catch (error) {
      if (esFaltaDePermiso(error)) {
        return false;
      }
      throw error;
    }
  }

  private async recoger(): Promise<void> {
    const archivos = await recogerAbiertos(this.tauri!);
    if (archivos.length === 0) {
      return;
    }
    this.recibidos = archivos;
    this.llegan.next(archivos);
    if (this.router.url.split(/[?#]/)[0] !== '/') {
      await this.router.navigateByUrl('/');
    }
  }
}
