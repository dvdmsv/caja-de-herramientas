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
  /** En un lote, los resultados que no llegaron, por nombre. */
  noAlcanzados: string[] = [];

  protected override readonly unoPorUno = true;

  /**
   * Lo más que baja cada PDF subido, por id. Se calcula al elegir "Hasta un
   * tamaño", para no dejar pedir uno imposible y descubrirlo después de esperar.
   */
  private readonly minimos = new Map<string, MinimoPdf>();
  calculandoMinimo = false;

  /**
   * El dato del PDF de la cola que menos baja, si ya se sabe. Con uno solo, el
   * suyo; en un lote, el que decide qué tamaño se puede pedir a todos.
   */
  get minimo(): MinimoPdf | null {
    return this.masRestrictivo?.dato ?? null;
  }

  /** Cómo nombrar ese PDF en los avisos. */
  get sujeto(): string {
    const nombre = this.masRestrictivo?.nombre;
    return this.archivos.length > 1 && nombre ? `«${nombre}», el que menos baja,` : 'Este PDF';
  }

  private get masRestrictivo(): { dato: MinimoPdf; nombre: string } | null {
    let peor: { dato: MinimoPdf; nombre: string } | null = null;
    for (const archivo of this.archivos) {
      const dato = archivo.id ? this.minimos.get(archivo.id) : undefined;
      if (dato && (!peor || dato.minimo > peor.dato.minimo)) {
        peor = { dato, nombre: archivo.file.name };
      }
    }
    return peor;
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
    return `${this.sujeto} no baja de ${this.minimoMb?.toLocaleString('es-ES')} MB: pide eso o más, ` +
      'o prueba a pasarlo a grises o a quitarle páginas.';
  }

  protected override opciones(): Record<string, unknown> {
    return {
      nivel: this.nivel,
      web: this.paraWeb,
      objetivo_mb: this.modo === 'tamano' ? this.objetivoMb : 0,
    };
  }

  override ejecutar(): void {
    this.noAlcanzado = null;
    this.noAlcanzados = [];
    super.ejecutar();
  }

  /** En un lote llega una vez por archivo: se apunta cada uno que no llegó. */
  protected override alTerminar(resultado: Resultado): void {
    if (resultado.objetivo && !resultado.objetivo.logrado) {
      this.noAlcanzado = resultado.objetivo;
      this.noAlcanzados.push(...resultado.files.map(archivo => archivo.name));
    }
  }

  protected override alTerminarSubida(): void {
    this.pedirMinimo();
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.noAlcanzado = null;
    this.noAlcanzados = [];
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

  /** El primer PDF ya subido del que aún no se sabe cuánto baja. */
  private get idSinMinimo(): string | undefined {
    return this.archivos.find(archivo => archivo.estado === 'subido' && !this.minimos.has(archivo.id!))?.id;
  }

  /**
   * Sólo en modo tamaño y una vez por archivo: cuesta una compresión entera. De
   * uno en uno, también en un lote, como se comprime.
   */
  private pedirMinimo(): void {
    const id = this.idSinMinimo;
    if (this.modo !== 'tamano' || !id || this.minimos.has(id) || this.calculandoMinimo) {
      return;
    }
    this.calculandoMinimo = true;
    this.api.minimoComprimirPdf(id).subscribe({
      next: dato => {
        this.calculandoMinimo = false;
        this.minimos.set(id, dato);
        // El siguiente del lote, o uno que se haya añadido mientras tanto.
        this.pedirMinimo();
      },
      // Es una ayuda: si falla, se comprime igual y el aviso llega después.
      error: () => (this.calculandoMinimo = false),
    });
  }
}
