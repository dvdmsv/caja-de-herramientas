import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener,
  Input, OnChanges, Output, inject,
} from '@angular/core';

import { ExistentePdf } from '../../core/pdf.service';
import { Recorte, Tirador, redimensionar } from '../../shared/recuadro/recorte';
import {
  Anotacion, AnotacionNueva, CambioDeAnotacion, Existente, Figura, Punto,
} from './cambios';
import { Rect, aPorcentajes, puntoAPorcentajes, puntoAProporciones } from './coordenadas';
import {
  LETRA_DEL_SELLO, camino, fechaDeSello, puntaDeFlecha, simplificar, tamanoDeSello,
  tamanoSinGirar, transformacionDeGiro,
} from './dibujo';
import { nombreDeAnotacion } from './documento-info';
import { PaginaColocada } from './disposicion';
import { COLORES_CSS, COLORES_TEXTO, ColorTexto } from './tipografia';

/** Las herramientas que dibujan en esta capa. */
export type HerramientaDibujo = 'nota' | 'dibujar' | 'forma' | 'sello' | 'firma';

/** Con qué sale lo próximo que se dibuje. */
export interface EstiloDibujo {
  color: ColorTexto;
  /** En puntos PDF. */
  grosor: number;
  figura: Figura;
  sello: string;
  selloConFecha: boolean;
}

/** Una firma lista para colocar: la imagen y su proporción ancho/alto. */
export interface FirmaPendiente {
  datos: string;
  relacion: number;
}

/** Lo que emite al crear: todo menos la página, que la pone quien la escucha. */
export type Creada = AnotacionNueva extends infer T ? T extends unknown ? Omit<T, 'pagina'> : never : never;

/** Por debajo de esto, en proporción de la página, una forma es un clic sin querer. */
const FORMA_MINIMA = 0.004;

/** Tolerancia de la simplificación, en proporción de la página (un par de píxeles). */
const TOLERANCIA_TRAZO = 0.0015;

/** Cuánto hay que mover antes de que pulsar una nota cuente como arrastrarla. */
const UMBRAL_ARRASTRE = 4;

interface Gesto {
  id: string | null;
  /** `dibujo` y `forma` crean; `mover`, los tiradores y `nota` cambian una que ya está. */
  modo: 'dibujo' | 'forma' | 'nota' | Tirador;
  inicio: Punto;
  puntero: { x: number; y: number };
  movido: boolean;
  /** Lo que ocupaba al empezar, para moverlo o redimensionarlo. */
  recorte?: Recorte;
  /** Una imagen no se deforma al redimensionarla; un sello, sí puede. */
  proporcion?: number | null;
  puntos?: Punto[];
  hasta?: Punto;
}

/**
 * Notas, dibujo a mano, formas, sellos y firmas de una página: se pintan aquí y
 * se crean, se mueven y se redimensionan aquí. El visor sólo guarda lo que esta
 * capa le cuenta, y lo deshace o lo rehace.
 *
 * Todo se pinta en un SVG en el espacio de la página **sin el giro del
 * usuario** y se gira el conjunto (`dibujo.ts`); el puntero se lleva a ese
 * espacio con `puntoAProporciones`, el mismo que usan las marcas. Así no hay
 * una conversión distinta para cada forma.
 *
 * Con una herramienta activa la capa se queda con el puntero entero —también el
 * dedo: `touch-action: none`—, porque si no, en un móvil dibujar desplazaría la
 * página. Para moverse por el documento se vuelve a «Leer».
 */
@Component({
  selector: 'app-visor-dibujos',
  templateUrl: './capa-dibujo.component.html',
  styleUrl: './capa-dibujo.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.activa]': '!!herramienta',
    '[class.dibujando]': "herramienta === 'dibujar' || herramienta === 'forma'",
  },
})
export class VisorDibujosComponent implements OnChanges {
  @Input({ required: true }) colocada!: PaginaColocada;
  @Input({ required: true }) escala!: number;
  @Input() anotaciones: Anotacion[] = [];
  @Input() existentes: ExistentePdf[] = [];
  @Input() borradas: ReadonlyMap<string, Existente> = new Map();
  @Input() herramienta: HerramientaDibujo | null = null;
  @Input() estilo: EstiloDibujo = {
    color: 'rojo', grosor: 2, figura: 'rectangulo', sello: 'APROBADO', selloConFecha: true,
  };
  @Input() firma: FirmaPendiente | null = null;
  @Input() seleccionada: string | null = null;

