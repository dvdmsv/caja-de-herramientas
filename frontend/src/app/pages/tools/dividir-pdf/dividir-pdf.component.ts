
import { Component, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ANCHO_MINIATURA, DocumentoPdf, PdfService } from '../../../core/pdf.service';
import { ArchivoEnCola, FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError } from '../../../shared/notify';
import { comprimirRangos, expandirRangos } from '../../../shared/rangos';

/**
 * A partir de aquí no se pintan miniaturas: rasterizar cientos de páginas en el
 * navegador tarda y no aporta: con un documento así se escriben los rangos.
 */
const MAXIMO_MINIATURAS = 60;

@Component({
  selector: 'app-dividir-pdf',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  templateUrl: './dividir-pdf.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './dividir-pdf.component.css',
})
export class DividirPdfComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'dividir-pdf';
  protected override get mensajeExito(): string {
    return 'Páginas extraídas';
  }

  paginas = 0;
  /** Imagen de cada página, en el índice de su número menos uno. */
  miniaturas: string[] = [];
  seleccion = new Set<number>();
  rangos = '';
  modo: 'unico' | 'por-pagina' = 'unico';
  cargando = false;
  demasiadasParaVerlas = false;

  private documento: DocumentoPdf | null = null;
  private readonly pdf = inject(PdfService);

  ngOnDestroy(): void {
    this.cerrar();
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
      this.paginas = this.documento.paginas;
      this.marcarTodas();
      this.demasiadasParaVerlas = this.paginas > MAXIMO_MINIATURAS;
      if (!this.demasiadasParaVerlas) {
        // Se van pintando conforme salen, para no dejar la pantalla en blanco.
        this.miniaturas = new Array(this.paginas).fill('');
        for (let numero = 1; numero <= this.paginas; numero++) {
          this.miniaturas[numero - 1] = await this.documento.imagen(numero, ANCHO_MINIATURA);
        }
      }
    } catch (err) {
      console.error('pdf.js no ha podido abrir el documento:', err);
      avisoError('No se ha podido leer el PDF. Puede estar dañado o protegido con contraseña.');
      this.cerrar();
    } finally {
      this.cargando = false;
    }
  }

  // --- selección --------------------------------------------------------

  alternar(numero: number): void {
    if (this.seleccion.has(numero)) {
      this.seleccion.delete(numero);
    } else {
      this.seleccion.add(numero);
    }
    this.sincronizarTexto();
  }

  /** Lo que se escribe manda sobre las miniaturas, y al revés. */
  alEscribirRangos(): void {
    this.seleccion = new Set(expandirRangos(this.rangos, this.paginas));
    this.alCambiarLista();
  }

  marcarTodas(): void {
    this.seleccion = new Set(Array.from({ length: this.paginas }, (_, i) => i + 1));
    this.sincronizarTexto();
  }

  marcarNinguna(): void {
    this.seleccion.clear();
    this.sincronizarTexto();
  }

  private sincronizarTexto(): void {
    this.rangos = comprimirRangos([...this.seleccion]);
    this.alCambiarLista();
  }

  // --- ejecución --------------------------------------------------------

  override get listo(): boolean {
    return super.listo && this.seleccion.size > 0;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    return this.seleccion.size > 0 ? null : 'Elige al menos una página.';
  }

  protected override opciones(): Record<string, unknown> {
    return { paginas: this.rangos, modo: this.modo };
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.cerrar();
  }

  private cerrar(): void {
    this.documento?.cerrar();
    this.documento = null;
    this.paginas = 0;
    this.miniaturas = [];
    this.seleccion.clear();
    this.rangos = '';
    this.demasiadasParaVerlas = false;
  }
}
