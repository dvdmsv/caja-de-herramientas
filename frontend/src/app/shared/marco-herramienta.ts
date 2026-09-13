import { InjectionToken } from '@angular/core';

import { Herramienta } from '../core/tools';

/** Lo que el marco de una herramienta necesita de su cola de subida. */
export interface ColaReceptora {
  recibir(archivos: File[]): void;
}

/**
 * El marco de la página de una herramienta (`app-tool-page`), visto desde la
 * cola de subida que lleva dentro.
 *
 * Es un token y no el componente para no crear una importación circular entre
 * los dos. Sirve para dos cosas: que la cola sepa qué archivos admite la
 * herramienta sin repetirlo en cada plantilla, y que el marco sepa a qué cola
 * entregar los archivos que llegan de otra herramienta.
 */
export interface MarcoHerramienta {
  readonly herramienta?: Herramienta;
  /** La primera cola que se registra es la principal: la que recibe los traspasos. */
  registrarCola(cola: ColaReceptora): void;
}

export const MARCO_HERRAMIENTA = new InjectionToken<MarcoHerramienta>('MarcoHerramienta');
