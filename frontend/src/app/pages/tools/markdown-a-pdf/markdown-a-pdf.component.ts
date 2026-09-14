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
 * La vuelta de "Documento a Markdown": el texto que devuelve un LLM se convierte
 * en un documento presentable sin pasar por un editor.
 *
 * No hay vista previa propia, y es a propósito: el resultado se mira con el ojo
 * de la lista, que abre el PDF en el visor del navegador sin descargarlo. Una
 * vista previa aquí sería la misma imagen, pedida antes.
 */
@Component({
  selector: 'app-markdown-a-pdf',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent
],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './markdown-a-pdf.component.html',
})
export class MarkdownAPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'markdown-a-pdf';
  protected override get mensajeExito(): string {
    return 'PDF creado';
  }

  readonly tamanos: Opcion[] = [
    { id: 'a4', nombre: 'A4', detalle: '21 × 29,7 cm' },
    { id: 'carta', nombre: 'Carta', detalle: '21,6 × 27,9 cm' },
  ];

  readonly orientaciones: Opcion[] = [
    { id: 'vertical', nombre: 'Vertical', detalle: 'lo normal de un texto' },
    { id: 'horizontal', nombre: 'Horizontal', detalle: 'para tablas anchas' },
  ];

  readonly familias: Opcion[] = [
    { id: 'sans', nombre: 'Helvetica', detalle: 'sin remates, la de pantalla' },
    { id: 'serif', nombre: 'Times', detalle: 'con remates, la de imprenta' },
  ];

  tamano = 'a4';
  orientacion = 'vertical';
  familia = 'sans';
  margen = 20;
  cuerpo = 11;

  protected override opciones(): Record<string, unknown> {
    return {
      pagina: this.tamano,
      orientacion: this.orientacion,
      familia: this.familia,
      margen: this.margen,
      cuerpo: this.cuerpo,
    };
  }

  elegirTamano(id: string): void {
    this.tamano = id;
    this.alCambiarLista();
  }

  elegirOrientacion(id: string): void {
    this.orientacion = id;
    this.alCambiarLista();
  }

  elegirFamilia(id: string): void {
    this.familia = id;
    this.alCambiarLista();
  }
}
