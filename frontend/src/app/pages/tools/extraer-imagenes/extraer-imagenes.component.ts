
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface Opcion { id: string; nombre: string; detalle: string; }

@Component({
  selector: 'app-extraer-imagenes',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './extraer-imagenes.component.html',
})
export class ExtraerImagenesComponent extends PaginaHerramienta {
  protected readonly slug = 'extraer-imagenes';
  protected override readonly unoPorUno = true;
  protected override get mensajeExito(): string {
    return 'Imágenes extraídas';
  }

  readonly formatos: Opcion[] = [
    { id: 'original', nombre: 'Como están', detalle: 'sin recomprimir, tal cual' },
    { id: 'PNG', nombre: 'PNG', detalle: 'todas en el mismo formato' },
    { id: 'JPEG', nombre: 'JPG', detalle: 'más ligeras' },
  ];

  formato = 'original';
  ladoMinimo = 100;

  protected override opciones(): Record<string, unknown> {
    return { formato: this.formato, lado_minimo: this.ladoMinimo };
  }

  elegirFormato(id: string): void {
    this.formato = id;
    this.alCambiarLista();
  }
}
