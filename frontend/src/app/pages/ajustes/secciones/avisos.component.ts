import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ESPERAS_DE_AVISO, textoDeEspera } from '../../../core/ajustes-escritorio';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/** La notificación de Windows al terminar un trabajo largo (`EscritorioService.terminado`). */
@Component({
  selector: 'app-ajustes-avisos',
  imports: [FilaAjusteComponent],
  template: `
    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Avisar al terminar"
        detalle="Una notificación de Windows cuando acaba un trabajo largo y estás en otra ventana.">
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" role="switch" aria-label="Avisar al terminar"
            [checked]="ajustes.avisos.activos" [disabled]="ocupada"
            (change)="cambiar.emit({ avisos: { activos: $any($event.target).checked } })">
        </div>
      </app-fila-ajuste>
      <app-fila-ajuste titulo="A partir de" detalle="Lo que tiene que durar un trabajo para avisar.">
        <select class="form-select" aria-label="A partir de cuánto tiempo"
          [disabled]="ocupada || !ajustes.avisos.activos"
          (change)="cambiar.emit({ avisos: { desde_segundos: +$any($event.target).value } })">
          @for (segundos of esperas; track segundos) {
            <option [value]="segundos" [selected]="segundos === ajustes.avisos.desde_segundos">
              {{ texto(segundos) }}
            </option>
          }
        </select>
      </app-fila-ajuste>
    </div>
    <p class="form-text mt-3">
      Si estás mirando la ventana, no se avisa: ya ves el resultado. La barra de progreso en el icono
      de la barra de tareas sale siempre.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesAvisosComponent extends SeccionAjustes {
  readonly texto = textoDeEspera;

  /** Las de siempre, más la que tenga guardada si no es ninguna de ellas. */
  get esperas(): number[] {
    const actual = this.ajustes.avisos.desde_segundos;
    return ESPERAS_DE_AVISO.includes(actual) ? ESPERAS_DE_AVISO : [...ESPERAS_DE_AVISO, actual].sort((a, b) => a - b);
  }
}
