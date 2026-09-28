import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { DatosDelLibro } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

/**
 * PDF a EPUB. Nada más subir el PDF se pregunta su título, su autor y si tiene
 * texto: así el formulario sale relleno y, si es un escaneado, se dice antes de
 * esperar a una conversión que no puede salir.
 */
@Component({
  selector: 'app-pdf-a-epub',
  imports: [FormsModule, RouterLink, FileQueueComponent, ResultListComponent, ToolControlsComponent,
    ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './pdf-a-epub.component.html',
})
export class PdfAEpubComponent extends PaginaHerramienta {
  protected readonly slug = 'pdf-a-epub';
  protected override get mensajeExito(): string {
    return 'Libro creado';
  }

  titulo = '';
  autor = '';
  portada = true;
  /** Lo que ha dicho el servidor del PDF; `null` mientras no se sabe. */
  datos: DatosDelLibro | null = null;
  leyendo = false;

  get escaneado(): boolean {
    return this.datos?.con_texto === false;
  }

  override get listo(): boolean {
    return super.listo && !this.leyendo && !this.escaneado;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (this.leyendo) {
      return 'Leyendo el PDF…';
    }
    return this.escaneado ? 'Este PDF es un escaneado: pásalo antes por «PDF con OCR».' : null;
  }

  protected override opciones(): Record<string, unknown> {
    return { titulo: this.titulo.trim(), autor: this.autor.trim(), portada: this.portada };
  }

  /** En cuanto está arriba, lo que se sabe de él rellena el formulario. */
  protected override alTerminarSubida(): void {
    const id = this.archivos.find(archivo => archivo.estado === 'subido')?.id;
    if (!id) {
      return;
    }
    this.leyendo = true;
    this.api.datosDelLibro(id).subscribe({
      next: datos => {
        this.leyendo = false;
        this.datos = datos;
        this.titulo = datos.titulo;
        this.autor = datos.autor;
      },
      // Si falla, se convierte igual: el servidor pone el título que pueda.
      error: () => (this.leyendo = false),
    });
  }

  protected override alReiniciar(): void {
    this.titulo = '';
    this.autor = '';
    this.datos = null;
    this.leyendo = false;
  }

  override alCambiarLista(): void {
    super.alCambiarLista();
    if (this.archivos.length === 0) {
      this.alReiniciar();
    }
  }
}
