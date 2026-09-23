import { Component, ChangeDetectionStrategy } from '@angular/core';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

/**
 * Quita el color de un PDF sin rasterizarlo: el texto sigue siendo texto.
 *
 * Sin opciones: no hay nada que elegir que no estropee el resultado.
 */
@Component({
  selector: 'app-pdf-a-grises',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './pdf-a-grises.component.html',
})
export class PdfAGrisesComponent extends PaginaHerramienta {
  protected readonly slug = 'pdf-a-grises';
  protected override get mensajeExito(): string {
    return 'PDF en escala de grises';
  }
}
