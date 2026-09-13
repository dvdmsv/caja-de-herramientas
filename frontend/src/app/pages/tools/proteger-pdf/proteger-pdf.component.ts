
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

const LONGITUD_MINIMA = 4;

@Component({
  selector: 'app-proteger-pdf',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './proteger-pdf.component.html',
})
export class ProtegerPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'proteger-pdf';
  protected override get mensajeExito(): string {
    return this.accion === 'proteger' ? 'PDF protegido' : 'Contraseña quitada';
  }

  accion: 'proteger' | 'quitar' = 'proteger';
  password = '';
  repetida = '';
  passwordActual = '';

  get coinciden(): boolean {
    return this.password === this.repetida;
  }

  get suficienteLarga(): boolean {
    return this.password.length >= LONGITUD_MINIMA;
  }

  override get listo(): boolean {
    if (!super.listo) {
      return false;
    }
    return this.accion === 'proteger'
      ? this.suficienteLarga && this.coinciden
      : this.passwordActual.length > 0;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (this.accion === 'quitar') {
      return this.passwordActual.length > 0 ? null : 'Escribe la contraseña actual del PDF.';
    }
    if (!this.suficienteLarga) {
      return `La contraseña tiene que tener al menos ${LONGITUD_MINIMA} caracteres.`;
    }
    return this.coinciden ? null : 'Las dos contraseñas no coinciden.';
  }

  cambiarAccion(accion: 'proteger' | 'quitar'): void {
    this.accion = accion;
    this.alCambiarLista();
  }

  protected override opciones(): Record<string, unknown> {
    return this.accion === 'proteger'
      ? { accion: 'proteger', password: this.password, password_actual: this.passwordActual }
      : { accion: 'quitar', password_actual: this.passwordActual };
  }
}
