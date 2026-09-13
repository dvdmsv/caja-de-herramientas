
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FormatoImagen } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';

@Component({
  selector: 'app-convertir-imagen',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent
],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './convertir-imagen.component.html',
})
export class ConvertirImagenComponent extends PaginaHerramienta implements OnInit {
  protected readonly slug = 'convertir-imagen';
  protected override get mensajeExito(): string {
    return 'Imágenes convertidas';
  }

  /** Los formatos los decide el servidor: sólo ofrece los que puede escribir. */
  formatos: FormatoImagen[] = [];
  formato = '';
  calidad = 85;

  ngOnInit(): void {
    this.api.formatosDeImagen().subscribe({
      next: formatos => {
        this.formatos = formatos;
        this.formato = formatos[0]?.id ?? '';
      },
      error: err => avisoError(mensajeDeError(err, 'No se han podido cargar los formatos.')),
    });
  }

  /** El ajuste de calidad sólo tiene sentido en los formatos con pérdida. */
  get admiteCalidad(): boolean {
    return this.formatos.find(f => f.id === this.formato)?.calidad ?? false;
  }

  override get listo(): boolean {
    return super.listo && this.formato !== '';
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    return this.formato ? null : 'Elige el formato de salida.';
  }

  protected override opciones(): Record<string, unknown> {
    return { formato: this.formato, calidad: this.calidad };
  }
}
