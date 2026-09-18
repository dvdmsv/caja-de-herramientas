import { Component, ChangeDetectionStrategy } from '@angular/core';

import { Resultado, ResumenComparacion } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

@Component({
  selector: 'app-comparar-pdf',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './comparar-pdf.component.html',
})
export class CompararPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'comparar-pdf';
  protected override readonly minimoArchivos = 2;
  protected override get mensajeExito(): string {
    return 'Informe listo';
  }

  conImagenes = true;

  /** El recuento que manda el servidor, para contarlo sin abrir el informe. */
  comparacion: ResumenComparacion | null = null;

  /** Se comparan dos documentos: con tres no se sabe cuál es el nuevo. */
  override get listo(): boolean {
    return super.listo && this.archivos.length === 2;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo) {
      return super.motivoBloqueo;
    }
    return this.archivos.length > 2 ? 'Deja sólo dos documentos: el de antes y el nuevo.' : null;
  }

  get antes(): string | null {
    return this.archivos[0]?.file.name ?? null;
  }

  get despues(): string | null {
    return this.archivos[1]?.file.name ?? null;
  }

  protected override opciones(): Record<string, unknown> {
    return { imagenes: this.conImagenes };
  }

  protected override alTerminar(resultado: Resultado): void {
    this.comparacion = resultado.comparacion ?? null;
  }

  cambiarImagenes(evento: Event): void {
    this.conImagenes = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }

  alCambiarArchivos(): void {
    this.alCambiarLista();
    this.comparacion = null;
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.comparacion = null;
  }
}
