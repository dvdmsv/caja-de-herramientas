import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MinimoPdf, ObjetivoTamano, Resultado } from '../../../core/api.service';
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

const MB = 1024 * 1024;

/** Si comprimir no gana ni esto, se dice que el PDF ya no se puede aligerar. */
const MEJORA_APRECIABLE = 0.1;

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

  /**
   * Lo más que baja cada PDF subido, por id. Se calcula al elegir "Hasta un
   * tamaño", para no dejar pedir uno imposible y descubrirlo después de esperar.
   */
  private readonly minimos = new Map<string, MinimoPdf>();
  calculandoMinimo = false;

  /** El dato del PDF que hay ahora en la cola, si ya se sabe. */
  get minimo(): MinimoPdf | null {
    const id = this.idActual;
    return id ? this.minimos.get(id) ?? null : null;
  }

  /**
   * El mínimo en MB redondeado **hacia arriba** a la décima, que es lo que se
   * puede escribir en el campo: decir «2,8» de algo que pesa 2,83 dejaría
   * pedir justo lo que no cabe.
   */
  get minimoMb(): number | null {
    return this.minimo ? Math.ceil((this.minimo.minimo / MB) * 10) / 10 : null;
  }

  /** Comprimir casi no lo aligera: el peso es texto y fuentes, no imágenes. */
  get sinMargen(): boolean {
    const dato = this.minimo;
    return !!dato && dato.minimo >= dato.original * (1 - MEJORA_APRECIABLE);
  }

  /** Lo pedido no cabe ni con la compresión más fuerte. */
  get imposible(): boolean {
    return this.modo === 'tamano' && !!this.minimo && this.objetivoMb * MB < this.minimo.minimo;
  }

  inalcanzable(mb: number): boolean {
    return !!this.minimo && mb * MB < this.minimo.minimo;
  }

  override get listo(): boolean {
    return super.listo && (this.modo === 'nivel' || (this.objetivoMb > 0 && !this.imposible));
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || !this.imposible) {
      return super.motivoBloqueo;
    }
    return `Este PDF no baja de ${this.minimoMb?.toLocaleString('es-ES')} MB: pide eso o más, ` +
      'o prueba a pasarlo a grises o a quitarle páginas.';
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

  protected override alTerminarSubida(): void {
    this.pedirMinimo();
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.noAlcanzado = null;
    this.minimos.clear();
    this.calculandoMinimo = false;
  }

  elegirModo(modo: Modo): void {
    this.modo = modo;
    this.alCambiarLista();
    this.pedirMinimo();
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

  private get idActual(): string | undefined {
    const archivo = this.archivos[0];
    return archivo?.estado === 'subido' ? archivo.id : undefined;
  }

  /** Sólo en modo tamaño y una vez por archivo: cuesta una compresión entera. */
  private pedirMinimo(): void {
    const id = this.idActual;
    if (this.modo !== 'tamano' || !id || this.minimos.has(id) || this.calculandoMinimo) {
      return;
    }
    this.calculandoMinimo = true;
    this.api.minimoComprimirPdf(id).subscribe({
      next: dato => {
        this.calculandoMinimo = false;
        this.minimos.set(id, dato);
        // Si mientras tanto se cambió de archivo, el nuevo también lo necesita.
        this.pedirMinimo();
      },
      // Es una ayuda: si falla, se comprime igual y el aviso llega después.
      error: () => (this.calculandoMinimo = false),
    });
  }
}
