import { Component, ChangeDetectionStrategy } from '@angular/core';

import { Resultado } from '../../../core/api.service';
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
  /** Desmarcado de serie: aplanar reescribe el PDF y eso invalida su firma. */
  firmados = false;
  /** Los que tenían la estructura dañada y el servidor reparó antes de aplanar. */
  reparados: string[] = [];

  /** Sin nada marcado no hay nada que aplanar; el backend también lo rechaza. */
  get nadaQueAplanar(): boolean {
    return !this.campos && !this.anotaciones;
  }

  protected override opciones(): Record<string, unknown> {
    return { campos: this.campos, anotaciones: this.anotaciones, firmados: this.firmados };
  }

  override ejecutar(): void {
    this.reparados = [];
    super.ejecutar();
  }

  protected override alTerminar(resultado: Resultado): void {
    this.reparados = resultado.reparados ?? [];
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.reparados = [];
  }

  cambiar(cual: 'campos' | 'anotaciones' | 'firmados', evento: Event): void {
    this[cual] = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }
}
