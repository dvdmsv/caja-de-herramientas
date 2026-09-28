import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { mensajeDeError } from '../../../shared/notify';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/** Qué versión se tiene y cómo llegan las nuevas (`buscar_actualizacion` en main.rs). */
@Component({
  selector: 'app-ajustes-actualizaciones',
  imports: [FilaAjusteComponent],
  template: `
    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Versión instalada" [detalle]="version ? 'Caja de herramientas ' + version : ''">
        <button type="button" class="btn btn-outline-primary" [disabled]="buscando" (click)="buscar()">
          @if (buscando) {
            <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
          } @else {
            <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>
          }
          Buscar ahora
        </button>
        <p debajo class="small mt-1 mb-0" role="status" [class.text-danger]="fallo"
          [class.text-success]="!fallo && resultado">{{ resultado }}</p>
      </app-fila-ajuste>
      <app-fila-ajuste titulo="Buscar al abrir la aplicación"
        detalle="Si hay una versión nueva, te enseña qué trae y te pregunta. Nunca se instala sola.">
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" role="switch" aria-label="Buscar al abrir la aplicación"
            [checked]="ajustes.actualizaciones.al_abrir" [disabled]="ocupada"
            (change)="cambiar.emit({ actualizaciones: { al_abrir: $any($event.target).checked } })">
        </div>
      </app-fila-ajuste>
      @if (ajustes.version_saltada) {
        <app-fila-ajuste titulo="Versión saltada"
          [detalle]="'No te avisará de la ' + ajustes.version_saltada + ', sí de las siguientes.'">
          <button type="button" class="btn btn-outline-secondary" [disabled]="ocupada"
            (click)="cambiar.emit({ version_saltada: null })">Volver a avisarme</button>
        </app-fila-ajuste>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesActualizacionesComponent extends SeccionAjustes {
  @Input() version: string | null = null;

  buscando = false;
  resultado = '';
  fallo = false;

  async buscar(): Promise<void> {
    this.buscando = true;
    this.resultado = '';
    try {
      const nueva = await this.escritorio.buscarActualizacionAhora();
      this.fallo = false;
      this.resultado = nueva ? `Hay una versión nueva: la ${nueva}.` : 'Tienes la última versión.';
    } catch (error) {
      this.fallo = true;
      this.resultado = mensajeDeError(error, 'No se ha podido consultar. ¿Hay conexión a internet?');
    } finally {
      this.buscando = false;
    }
  }
}
