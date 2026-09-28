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
 * EPUB a PDF. Un EPUB no tiene páginas: el texto se corta donde toque según el
 * tamaño de la hoja y de la letra, y por eso son las dos opciones. Los valores
 * de serie (A5 y la letra del libro) sirven para un clic.
 */
@Component({
  selector: 'app-epub-a-pdf',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './epub-a-pdf.component.html',
})
export class EpubAPdfComponent extends PaginaHerramienta {
  protected readonly slug = 'epub-a-pdf';
  protected override readonly unoPorUno = true;
  protected override get mensajeExito(): string {
    return 'Libro convertido';
  }

  readonly tamanos: Opcion[] = [
    { id: 'a5', nombre: 'Libro', detalle: 'A5 · como un libro de bolsillo' },
    { id: 'a4', nombre: 'Folio', detalle: 'A4 · para imprimir' },
    { id: 'lector', nombre: 'Lector', detalle: 'Pantalla de 6″ · para leer en un ebook' },
  ];
  readonly letras: Opcion[] = [
    { id: 'pequena', nombre: 'Pequeña', detalle: 'Más texto en cada página' },
    { id: 'normal', nombre: 'La del libro', detalle: 'La que marca el EPUB' },
    { id: 'grande', nombre: 'Grande', detalle: 'Más cómoda de leer' },
  ];

  tamano = 'a5';
  letra = 'normal';

  protected override opciones(): Record<string, unknown> {
    return { pagina: this.tamano, letra: this.letra };
  }
}