  @Output() creada = new EventEmitter<Creada>();
  @Output() cambiada = new EventEmitter<{ id: string; cambio: CambioDeAnotacion }>();
  @Output() quitada = new EventEmitter<string>();
  @Output() seleccionar = new EventEmitter<string | null>();
  @Output() borrarExistente = new EventEmitter<ExistentePdf>();
  @Output() recuperarExistente = new EventEmitter<string>();

  readonly tintas = COLORES_TEXTO;
  readonly css = COLORES_CSS;
  readonly letraDelSello = LETRA_DEL_SELLO;
  readonly nombreDeAnotacion = nombreDeAnotacion;
  readonly tiradores: Tirador[] = ['nw', 'ne', 'se', 'sw'];

  /** Medidas de lo que se ve y de la página sin girar, en píxeles. */
  ancho = 0;
  alto = 0;
  anchoSinGirar = 0;
  altoSinGirar = 0;
  giro = '';
  /** La nota del PDF que se está leyendo, si se ha pulsado una. */
  leyendo: ExistentePdf | null = null;

  private gesto: Gesto | null = null;
  /** Lo que se está moviendo o redimensionando, mientras dura el gesto. */
  provisional: { id: string; recorte?: Recorte; punto?: Punto } | null = null;

  private readonly cd = inject(ChangeDetectorRef);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);

  ngOnChanges(): void {
    this.ancho = this.colocada.ancho;
    this.alto = this.colocada.alto;
    [this.anchoSinGirar, this.altoSinGirar] = tamanoSinGirar(this.colocada.rotacion, this.ancho,
                                                             this.alto);
    this.giro = transformacionDeGiro(this.colocada.rotacion, this.ancho, this.alto);
    if (this.leyendo && !this.existentes.includes(this.leyendo)) {
      this.leyendo = null;
    }
  }

  // --- lo que se pinta ------------------------------------------------------

  /** Un rectángulo en proporciones, en píxeles de la página sin girar. */
  px([x0, y0, x1, y1]: Rect): { x: number; y: number; w: number; h: number } {
    return { x: x0 * this.anchoSinGirar, y: y0 * this.altoSinGirar,
             w: (x1 - x0) * this.anchoSinGirar, h: (y1 - y0) * this.altoSinGirar };
  }

  /**
   * Lo que hace falta para pintar derecho un sello o una imagen puestos con la
   * página girada `rotacion`: su caja va en el espacio sin girar, y lo de dentro
   * se gira al revés sobre su centro, con el ancho y el alto cambiados.
   */
  derecho(anotacion: Anotacion & { rect: Rect; rotacion?: number }) {
    const { x, y, w, h } = this.px(this.rectDe(anotacion));
    const giro = anotacion.rotacion ?? 0;
    const cruzado = Math.abs(giro % 180) === 90;
    const [ancho, alto] = cruzado ? [h, w] : [w, h];
    const cx = x + w / 2;
    const cy = y + h / 2;
    return { x, y, w, h, cx, cy, ancho, alto, x0: cx - ancho / 2, y0: cy - alto / 2,
             giro: giro ? `rotate(${-giro} ${cx} ${cy})` : '' };
  }

  /** El rectángulo de un sello o una imagen, con lo que se esté arrastrando. */
  rectDe(anotacion: Anotacion & { rect: Rect }): Rect {
    const provisional = this.provisional;
    if (provisional?.id === anotacion.id && provisional.recorte) {
      const { x, y, ancho, alto } = provisional.recorte;
      return [x, y, x + ancho, y + alto];
    }
    return anotacion.rect;
  }

  caminos(anotacion: Anotacion & { tipo: 'trazo' }): string[] {
    return anotacion.trazos.map(linea => camino(linea, this.anchoSinGirar, this.altoSinGirar));
  }

  grosorPx(grosor: number): number {
    return Math.max(1, grosor * this.escala);
  }

  /** Lo que hace falta para pintar una forma, en píxeles sin girar. */
  forma(f: { figura: Figura; desde: Punto; hasta: Punto; grosor: number }) {
    const [x0, y0] = [f.desde[0] * this.anchoSinGirar, f.desde[1] * this.altoSinGirar];
    const [x1, y1] = [f.hasta[0] * this.anchoSinGirar, f.hasta[1] * this.altoSinGirar];
    return {
      x0, y0, x1, y1,
      x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2,
      punta: f.figura === 'flecha'
        ? puntaDeFlecha(x0, y0, x1, y1, Math.max(8, this.grosorPx(f.grosor) * 4))
        : '',
    };
  }

  /** Dónde va el icono de una nota, en porcentajes de lo que se ve. */
  sitioDeNota(nota: Anotacion & { tipo: 'nota' }): { left: string; top: string } {
    const punto = this.provisional?.id === nota.id && this.provisional.punto
      ? this.provisional.punto
      : [nota.x, nota.y];
    return puntoAPorcentajes(punto[0], punto[1], this.colocada.rotacion);
  }

  estiloDeExistente(existente: ExistentePdf): Record<string, string> {
    return aPorcentajes(existente.rect, this.colocada.rotacion);
  }

  /** El trazo o la forma que se está dibujando ahora mismo. */
  get enCurso(): { camino?: string; forma?: ReturnType<VisorDibujosComponent['forma']> } | null {
    const gesto = this.gesto;
    if (gesto?.modo === 'dibujo' && gesto.puntos) {
      return { camino: camino(gesto.puntos, this.anchoSinGirar, this.altoSinGirar) };
    }
    if (gesto?.modo === 'forma' && gesto.hasta) {
      return { forma: this.forma({ figura: this.estilo.figura, desde: gesto.inicio,
                                   hasta: gesto.hasta, grosor: this.estilo.grosor }) };
    }
    return null;
  }

  get elegida(): Anotacion | null {
    return this.anotaciones.find(a => a.id === this.seleccionada) ?? null;
  }

  /** Dónde va el menú de la anotación elegida: debajo de ella, en lo que se ve. */
  get sitioDelMenu(): { left: string; top: string } | null {
    const elegida = this.elegida;
    if (!elegida) {
      return null;
    }
    let rect: Rect;
    switch (elegida.tipo) {
      case 'nota':
        rect = [elegida.x, elegida.y, elegida.x, elegida.y];
        break;
      case 'sello':
      case 'imagen':
        rect = this.rectDe(elegida);
        break;
      case 'forma':
        rect = [Math.min(elegida.desde[0], elegida.hasta[0]), Math.min(elegida.desde[1], elegida.hasta[1]),
                Math.max(elegida.desde[0], elegida.hasta[0]), Math.max(elegida.desde[1], elegida.hasta[1])];
        break;
      default: {
        const puntos = elegida.trazos.flat();
        rect = [Math.min(...puntos.map(p => p[0])), Math.min(...puntos.map(p => p[1])),
                Math.max(...puntos.map(p => p[0])), Math.max(...puntos.map(p => p[1]))];
      }
    }
    const { left, top, width, height } = aPorcentajes(rect, this.colocada.rotacion);
    return { left: `calc(${left} + ${width} / 2)`, top: `calc(${top} + ${height} + 0.5rem)` };
  }

  // --- crear ----------------------------------------------------------------

  /** Empieza un trazo o una forma; las demás herramientas actúan al soltar. */
  alPulsar(evento: PointerEvent): void {
    if (!this.herramienta || evento.button > 0) {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
    const punto = this.enPagina(evento);
    this.elemento.nativeElement.setPointerCapture(evento.pointerId);
    this.gesto = {
      id: null,
      modo: this.herramienta === 'dibujar' ? 'dibujo' : this.herramienta === 'forma' ? 'forma' : 'nota',
      inicio: punto,
      puntero: { x: evento.clientX, y: evento.clientY },
      movido: false,
      puntos: this.herramienta === 'dibujar' ? [punto] : undefined,
    };
  }

  @HostListener('pointermove', ['$event'])
  alMover(evento: PointerEvent): void {
    const gesto = this.gesto;
    if (!gesto) {
      return;
    }
    gesto.movido ||= Math.hypot(evento.clientX - gesto.puntero.x,
                                evento.clientY - gesto.puntero.y) > UMBRAL_ARRASTRE;
    const punto = this.enPagina(evento);
    if (gesto.modo === 'dibujo') {
      gesto.puntos!.push(punto);
    } else if (gesto.modo === 'forma') {
      gesto.hasta = punto;
    } else if (gesto.id && gesto.movido) {
      const dx = punto[0] - gesto.inicio[0];
      const dy = punto[1] - gesto.inicio[1];
      if (gesto.modo === 'nota') {
        this.provisional = { id: gesto.id, punto: [Math.min(1, Math.max(0, punto[0])),
                                                    Math.min(1, Math.max(0, punto[1]))] };
      } else if (gesto.recorte) {
        this.provisional = { id: gesto.id,
                             recorte: redimensionar(gesto.recorte, gesto.modo, dx, dy, gesto.proporcion) };
      }
    }
    this.cd.markForCheck();
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  alSoltar(evento: PointerEvent): void {
    const gesto = this.gesto;
    this.gesto = null;
    if (!gesto) {
      return;
    }
    if (evento.type === 'pointercancel') {
      this.provisional = null;
      this.cd.markForCheck();
      return;
    }
    if (gesto.id) {
      this.terminarCambio(gesto);
    } else {
      this.crear(gesto, this.enPagina(evento));
    }
    this.provisional = null;
    this.cd.markForCheck();
  }

  private crear(gesto: Gesto, punto: Punto): void {
    const { color, grosor, figura } = this.estilo;
    switch (this.herramienta) {
      case 'dibujar': {
        const puntos = simplificar(gesto.puntos ?? [], TOLERANCIA_TRAZO);
        // Un toque sin mover deja un punto: se dibuja como un trazo mínimo.
        const trazo = puntos.length > 1 ? puntos : [punto, [punto[0] + 0.001, punto[1]] as Punto];
        this.creada.emit({ tipo: 'trazo', color, grosor, trazos: [trazo] });
        break;
      }
      case 'forma':
        if (Math.hypot(punto[0] - gesto.inicio[0], punto[1] - gesto.inicio[1]) > FORMA_MINIMA) {
          this.creada.emit({ tipo: 'forma', color, grosor, figura, desde: gesto.inicio, hasta: punto });
        }
        break;
      case 'nota':
        this.creada.emit({ tipo: 'nota', color, x: punto[0], y: punto[1], texto: '' });
        break;
      // El sello y la firma se miden en lo que se ve (para que salgan derechos
      // en la página tal y como se lee) y se pasan al espacio sin girar.
      case 'sello': {
        const texto = this.textoDelSello();
        const [ancho, alto] = tamanoDeSello(texto, this.ancho, this.alto);
        this.creada.emit({ tipo: 'sello', color, texto, rotacion: this.colocada.rotacion,
                           rect: centrado(punto, ...this.sinGirar(ancho, alto)) });
        break;
      }
      case 'firma':
        if (this.firma) {
          const ancho = 0.3;
          const alto = Math.min(0.9, ancho * this.ancho / this.firma.relacion / this.alto);
          this.creada.emit({ tipo: 'imagen', color, datos: this.firma.datos, rotacion: this.colocada.rotacion,
                             rect: centrado(punto, ...this.sinGirar(ancho, alto)) });
        }
        break;
    }
  }

  /** Un tamaño en proporciones de lo que se ve, en proporciones de la página sin girar. */
  private sinGirar(ancho: number, alto: number): [number, number] {
    return Math.abs(this.colocada.rotacion % 180) === 90 ? [alto, ancho] : [ancho, alto];
  }

  textoDelSello(): string {
    const texto = this.estilo.sello.trim() || 'APROBADO';
    return this.estilo.selloConFecha ? `${texto} · ${fechaDeSello()}` : texto;
  }

  // --- elegir, mover y redimensionar ---------------------------------------

  /**
   * Pulsar una anotación ya puesta: la elige y, si se arrastra, la mueve (las
   * notas, los sellos y las imágenes; un dibujo o una forma sólo se eligen).
   */
  alPulsarAnotacion(evento: PointerEvent, anotacion: Anotacion, tirador: Tirador = 'mover'): void {
    if (this.herramienta && this.herramienta !== 'nota') {
      return;            // dibujando, pulsar encima de otra cosa dibuja
    }
    evento.preventDefault();
    evento.stopPropagation();
    this.seleccionar.emit(anotacion.id);
    if (anotacion.tipo === 'trazo' || anotacion.tipo === 'forma') {
      return;
    }
    this.elemento.nativeElement.setPointerCapture(evento.pointerId);
    this.gesto = {
      id: anotacion.id,
      modo: anotacion.tipo === 'nota' ? 'nota' : tirador,
      inicio: this.enPagina(evento),
      puntero: { x: evento.clientX, y: evento.clientY },
      movido: false,
      recorte: anotacion.tipo === 'nota' ? undefined : aRecorte(anotacion.rect),
      proporcion: anotacion.tipo === 'imagen'
        ? (anotacion.rect[2] - anotacion.rect[0]) / (anotacion.rect[3] - anotacion.rect[1])
        : null,
    };
  }

  private terminarCambio(gesto: Gesto): void {
    const provisional = this.provisional;
    if (!gesto.movido || provisional?.id !== gesto.id) {
      return;
    }
    if (provisional.punto) {
      this.cambiada.emit({ id: gesto.id!, cambio: { x: provisional.punto[0], y: provisional.punto[1] } });
    } else if (provisional.recorte) {
      const { x, y, ancho, alto } = provisional.recorte;
      this.cambiada.emit({ id: gesto.id!, cambio: { rect: [x, y, x + ancho, y + alto] } });
    }
  }

  cambiarColor(color: ColorTexto): void {
    if (this.seleccionada) {
      this.cambiada.emit({ id: this.seleccionada, cambio: { color } });
    }
  }

  escribirNota(texto: string): void {
    if (this.seleccionada) {
      this.cambiada.emit({ id: this.seleccionada, cambio: { texto } });
    }
  }

  quitar(): void {
    if (this.seleccionada) {
      this.quitada.emit(this.seleccionada);
    }
  }

  cerrarMenu(): void {
    this.seleccionar.emit(null);
  }

  leerExistente(evento: Event, existente: ExistentePdf): void {
    evento.stopPropagation();
    this.leyendo = this.leyendo === existente ? null : existente;
  }

  /**
   * Pulsar fuera de cualquier anotación suelta la elegida. Fuera de **todas**,
   * no sólo de las de esta página: si no, elegir una en la página de al lado
   * haría que esta capa la soltara justo después.
   */
  @HostListener('document:pointerdown', ['$event'])
  alPulsarFuera(evento: PointerEvent): void {
    const destino = evento.target as HTMLElement | null;
    if (destino?.closest?.('[data-anotacion], .menu-dibujo, .lectura-nota')) {
      return;
    }
    if (this.leyendo) {
      this.leyendo = null;
      this.cd.markForCheck();
    }
    if (this.seleccionada && this.anotaciones.some(a => a.id === this.seleccionada)) {
      this.seleccionar.emit(null);
    }
  }

  private enPagina(evento: PointerEvent): Punto {
    const caja = this.elemento.nativeElement.getBoundingClientRect();
    return puntoAProporciones(evento.clientX, evento.clientY, caja, this.colocada.rotacion);
  }
}

function centrado([x, y]: Punto, ancho: number, alto: number): Rect {
  const x0 = Math.min(1 - ancho, Math.max(0, x - ancho / 2));
  const y0 = Math.min(1 - alto, Math.max(0, y - alto / 2));
  return [x0, y0, x0 + ancho, y0 + alto];
}

function aRecorte([x0, y0, x1, y1]: Rect): Recorte {
  return { x: x0, y: y0, ancho: x1 - x0, alto: y1 - y0 };
}
