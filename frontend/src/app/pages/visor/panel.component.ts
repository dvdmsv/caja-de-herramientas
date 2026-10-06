
import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, Output, QueryList, SimpleChanges, ViewChildren, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdjuntoPdf, CapaPdf, DocumentoPdf, ExistentePdf } from '../../core/pdf.service';
import { densidadDePantalla } from '../../core/visor-render.service';
import { Coincidencia, OpcionesBusqueda } from './buscador';
import { Propiedad } from './documento-info';
import { Anotacion, Existente, Marca, Texto } from './cambios';
import { nombreDeAnotacion } from './documento-info';
import { DestinoPdf } from './enlaces';

export type Pestana = 'paginas' | 'indice' | 'marcas' | 'buscar' | 'documento';

export interface EntradaIndice extends DestinoPdf {
  titulo: string;
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
  @Input() opcionesBusqueda: OpcionesBusqueda = {};
  /** Lo que se cuenta en «Documento». */
  @Input() propiedades: Propiedad[] = [];
  @Input() capas: CapaPdf[] = [];
  @Input() adjuntos: AdjuntoPdf[] = [];
  @Output() verCapa = new EventEmitter<{ id: string; visible: boolean }>();
  /** Notas, dibujos, formas, sellos y firmas puestos en el visor. */
  @Input() anotaciones: Anotacion[] = [];
  /** Las que traía el documento; `null` mientras no se han leído. */
  @Input() existentes: ExistentePdf[] | null = null;
  @Input() borradas: ReadonlyMap<string, Existente> = new Map();
  @Output() quitarAnotacion = new EventEmitter<string>();
  @Output() borrarExistente = new EventEmitter<ExistentePdf>();
  @Output() recuperarExistente = new EventEmitter<string>();
  /** Se piden al abrir la pestaña: leerlas es recorrer el documento entero. */
  @Output() pedirExistentes = new EventEmitter<void>();

  readonly nombreDeAnotacion = nombreDeAnotacion;
  readonly iconos: Record<Anotacion['tipo'], string> = {
    nota: 'bi-sticky', trazo: 'bi-pencil', forma: 'bi-bounding-box-circles', sello: 'bi-patch-check',
    imagen: 'bi-pen',
  };
  @Output() descargarAdjunto = new EventEmitter<AdjuntoPdf>();

  @Output() pestanaChange = new EventEmitter<Pestana>();
  @Output() consultaChange = new EventEmitter<string>();
  @Output() opcionesBusquedaChange = new EventEmitter<OpcionesBusqueda>();
  @Output() irAPagina = new EventEmitter<number>();
  @Output() irADestino = new EventEmitter<DestinoPdf>();
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
    if ((cambios['pestana'] || cambios['existentes']) && this.pestana === 'marcas' && !this.existentes) {
      // Después de este ciclo: emitir dentro de ngOnChanges cambiaría al padre a medio pintar.
      queueMicrotask(() => this.pedirExistentes.emit());
    }
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

  textoDe(marca: { texto: string }): string {
    const texto = marca.texto.replace(/\s+/g, ' ').trim();
    return texto.length > 90 ? `${texto.slice(0, 90)}…` : texto || '(sin texto)';
  }

  /** Lo que hay anotado en total, que es lo que anuncia la pestaña. */
  get cuantasAnotaciones(): number {
    return this.marcas.length + this.textos.length + this.anotaciones.length;
  }

  /** Cómo se resume una anotación en la lista. */
  resumen(anotacion: Anotacion): string {
    switch (anotacion.tipo) {
      case 'nota':
        return anotacion.texto.trim() || 'Nota vacía';
      case 'sello':
        return `Sello «${anotacion.texto}»`;
      case 'imagen':
        return 'Firma';
      case 'forma':
        return { rectangulo: 'Rectángulo', elipse: 'Elipse', linea: 'Línea', flecha: 'Flecha' }[anotacion.figura];
      default:
        return 'Dibujo a mano';
    }
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
