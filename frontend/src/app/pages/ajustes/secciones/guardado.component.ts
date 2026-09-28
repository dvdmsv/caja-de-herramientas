import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ModoGuardado } from '../../../core/ajustes-escritorio';
import { acortarCarpeta } from '../../../core/escritorio';
import { avisoError, mensajeDeError } from '../../../shared/notify';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

interface Modo {
  id: ModoGuardado;
  nombre: string;
  detalle: string;
  icono: string;
}

/**
 * Dónde van los archivos al pulsar «Guardar». Sin diálogo nunca se sobrescribe
 * nada: lo garantiza `escribir_sin_pisar` en main.rs.
 */
@Component({
  selector: 'app-ajustes-guardado',
  imports: [FilaAjusteComponent],
  template: `
    <div class="card tarjeta-ajustes">
      <div class="modos" role="radiogroup" aria-label="Dónde se guarda">
        @for (modo of modos; track modo.id) {
          <input type="radio" class="btn-check" name="modo-guardado" [id]="'modo-' + modo.id"
            [checked]="ajustes.guardado.modo === modo.id" [disabled]="ocupada"
            (change)="elegir(modo.id)">
          <label class="btn btn-outline-primary text-start modo" [for]="'modo-' + modo.id">
            <i class="bi {{ modo.icono }} modo__icono" aria-hidden="true"></i>
            <span class="modo__nombre">{{ modo.nombre }}</span>
            <small class="modo__detalle">{{ modo.detalle }}</small>
          </label>
        }
      </div>
    </div>

    @if (ajustes.guardado.modo === 'carpeta' || ajustes.guardado.carpeta) {
      <div class="card tarjeta-ajustes mt-3">
        <app-fila-ajuste titulo="Carpeta"
          [detalle]="ajustes.guardado.carpeta ? carpeta : 'Todavía no has elegido ninguna.'">
          <button type="button" class="btn btn-outline-secondary" [disabled]="ocupada" (click)="elegirCarpeta()">
            <i class="bi bi-folder2-open me-1" aria-hidden="true"></i>Elegir…
          </button>
        </app-fila-ajuste>
      </div>
    }

    <p class="form-text mt-3">
      @switch (ajustes.guardado.modo) {
        @case ('junto') {
          Sirve para lo que abres con «Abrir con…», el menú del Explorador o «Añadir una carpeta». Lo que
          eliges desde la página no dice de qué carpeta viene, así que entonces se pregunta.
        }
        @case ('carpeta') {
          Si la carpeta deja de existir (un USB que ya no está), se pregunta.
        }
        @default {
          Cada vez que guardes, Windows te preguntará dónde y con qué nombre.
        }
      }
      Sin preguntar, nunca se sobrescribe nada: si ya hay un archivo con ese nombre, se guarda como
      «nombre (1)».
    </p>
  `,
  styles: `
    .modos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; padding: 1rem; }
    .modo { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; height: 100%; }
    .modo__icono { font-size: 1.3rem; margin-bottom: 0.2rem; }
    .modo__nombre { font-weight: 600; }
    .modo__detalle { opacity: 0.85; }
    /* Por debajo de 900 px, los tres modos no caben en una fila sin partir las palabras. */
    @media (max-width: 899.98px) { .modos { grid-template-columns: 1fr; } }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesGuardadoComponent extends SeccionAjustes {
  readonly modos: Modo[] = [
    { id: 'preguntar', nombre: 'Preguntar cada vez', detalle: 'El diálogo de Windows, como siempre',
      icono: 'bi-question-circle' },
    { id: 'junto', nombre: 'Junto al original', detalle: 'En la carpeta del archivo que abriste',
      icono: 'bi-files' },
    { id: 'carpeta', nombre: 'Siempre en una carpeta', detalle: 'La que tú elijas', icono: 'bi-folder2-open' },
  ];

  get carpeta(): string {
    return acortarCarpeta(this.ajustes.guardado.carpeta ?? '');
  }

  elegir(modo: ModoGuardado): void {
    // «Siempre en una carpeta» sin ninguna elegida: primero el diálogo.
    if (modo === 'carpeta' && !this.ajustes.guardado.carpeta) {
      this.elegirCarpeta();
      return;
    }
    this.cambiar.emit({ guardado: { modo } });
  }

  async elegirCarpeta(): Promise<void> {
    try {
      const estado = await this.escritorio.elegirCarpetaDeGuardado();
      if (estado) {
        this.nuevoEstado.emit(estado);
      } else {
        // Se cerró el diálogo: la opción marcada vuelve a la que era. A mano,
        // porque para Angular `[checked]` no ha cambiado y no la toca.
        const actual = document.getElementById(`modo-${this.ajustes.guardado.modo}`) as HTMLInputElement | null;
        if (actual) {
          actual.checked = true;
        }
      }
    } catch (error) {
      avisoError(mensajeDeError(error, 'No se ha podido elegir la carpeta.'));
    }
  }
}
