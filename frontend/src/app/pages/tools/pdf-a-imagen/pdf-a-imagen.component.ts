
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FormatoImagen } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';

interface OpcionResolucion {
  id: string;
  nombre: string;
  detalle: string;
}

@Component({
  selector: 'app-pdf-a-imagen',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent
],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './pdf-a-imagen.component.html',
})
export class PdfAImagenComponent extends PaginaHerramienta implements OnInit {
  protected readonly slug = 'pdf-a-imagen';
  protected override get mensajeExito(): string {
    return 'Páginas convertidas';
  }

  readonly resoluciones: OpcionResolucion[] = [
    { id: 'pantalla', nombre: 'Pantalla', detalle: '96 ppp · archivos ligeros' },
    { id: 'normal', nombre: 'Normal', detalle: '150 ppp · uso general' },
    { id: 'alta', nombre: 'Alta', detalle: '300 ppp · calidad de impresión' },
  ];

  /** Los formatos los decide el servidor: sólo ofrece los que puede escribir. */
  formatos: FormatoImagen[] = [];
  formato = 'JPEG';
  resolucion = 'normal';
  calidad = 90;

  ngOnInit(): void {
    this.api.formatosDeImagen(this.slug).subscribe({
      next: formatos => {
        this.formatos = formatos;
        if (!formatos.some(f => f.id === this.formato)) {
          this.formato = formatos[0]?.id ?? '';
        }
      },
      error: err => avisoError(mensajeDeError(err, 'No se han podido cargar los formatos.')),
    });
  }

  /** El ajuste de calidad sólo tiene sentido en los formatos con pérdida. */
  get admiteCalidad(): boolean {
    return this.formatos.find(f => f.id === this.formato)?.calidad ?? false;
  }

  /** Nombre del formato elegido, para el botón y el ZIP. */
  get etiquetaFormato(): string {
    return this.formatos.find(f => f.id === this.formato)?.nombre ?? 'imagen';
  }

  get nombreZip(): string {
    return `paginas-en-${this.etiquetaFormato.toLowerCase()}.zip`;
  }

  override get listo(): boolean {
    return super.listo && this.formato !== '';
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    return this.formato ? null : 'Elige el formato de salida.';
  }

  protected override opciones(): Record<string, unknown> {
    return { resolucion: this.resolucion, formato: this.formato, calidad: this.calidad };
  }

  /** Al cambiar la resolución el resultado anterior deja de valer. */
  elegirResolucion(id: string): void {
    this.resolucion = id;
    this.alCambiarLista();
  }
}
