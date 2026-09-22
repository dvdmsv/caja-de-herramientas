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

/**
 * A partir de aquí no se pintan miniaturas.
 *
 * No es un tope de la herramienta: organizar un documento de mil páginas es
 * gratis —el backend sólo hace un `select`— y lo que cuesta es rasterizar en el
 * navegador, una a una. Antes esto era un rechazo que **impedía abrir** el
 * documento, y dejaba sin herramienta justo a quien más falta le hace. Ahora se
 * organiza igual, por número de página, y lo único que se pierde es la imagen.
 *
 * Es el mismo trato que ya hace "Dividir PDF" con `MAXIMO_MINIATURAS`.
 */
const MAXIMO_MINIATURAS = 200;

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
  /** Si se están rellenando las miniaturas por detrás, con la lista ya usable. */
  pintando = false;
  /** Si el documento es tan largo que no se pintan. */
  demasiadasParaVerlas = false;

  private documento: DocumentoPdf | null = null;
  /**
   * Qué documento está abierto. Pintar miniaturas es un bucle con `await`, y sin
   * esto seguiría rellenando la lista de un documento que ya se ha cerrado.
   */
  private generacion = 0;
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
    const mia = ++this.generacion;
    try {
      this.documento = await this.pdf.abrir(archivo);
      this.originales = this.documento.paginas;
      this.paginas = Array.from({ length: this.originales }, (_, i) => ({
        numero: i + 1,
        rotacion: 0,
        miniatura: '',
      }));
      this.demasiadasParaVerlas = this.originales > MAXIMO_MINIATURAS;
    } catch (err) {
      console.error('pdf.js no ha podido abrir el documento:', err);
      avisoError('No se ha podido leer el PDF. Puede estar dañado o protegido con contraseña.');
      this.cerrar();
      return;
    } finally {
      // La lista ya se puede usar: se puede reordenar, girar y borrar por
      // número. Las imágenes son una comodidad y llegan detrás.
      this.cargando = false;
    }
    if (!this.demasiadasParaVerlas) {
      await this.pintarMiniaturas(mia);
    }
  }

  /** Rellena las miniaturas con la lista ya en pantalla. */
  private async pintarMiniaturas(mia: number): Promise<void> {
    this.pintando = true;
    try {
      for (const pagina of this.paginas) {
        if (mia !== this.generacion || !this.documento) {
          return;  // se ha cerrado o se ha abierto otro documento
        }
        pagina.miniatura = await this.documento.imagen(pagina.numero, ANCHO_MINIATURA);
      }
    } catch (err) {
      // Quedarse sin miniaturas no impide organizar: se sigue por número.
      console.warn('No se han podido pintar todas las miniaturas:', err);
    } finally {
      if (mia === this.generacion) {
        this.pintando = false;
      }
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
    // Invalida el bucle de miniaturas que pueda estar en marcha.
    this.generacion++;
    this.documento?.cerrar();
    this.documento = null;
    this.paginas = [];
    this.originales = 0;
    this.pintando = false;
    this.demasiadasParaVerlas = false;
  }
}
