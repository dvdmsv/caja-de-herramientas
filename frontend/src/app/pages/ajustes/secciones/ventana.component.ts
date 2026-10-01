import { ChangeDetectionStrategy, Component } from '@angular/core';

import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/**
 * Qué hace la X de la ventana (`escritorio/src-tauri/src/bandeja.rs`). Se
 * aplica al momento: `guardar_ajustes` pone o quita el icono junto al reloj.
 */
@Component({
  selector: 'app-ajustes-ventana',
  imports: [FilaAjusteComponent],
  template: `
    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Al cerrar, seguir junto al reloj"
        detalle="La X deja la aplicación en el área de notificación, con los trabajos en marcha, y vuelve al instante. Para salir del todo: clic derecho en su icono → Salir.">
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" role="switch" aria-label="Al cerrar, seguir junto al reloj"
            [checked]="ajustes.ventana.a_la_bandeja" [disabled]="ocupada"
            (change)="cambiar.emit({ ventana: { a_la_bandeja: $any($event.target).checked } })">
        </div>
      </app-fila-ajuste>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesVentanaComponent extends SeccionAjustes {}
