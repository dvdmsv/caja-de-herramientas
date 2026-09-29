import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PLAZOS, Plazo } from '../../../core/ajustes-escritorio';
import { ApiService, EspacioDeTrabajo } from '../../../core/api.service';
import { UsoService } from '../../../core/uso.service';
import { avisoError, mensajeDeError } from '../../../shared/notify';
import { PesoPipe } from '../../../shared/peso.pipe';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/**
 * Los archivos de trabajo: lo que se sube y lo que sale de cada herramienta,
 * guardado en la carpeta de datos. Se borran solos al volver a abrir la
 * aplicación —la ventana que los usaba ya no existe— o antes, tras el plazo
 * que se elija aquí; y se pueden borrar a mano.
 *
 * El plazo se aplica **al momento** (`/api/escritorio/plazo`, que cambia el del
 * backend en marcha) y se guarda para la próxima vez (`ajustes.rs`, que lo pasa
 * al arrancar el backend).
 */
@Component({
  selector: 'app-ajustes-espacio',
  imports: [FilaAjusteComponent, PesoPipe],
  template: `
    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Archivos de trabajo"
        [detalle]="espacio ? (espacio.ocupado | peso) + ' en ' + espacio.sesiones + (espacio.sesiones === 1 ? ' ventana' : ' ventanas') : 'Mirando…'">
        <button type="button" class="btn btn-outline-primary" [disabled]="liberando || !espacio?.ocupado"
          (click)="liberar()">
          @if (liberando) {
            <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
          } @else {
            <i class="bi bi-trash me-1" aria-hidden="true"></i>
          }
          Liberar espacio
        </button>
        <p debajo class="small text-success mt-1 mb-0" role="status">{{ resultado }}</p>
      </app-fila-ajuste>
      @if (espacio?.actualizacion) {
        <!-- Casi nunca sale: la aplicación borra esto al arrancar. Si se ve, es
             una actualización a medias, y así no ocupa sitio sin que se sepa. -->
        <app-fila-ajuste titulo="Restos de una actualización"
          [detalle]="(espacio!.actualizacion! | peso) + ' · se borran solos al volver a abrir la aplicación'">
        </app-fila-ajuste>
      }
      <app-fila-ajuste titulo="Borrar los archivos de trabajo"
        detalle="Sin usarlos es sin subir ni generar nada: cada archivo nuevo vuelve a empezar la cuenta.">
        <select class="form-select" aria-label="Borrar los archivos de trabajo" [disabled]="ocupada || cambiandoPlazo"
          (change)="cambiarPlazo($any($event.target))">
          @for (opcion of plazos; track opcion.valor) {
            <option [value]="opcion.valor ?? ''" [selected]="ajustes.espacio.plazo === opcion.valor">{{ opcion.texto }}</option>
          }
        </select>
      </app-fila-ajuste>
      <app-fila-ajuste titulo="Carpeta de datos"
        detalle="Los archivos de trabajo, los ajustes y los registros.">
        <button type="button" class="btn btn-outline-secondary" (click)="abrir()">
          <i class="bi bi-folder2-open me-1" aria-hidden="true"></i>Abrir
        </button>
      </app-fila-ajuste>
    </div>
    <p class="form-text mt-3">
      Son lo que subes y lo que sale de cada herramienta mientras trabajas. Se borran solos al volver a
      abrir la aplicación o, si lo eliges, antes. «Liberar espacio» borra ya los que no se usan: no toca
      los de esta ventana ni los de las que hayas usado en los últimos minutos.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesEspacioComponent extends SeccionAjustes implements OnInit {
  private readonly api = inject(ApiService);
  private readonly uso = inject(UsoService);

  readonly plazos = PLAZOS;
  espacio: EspacioDeTrabajo | null = null;
  liberando = false;
  cambiandoPlazo = false;
  resultado = '';

  ngOnInit(): void {
    this.api.espacioDeTrabajo().subscribe({
      next: espacio => (this.espacio = espacio),
      error: () => (this.espacio = { ocupado: 0, sesiones: 0 }),
    });
  }

  async liberar(): Promise<void> {
    this.liberando = true;
    this.resultado = '';
    try {
      const { liberado, ...espacio } = await firstValueFrom(this.api.liberarEspacioDeTrabajo());
      this.espacio = espacio;
      this.resultado = liberado ? `Liberados ${new PesoPipe().transform(liberado)}.` : 'No había nada que se pudiera borrar.';
    } catch (error) {
      avisoError(mensajeDeError(error, 'No se ha podido liberar espacio.'));
    } finally {
      this.liberando = false;
    }
  }

  /** Primero en el backend, que es lo que vale ya; si eso falla, no se guarda. */
  async cambiarPlazo(desplegable: HTMLSelectElement): Promise<void> {
    const plazo = (desplegable.value || null) as Plazo | null;
    this.cambiandoPlazo = true;
    try {
      await firstValueFrom(this.api.cambiarPlazo(plazo));
      this.cambiar.emit({ espacio: { plazo } });
      // El indicador de la barra dice el plazo: que cambie ya.
      this.uso.refrescar();
    } catch (error) {
      // Que el desplegable no diga lo que no se ha aplicado.
      desplegable.value = this.ajustes.espacio.plazo ?? '';
      avisoError(mensajeDeError(error, 'No se ha podido cambiar el plazo.'));
    } finally {
      this.cambiandoPlazo = false;
    }
  }

  abrir(): void {
    this.escritorio.abrirCarpetaDeDatos().catch(error => avisoError(mensajeDeError(error, 'No se ha podido abrir.')));
  }
}
