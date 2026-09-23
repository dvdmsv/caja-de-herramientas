import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ObjetivoTamano, Resultado } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { PesoPipe } from '../../../shared/peso.pipe';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface OpcionNivel {
  id: string;
  nombre: string;
  detalle: string;
}

type Modo = 'nivel' | 'tamano';

/** Lo que suelen pedir las sedes electrónicas, para no tener que teclearlo. */
const TAMANOS_HABITUALES = [1, 2, 5, 10];

@Component({
  selector: 'app-comprimir-pdf',
  imports: [FormsModule, FileQueueComponent, PesoPipe, ResultListComponent, ToolControlsComponent,
            ToolPageComponent],
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

  readonly tamanosHabituales = TAMANOS_HABITUALES;

  modo: Modo = 'nivel';
  nivel = 'media';
  /** En MB, que es como lo dicen las sedes. */
  objetivoMb = 2;
  paraWeb = false;

  /** Si se pidió un tamaño y no se llegó: se avisa junto al resultado. */
  noAlcanzado: ObjetivoTamano | null = null;

  /** Un tamaño que no es un número positivo no se manda. */
  override get listo(): boolean {
    return super.listo && (this.modo === 'nivel' || this.objetivoMb > 0);
  }

  protected override opciones(): Record<string, unknown> {
    return {
      nivel: this.nivel,
      web: this.paraWeb,
      objetivo_mb: this.modo === 'tamano' ? this.objetivoMb : 0,
    };
  }

  protected override alTerminar(resultado: Resultado): void {
    this.noAlcanzado = resultado.objetivo && !resultado.objetivo.logrado ? resultado.objetivo : null;
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.noAlcanzado = null;
  }

  elegirModo(modo: Modo): void {
    this.modo = modo;
    this.alCambiarLista();
  }

  elegirNivel(id: string): void {
    this.nivel = id;
    this.alCambiarLista();
  }

  elegirTamano(mb: number): void {
    this.objetivoMb = mb;
    this.alCambiarLista();
  }

  cambiarParaWeb(evento: Event): void {
    this.paraWeb = (evento.target as HTMLInputElement).checked;
    this.alCambiarLista();
  }
}
