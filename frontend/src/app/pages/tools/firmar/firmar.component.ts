
import { Component, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DocumentoPdf, PdfService } from '../../../core/pdf.service';
import { ArchivoEnCola, FileQueueComponent, aCola } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';
import { COLOCACION_INICIAL, Colocacion } from '../../../shared/firma/colocacion';
import { LienzoFirmaComponent } from '../../../shared/firma/lienzo-firma.component';
import { PizarraComponent } from '../../../shared/firma/pizarra.component';

/** Espera antes de repreparar la firma mientras se mueve el umbral. */
const ESPERA_UMBRAL = 350;

@Component({
  selector: 'app-firmar',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
    LienzoFirmaComponent,
    PizarraComponent
],
  templateUrl: './firmar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './firmar.component.css',
})
export class FirmarComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'firmar';
  protected override get mensajeExito(): string {
    return 'Documento firmado';
  }

  /** Cola propia: la heredada `archivos` lleva el documento. */
  firmas: ArchivoEnCola[] = [];
  modoFirma: 'subir' | 'dibujar' = 'subir';

  colocacion: Colocacion = { ...COLOCACION_INICIAL };
  paginas = 0;
  paginaActual = 1;
  /** Se calcula al abrir el documento: un getter daría un array nuevo cada vez. */
  numerosDePagina: number[] = [];
  todas = false;
  quitarFondo = true;
  umbral = 240;

  /** Página del documento y firma ya procesada, como URL para los `<img>`. */
  fondo = '';
  firmaPreparada = '';
  preparando = false;

  private documento: DocumentoPdf | null = null;
  private temporizador?: ReturnType<typeof setTimeout>;
  private readonly pdf = inject(PdfService);

  ngOnDestroy(): void {
    this.olvidarFondo();
    this.olvidarFirma();
    this.cerrarPdf();
    clearTimeout(this.temporizador);
  }

  // --- documento --------------------------------------------------------

  alAgregarDocumento(nuevos: ArchivoEnCola[]): void {
    this.alAgregar(nuevos);
    const archivo = nuevos[0]?.file;
    if (archivo) {
      this.abrirDocumento(archivo);
    }
  }

  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (this.archivos.length === 0) {
      this.olvidarFondo();
      this.cerrarPdf();
      this.contarPaginas(0);
    }
  }

  /** El documento se previsualiza desde el archivo local, sin esperar al servidor. */
  private async abrirDocumento(archivo: File): Promise<void> {
    this.olvidarFondo();
    this.cerrarPdf();
    this.colocacion = { ...COLOCACION_INICIAL };

    if (!archivo.name.toLowerCase().endsWith('.pdf')) {
      this.contarPaginas(1);
      this.fondo = URL.createObjectURL(archivo);
      return;
    }

    try {
      this.documento = await this.pdf.abrir(archivo);
      // Se empieza por la última página, que es donde se firma casi siempre.
      this.contarPaginas(this.documento.paginas);
      await this.renderizar();
    } catch (err) {
      // El motivo real es valiosísimo para diagnosticar (un worker que no
      // carga, un PDF con contraseña, un archivo corrupto): no se esconde.
      console.error('pdf.js no ha podido abrir el documento:', err);
      avisoError(this.porQueNoAbre(err));
    }
  }

  private contarPaginas(total: number): void {
    this.paginas = total;
    this.paginaActual = Math.max(1, total);
    this.numerosDePagina = Array.from({ length: total }, (_, i) => i + 1);
  }

  private porQueNoAbre(err: unknown): string {
    const fallo = err as { name?: string; message?: string };
    if (fallo?.name === 'PasswordException') {
      return 'El PDF está protegido con contraseña.';
    }
    if (fallo?.name === 'InvalidPDFException') {
      return 'El archivo no es un PDF válido o está dañado.';
    }
    const detalle = fallo?.message ? ` (${fallo.message})` : '';
    return `No se ha podido preparar la vista previa del PDF${detalle}. Mira la consola del navegador para el detalle.`;
  }

  async cambiarPagina(numero: number): Promise<void> {
    this.paginaActual = Number(numero);
    this.alCambiarLista();
    await this.renderizar();
  }

  private async renderizar(): Promise<void> {
    if (this.documento) {
      this.fondo = await this.documento.imagen(this.paginaActual);
    }
  }

  // --- firma ------------------------------------------------------------

  alAgregarFirma(nuevos: ArchivoEnCola[]): void {
    this.olvidarResultadoDeFirma();
    this.subir(nuevos, () => this.prepararFirma());
  }

  alQuitarFirma(): void {
    this.olvidarResultadoDeFirma();
    if (this.firmas.length === 0) {
      this.olvidarFirma();
    }
  }

  /** La firma dibujada entra por el mismo camino que una subida. */
  alDibujar(archivo: File): void {
    this.firmas.length = 0;
    const nuevos = aCola([archivo]);
    this.firmas.push(...nuevos);
    // Un trazo dibujado ya es transparente: no hay fondo que recortar.
    this.quitarFondo = false;
    this.alAgregarFirma(nuevos);
  }

  alCambiarFondo(): void {
    this.alCambiarLista();
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.prepararFirma(), ESPERA_UMBRAL);
  }

  private prepararFirma(): void {
    const id = this.firmas[0]?.id;
    if (!id) {
      return;
    }
    this.preparando = true;
    this.api.prepararFirma(id, this.quitarFondo, this.umbral).subscribe({
      next: url => {
        this.preparando = false;
        this.olvidarFirma();
        this.firmaPreparada = url;
      },
      error: err => {
        this.preparando = false;
        avisoError(mensajeDeError(err, 'No se ha podido preparar la firma.'));
      },
    });
  }

  // --- ejecución --------------------------------------------------------

  override get listo(): boolean {
    return super.listo && !!this.firmas[0]?.id && !!this.firmaPreparada;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (!this.firmas[0]?.id) {
      return 'Añade tu firma: dibújala o sube una foto de ella.';
    }
    return this.firmaPreparada ? null : 'Preparando la firma…';
  }

  protected override opciones(): Record<string, unknown> {
    return {
      firma_id: this.firmas[0]?.id,
      x: this.colocacion.x,
      y: this.colocacion.y,
      ancho: this.colocacion.ancho,
      rotacion: this.colocacion.rotacion,
      pagina: this.paginaActual,
      todas: this.todas,
      quitar_fondo: this.quitarFondo,
      umbral: this.umbral,
    };
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.firmas = [];
    this.contarPaginas(0);
    this.cerrarPdf();
    this.olvidarFondo();
    this.olvidarFirma();
  }

  centrar(): void {
    this.colocacion = { ...COLOCACION_INICIAL };
    this.alCambiarLista();
  }

  private olvidarResultadoDeFirma(): void {
    this.alCambiarLista();
  }

  private cerrarPdf(): void {
    this.documento?.cerrar();
    this.documento = null;
  }

  private olvidarFondo(): void {
    if (this.fondo.startsWith('blob:')) {
      URL.revokeObjectURL(this.fondo);
    }
    this.fondo = '';
  }

  private olvidarFirma(): void {
    if (this.firmaPreparada) {
      URL.revokeObjectURL(this.firmaPreparada);
      this.firmaPreparada = '';
    }
  }
}
