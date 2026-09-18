import { Component, ChangeDetectionStrategy } from '@angular/core';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

@Component({
  selector: 'app-aplanar-pdf',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './aplanar-pdf.component.html',
})
export class AplanarPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'aplanar-pdf';
  protected override get mensajeExito(): string {
    return 'PDF aplanado';
  }

  campos = true;
  anotaciones = true;

  /** Sin nada marcado no hay nada que aplanar; el backend también lo rechaza. */
  get nadaQueAplanar(): boolean {
    return !this.campos && !this.anotaciones;
  }

  protected override opciones(): Record<string, unknown> {
    return { campos: this.campos, anotaciones: this.anotaciones };
  }

  cambiar(cual: 'campos' | 'anotaciones', evento: Event): void {
    this[cual] = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }
}
