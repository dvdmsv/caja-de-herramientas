import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, inject } from '@angular/core';

import { BovedaService } from '../../core/boveda.service';
import { avisoError, avisoExito } from '../notify';
import { asegurarAbierta, pedirNombre } from './dialogos';

/**
 * «Guardar en la bóveda» para la firma que se acaba de dibujar o subir. Se
 * guarda la imagen tal como entró: el quitar el fondo de «Firmar documento» se
 * vuelve a aplicar al usarla. Fuera de la aplicación no pinta nada.
 */
@Component({
  selector: 'app-guardar-firma',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (boveda.disponible && archivo) {
      @if (guardada) {
        <span class="small text-success-emphasis">
          <i class="bi bi-check-circle me-1" aria-hidden="true"></i>Guardada en la bóveda
        </span>
      } @else {
        <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="deshabilitado || guardando"
          (click)="guardar()">
          <i class="bi bi-safe2 me-1" aria-hidden="true"></i>Guardar en la bóveda
        </button>
      }
    }
  `,
})
export class GuardarFirmaComponent implements OnChanges {
  @Input() archivo?: File;
  @Input() deshabilitado = false;

  protected readonly boveda = inject(BovedaService);
  private readonly cd = inject(ChangeDetectorRef);
  guardada = false;
  guardando = false;

  ngOnChanges(): void {
    this.guardada = false;
  }

  async guardar(): Promise<void> {
    if (!this.archivo || !(await asegurarAbierta(this.boveda))) {
      return;
    }
    const nombre = await pedirNombre('Guardar la firma', `Firma ${this.boveda.contenido.firmas.length + 1}`);
    if (!nombre) {
      return;
    }
    this.guardando = true;
    try {
      await this.boveda.guardarFirma(this.archivo, nombre);
      this.guardada = true;
      avisoExito('Firma guardada en la bóveda');
    } catch (error) {
      avisoError((error as Error).message);
    } finally {
      this.guardando = false;
      this.cd.markForCheck();
    }
  }
}
