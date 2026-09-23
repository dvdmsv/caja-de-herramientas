import { Component, ChangeDetectionStrategy } from '@angular/core';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

/**
 * Un correo `.eml` guardado como documento, con los adjuntos aparte.
 *
 * Sin opciones, a propósito: un correo no se diseña, se guarda. Quien quiera
 * otra maquetación lo pasa a Markdown y lo lleva a «Markdown a PDF».
 */
@Component({
  selector: 'app-correo-a-pdf',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './correo-a-pdf.component.html',
})
export class CorreoAPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'correo-a-pdf';
  protected override get mensajeExito(): string {
    return 'Correos convertidos';
  }
}
