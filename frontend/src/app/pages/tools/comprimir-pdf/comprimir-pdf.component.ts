
import { Component, ChangeDetectionStrategy } from '@angular/core';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface OpcionNivel {
  id: string;
  nombre: string;
  detalle: string;
}

@Component({
  selector: 'app-comprimir-pdf',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './comprimir-pdf.component.html',
})
export class ComprimirPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'comprimir-pdf';
  protected override get mensajeExito(): string {
    return 'PDF comprimido';
  }

  readonly niveles: OpcionNivel[] = [
    { id: 'ninguno', nombre: 'Ninguna', detalle: 'No toca las imágenes' },
    { id: 'suave', nombre: 'Suave', detalle: 'Apenas se nota la pérdida' },
    { id: 'media', nombre: 'Media', detalle: 'Buen equilibrio' },
    { id: 'fuerte', nombre: 'Fuerte', detalle: 'El más ligero' },
  ];

  nivel = 'media';
  paraWeb = false;

  protected override opciones(): Record<string, unknown> {
    return { nivel: this.nivel, web: this.paraWeb };
  }

  elegirNivel(id: string): void {
    this.nivel = id;
    this.alCambiarLista();
  }

  cambiarParaWeb(evento: Event): void {
    this.paraWeb = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }
}
