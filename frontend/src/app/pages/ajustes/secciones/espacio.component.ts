import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService, EspacioDeTrabajo } from '../../../core/api.service';
import { avisoError, mensajeDeError } from '../../../shared/notify';
import { PesoPipe } from '../../../shared/peso.pipe';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/**
 * Los archivos de trabajo: lo que se sube y lo que sale de cada herramienta,
 * guardado en la carpeta de datos hasta cerrar la ventana. Se borran solos al
 * volver a abrir la aplicación; aquí se pueden borrar antes.
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
      <app-fila-ajuste titulo="Carpeta de datos"
        detalle="Los archivos de trabajo, los ajustes y los registros.">
        <button type="button" class="btn btn-outline-secondary" (click)="abrir()">
          <i class="bi bi-folder2-open me-1" aria-hidden="true"></i>Abrir
        </button>
      </app-fila-ajuste>
    </div>
    <p class="form-text mt-3">
      Son lo que subes y lo que sale de cada herramienta mientras trabajas. Se borran solos al volver a
      abrir la aplicación. «Liberar espacio» borra ya los que no se usan: no toca los de esta ventana
      ni los de las que hayas usado en los últimos minutos.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesEspacioComponent extends SeccionAjustes implements OnInit {
  private readonly api = inject(ApiService);

  espacio: EspacioDeTrabajo | null = null;
  liberando = false;
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

  abrir(): void {
    this.escritorio.abrirCarpetaDeDatos().catch(error => avisoError(mensajeDeError(error, 'No se ha podido abrir.')));
  }
}
