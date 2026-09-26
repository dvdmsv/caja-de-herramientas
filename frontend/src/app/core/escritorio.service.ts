import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import {
  AVISO_DESDE_MS, EVENTO_ABIERTOS, aplicarMenuContextual, avisarFin, esFaltaDePermiso, guardarConDialogo,
  leerMenuContextual, progresoTarea, puente, recogerAbiertos, textoDelAviso, versionDeLaAplicacion,
} from './escritorio';
import { AvanceTrabajo } from '../shared/progreso';
import { AjustesMenu, accionesMarcadas } from './menu-contextual';
import { buscarPorSlug, rutaDe } from './tools';
import { TraspasoService } from './traspaso.service';

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
  private readonly traspaso = inject(TraspasoService);

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

  /** La versión instalada, o `null` en la web o si no se puede saber. */
  async version(): Promise<string | null> {
    if (!this.tauri) {
      return null;
    }
    try {
      return await versionDeLaAplicacion(this.tauri);
    } catch {
      return null;
    }
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
        // Se descarga como en el navegador, pero diciéndolo: este rechazo
        // fue mudo durante tres versiones («not allowed by ACL» por no
        // declarar el permiso del comando) y nadie lo vio hasta usarla.
        console.warn('Tauri ha rechazado guardar_como; se descarga como en el navegador.', error);
        return false;
      }
      throw error;
    }
  }

  private ultimoProgreso = 0;

  /**
   * El progreso de un trabajo en el icono de la barra de tareas. Llega en cada
   * vuelta del sondeo; se manda como mucho cada medio segundo.
   */
  progreso(avance: AvanceTrabajo): void {
    if (!this.tauri || Date.now() - this.ultimoProgreso < 500) {
      return;
    }
    this.ultimoProgreso = Date.now();
    const porcentaje = avance.indeterminado ? null : Math.round(avance.porcentaje);
    progresoTarea(this.tauri, porcentaje, false).catch(() => {});
  }

  /**
   * Quita la barra y, si el trabajo ha sido largo, avisa con una notificación
   * de Windows (que main.rs sólo enseña si la ventana no tiene el foco).
   * `bien` a `null` es un trabajo cancelado: sólo se quita la barra.
   */
  terminado(herramienta: string, bien: boolean | null, duracionMs: number, archivos: string[], mensaje = ''): void {
    if (!this.tauri) {
      return;
    }
    this.ultimoProgreso = 0;
    progresoTarea(this.tauri, null, true).catch(() => {});
    if (bien === null || duracionMs < AVISO_DESDE_MS) {
      return;
    }
    const { titulo, cuerpo } = textoDelAviso(herramienta, bien, archivos, mensaje);
    avisarFin(this.tauri, titulo, cuerpo).catch(error => console.warn('No se ha podido avisar al terminar.', error));
  }

  /** Cómo está el menú del Explorador; `null` fuera de la aplicación. */
  async menuContextual(): Promise<AjustesMenu | null> {
    return this.tauri ? leerMenuContextual(this.tauri) : null;
  }

  /** Lo pone o lo quita con las herramientas marcadas; devuelve cómo queda. */
  async aplicarMenuContextual(activo: boolean, marcadas: string[]): Promise<AjustesMenu> {
    if (!this.tauri) {
      throw new Error('Sólo en la aplicación de Windows.');
    }
    return aplicarMenuContextual(this.tauri, activo, accionesMarcadas(marcadas));
  }

  /**
   * Lo que llega del menú del Explorador va directo a su herramienta, por
   * `TraspasoService` como «Usar en…», así que la herramienta no sabe nada.
   * Lo de «Abrir con…» va a la portada, que ofrece las que lo aceptan. Si llegan
   * varias tandas a la vez manda la última, que es la que acaba de pedirse.
   */
  private async recoger(): Promise<void> {
    let llegadas;
    try {
      llegadas = await recogerAbiertos(this.tauri!);
    } catch (error) {
      console.warn('No se han podido recoger los archivos de «Abrir con…».', error);
      return;
    }
    const llegada = llegadas.at(-1);
    if (!llegada?.archivos.length) {
      return;
    }
    const herramienta = llegada.herramienta ? buscarPorSlug(llegada.herramienta) : undefined;
    if (herramienta) {
      this.traspaso.dejar(llegada.archivos);
      // Por la portada primero: si ya se está en esa herramienta, navegar a la
      // misma ruta no la vuelve a montar y los archivos se quedarían sin recoger.
      await this.router.navigateByUrl('/', { skipLocationChange: true });
      await this.router.navigateByUrl(rutaDe(herramienta));
      return;
    }
    this.recibidos = llegada.archivos;
    this.llegan.next(llegada.archivos);
    if (this.router.url.split(/[?#]/)[0] !== '/') {
      await this.router.navigateByUrl('/');
    }
  }
}
