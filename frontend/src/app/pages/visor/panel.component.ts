
import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, Output, QueryList, SimpleChanges, ViewChildren, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DocumentoPdf } from '../../core/pdf.service';
import { densidadDePantalla } from '../../core/visor-render.service';
import { Coincidencia } from './buscador';
import { Marca, Texto } from './cambios';

export type Pestana = 'paginas' | 'indice' | 'marcas' | 'buscar';

export interface EntradaIndice {
  titulo: string;
  pagina: number;
  nivel: number;
}

/** Ancho de reserva mientras no se puede medir el sitio que ocupan. */
const ANCHO_MINIATURA = 140;

@Component({
  // Es un panel lateral: así lo anuncia un lector de pantalla y sale del "contenido sin región".
  host: { role: 'complementary', 'aria-label': 'Panel lateral' },
  selector: 'app-visor-panel',
  imports: [FormsModule],
  templateUrl: './panel.component.html',
  styleUrl: './panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisorPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) documento!: DocumentoPdf;
  @Input({ required: true }) totalPaginas = 0;
  @Input() paginaActual = 1;
  @Input() pestana: Pestana = 'paginas';
  @Input() indice: EntradaIndice[] = [];
  @Input() marcas: Marca[] = [];
  @Input() textos: Texto[] = [];
  @Input() eliminadas = new Set<number>();
  @Input() rotaciones = new Map<number, number>();
  @Input() resultados: Coincidencia[] = [];
  @Input() consulta = '';
  @Input() buscando = false;
  @Input() indexadas = 0;
  @Input() resultadoActual = -1;

  @Output() pestanaChange = new EventEmitter<Pestana>();
  @Output() consultaChange = new EventEmitter<string>();
  @Output() irAPagina = new EventEmitter<number>();
  @Output() irAResultado = new EventEmitter<number>();
  @Output() girar = new EventEmitter<number>();
  @Output() eliminar = new EventEmitter<number>();
  @Output() restaurar = new EventEmitter<number>();
  @Output() quitarMarca = new EventEmitter<string>();
  @Output() quitarTexto = new EventEmitter<string>();

  numeros: number[] = [];
  /** Miniatura de cada página, según se van necesitando. */
  readonly miniaturas = new Map<number, string>();

  @ViewChildren('celda') celdas!: QueryList<ElementRef<HTMLElement>>;

  private readonly cd = inject(ChangeDetectorRef);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private observador?: IntersectionObserver;
  private pedidas = new Set<number>();

  ngOnChanges(cambios: SimpleChanges): void {
    if (cambios['totalPaginas'] || cambios['documento']) {
      this.numeros = Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
      this.miniaturas.clear();
      this.pedidas.clear();
    }
  }

  ngAfterViewInit(): void {
    // Las miniaturas se dibujan cuando asoman por el panel, no todas de golpe:
    // en un documento de trescientas páginas la diferencia es abismal.
    this.observador = new IntersectionObserver(entradas => {
      entradas
        .filter(entrada => entrada.isIntersecting)
        .forEach(entrada => this.dibujarMiniatura(Number((entrada.target as HTMLElement).dataset['pagina'])));
    }, { root: this.elemento.nativeElement, rootMargin: '200px' });

    this.celdas.changes.subscribe(() => this.vigilarCeldas());
    this.vigilarCeldas();
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  private vigilarCeldas(): void {
    this.celdas?.forEach(celda => this.observador?.observe(celda.nativeElement));
  }

  rotacionDe(numero: number): number {
    return this.rotaciones.get(numero) ?? 0;
  }

  textoDe(marca: Marca | Texto): string {
    const texto = marca.texto.replace(/\s+/g, ' ').trim();
    return texto.length > 90 ? `${texto.slice(0, 90)}…` : texto || '(sin texto)';
  }

  /** Lo que hay anotado en total, que es lo que anuncia la pestaña. */
  get cuantasAnotaciones(): number {
    return this.marcas.length + this.textos.length;
  }

  /**
   * A cuántos píxeles hay que dibujar una miniatura.
   *
   * A los que va a ocupar de verdad, contando la densidad de la pantalla. Con
   * un ancho fijo el navegador las amplía y se ven borrosas: en el panel se
   * enseñan a unos 210 px, así que dibujarlas a 140 ya las ampliaba una vez y
   * media, y el triple en una pantalla densa.
   */
  private anchoDeMiniatura(): number {
    const hueco = this.elemento.nativeElement
      .querySelector('.miniatura__hueco, .miniatura img') as HTMLElement | null;
    const ancho = hueco?.getBoundingClientRect().width ?? 0;
    return Math.round(Math.max(ancho, ANCHO_MINIATURA) * densidadDePantalla());
  }

  private async dibujarMiniatura(numero: number): Promise<void> {
    if (!numero || this.pedidas.has(numero) || !this.documento) {
      return;
    }
    this.pedidas.add(numero);
    try {
      this.miniaturas.set(numero, await this.documento.imagen(numero, this.anchoDeMiniatura()));
      this.cd.markForCheck();
    } catch {
      this.pedidas.delete(numero); // que se pueda reintentar al volver a asomar
    }
  }
}
