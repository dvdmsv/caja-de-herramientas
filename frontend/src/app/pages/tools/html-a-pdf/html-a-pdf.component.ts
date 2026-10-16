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
  detalle: string;
}

/**
 * Una página `.html` guardada como PDF, tal como se ve.
 *
 * Sólo se elige el papel: el diseño es el del propio archivo. Lo que no viene
 * dentro de él (imágenes o estilos enlazados) no se descarga, y la página lo
 * avisa para que nadie lo busque en el resultado.
 */
@Component({
  selector: 'app-html-a-pdf',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './html-a-pdf.component.html',
})
export class HtmlAPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'html-a-pdf';
  protected override get mensajeExito(): string {
    return 'PDF creado';
  }

  readonly tamanos: Opcion[] = [
    { id: 'a4', nombre: 'A4', detalle: '21 × 29,7 cm' },
    { id: 'carta', nombre: 'Carta', detalle: '21,6 × 27,9 cm' },
  ];

  readonly orientaciones: Opcion[] = [
    { id: 'vertical', nombre: 'Vertical', detalle: 'lo normal de un documento' },
    { id: 'horizontal', nombre: 'Horizontal', detalle: 'para tablas anchas' },
  ];

  tamano = 'a4';
  orientacion = 'vertical';
  margen = 15;

  protected override opciones(): Record<string, unknown> {
    return { pagina: this.tamano, orientacion: this.orientacion, margen: this.margen };
  }

  elegirTamano(id: string): void {
    this.tamano = id;
    this.alCambiarLista();
  }

  elegirOrientacion(id: string): void {
    this.orientacion = id;
    this.alCambiarLista();
  }
}
