import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { Component, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';

import { ANCHO_MINIATURA, DocumentoPdf, PdfService } from '../../../core/pdf.service';
import { ArchivoEnCola, FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError } from '../../../shared/notify';

/** Una página del documento tal y como quedará al guardar. */
interface PaginaOrganizada {
  numero: number;
  rotacion: number;
  miniatura: string;
}

/** Rasterizar en el navegador tiene un coste; por encima de esto no compensa. */
const MAXIMO_PAGINAS = 100;

@Component({
  selector: 'app-organizar-pdf',
  imports: [DragDropModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  templateUrl: './organizar-pdf.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './organizar-pdf.component.css',
})
export class OrganizarPdfComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'organizar-pdf';
  protected override get mensajeExito(): string {
    return 'Documento organizado';
  }

  paginas: PaginaOrganizada[] = [];
  originales = 0;
  cargando = false;

  private documento: DocumentoPdf | null = null;
  private readonly pdf = inject(PdfService);

  ngOnDestroy(): void {
    this.cerrar();
  }

  get eliminadas(): number {
    return this.originales - this.paginas.length;
  }

  get hayCambios(): boolean {
    return this.eliminadas > 0
      || this.paginas.some((pagina, indice) => pagina.numero !== indice + 1 || pagina.rotacion !== 0);
  }

  alAgregarDocumento(nuevos: ArchivoEnCola[]): void {
    this.alAgregar(nuevos);
    if (nuevos[0]) {
      this.abrir(nuevos[0].file);
    }
  }

  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (this.archivos.length === 0) {
      this.cerrar();
    }
  }

  private async abrir(archivo: File): Promise<void> {
    this.cerrar();
    this.cargando = true;
    try {
      this.documento = await this.pdf.abrir(archivo);
      this.originales = this.documento.paginas;
      if (this.originales > MAXIMO_PAGINAS) {
        avisoError(`El documento tiene ${this.originales} páginas y aquí se pueden organizar hasta `
          + `${MAXIMO_PAGINAS}. Para uno tan largo, usa "Dividir PDF".`);
        this.cerrar();
        return;
      }
      this.paginas = Array.from({ length: this.originales }, (_, i) => ({
        numero: i + 1,
        rotacion: 0,
        miniatura: '',
      }));
      for (const pagina of this.paginas) {
        pagina.miniatura = await this.documento.imagen(pagina.numero, ANCHO_MINIATURA);
      }
    } catch (err) {
      console.error('pdf.js no ha podido abrir el documento:', err);
      avisoError('No se ha podido leer el PDF. Puede estar dañado o protegido con contraseña.');
      this.cerrar();
    } finally {
      this.cargando = false;
    }
  }

  // --- edición ----------------------------------------------------------

  reordenar(evento: CdkDragDrop<PaginaOrganizada[]>): void {
    moveItemInArray(this.paginas, evento.previousIndex, evento.currentIndex);
    this.alCambiarLista();
  }

  girar(pagina: PaginaOrganizada): void {
    pagina.rotacion = (pagina.rotacion + 90) % 360;
    this.alCambiarLista();
  }

  quitar(indice: number): void {
    this.paginas.splice(indice, 1);
    this.alCambiarLista();
  }

  restablecer(): void {
    this.paginas = Array.from({ length: this.originales }, (_, i) => ({
      numero: i + 1,
      rotacion: 0,
      miniatura: this.paginas.find(p => p.numero === i + 1)?.miniatura ?? '',
    }));
    this.alCambiarLista();
  }

  // --- ejecución --------------------------------------------------------

  override get listo(): boolean {
    return super.listo && this.paginas.length > 0 && this.hayCambios;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (this.paginas.length === 0) {
      return 'Cargando las páginas…';
    }
    return this.hayCambios ? null : 'Mueve, gira o quita alguna página para poder guardar.';
  }

  protected override opciones(): Record<string, unknown> {
    return {
      paginas: this.paginas.map(({ numero, rotacion }) => ({ numero, rotacion })),
    };
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.cerrar();
  }

  private cerrar(): void {
    this.documento?.cerrar();
    this.documento = null;
    this.paginas = [];
    this.originales = 0;
  }
}
