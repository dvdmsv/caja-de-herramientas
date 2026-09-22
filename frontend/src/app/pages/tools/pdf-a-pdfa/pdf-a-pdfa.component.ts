import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface Opcion {
  id: string;
  nombre: string;
  ayuda: string;
}

/** Los dos perfiles que piden las administraciones. Coinciden con `PERFILES`
 * en `backend/api/tools/pdf_a_pdfa.py`, que rechaza cualquier otro. */
const PERFILES: Opcion[] = [
  {
    id: '2b',
    nombre: 'PDF/A-2b',
    ayuda: 'El que acepta casi todo el mundo hoy. Empieza por aquí.',
  },
  {
    id: '1b',
    nombre: 'PDF/A-1b',
    ayuda: 'Más estricto y más antiguo: ni transparencias ni archivos adjuntos. '
      + 'Algunas sedes lo piden por su nombre.',
  },
];

const IDIOMAS: Opcion[] = [
  { id: 'spa+eng', nombre: 'Español e inglés', ayuda: '' },
  { id: 'spa', nombre: 'Español', ayuda: '' },
  { id: 'eng', nombre: 'Inglés', ayuda: '' },
];

@Component({
  selector: 'app-pdf-a-pdfa',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './pdf-a-pdfa.component.html',
})
export class PdfAPdfaComponent extends PaginaHerramienta {
  protected readonly slug = 'pdf-a-pdfa';
  protected override get mensajeExito(): string {
    return 'Convertido a PDF/A';
  }

  readonly perfiles = PERFILES;
  readonly idiomas = IDIOMAS;

  perfil = '2b';
  /** Apagado por defecto: reconocer el texto tarda lo que un OCR entero. */
  ocr = false;
  idioma = 'spa+eng';

  elegirPerfil(id: string): void {
    this.perfil = id;
    this.alCambiarLista();
  }

  cambiarOcr(evento: Event): void {
    this.ocr = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }

  protected override opciones(): Record<string, unknown> {
    return { perfil: this.perfil, ocr: this.ocr, idioma: this.idioma };
  }
}
