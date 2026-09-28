
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface Idioma {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-ocr-pdf',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './ocr-pdf.component.html',
})
export class OcrPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'ocr-pdf';
  protected override readonly unoPorUno = true;
  protected override get mensajeExito(): string {
    return 'Texto reconocido';
  }

  readonly idiomas: Idioma[] = [
    { id: 'spa+eng', nombre: 'Español e inglés' },
    { id: 'spa', nombre: 'Sólo español' },
    { id: 'eng', nombre: 'Sólo inglés' },
  ];

  idioma = 'spa+eng';
  rehacer = false;

  protected override opciones(): Record<string, unknown> {
    return { idioma: this.idioma, rehacer: this.rehacer };
  }
}
