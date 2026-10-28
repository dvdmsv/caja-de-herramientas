
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, Output, ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Un punto del trazo, en fracciones del lienzo para sobrevivir a un cambio de tamaño. */
interface Punto {
  x: number;
  y: number;
  /** Grosor en fracción del ancho del lienzo. */
  grosor: number;
}

/** Grosor base del trazo y cuánto lo modulan la presión o la velocidad. */
const GROSOR_BASE = 0.005;
const GROSOR_MINIMO = 0.4;
const GROSOR_MAXIMO = 1.6;

/** Velocidad (fracción de lienzo por milisegundo) a la que el trazo adelgaza del todo. */
const VELOCIDAD_MAXIMA = 0.004;

/** El buffer se pinta a más resolución que la pantalla: la firma acaba en un PDF. */
const SOBREMUESTREO = 2;

/**
 * Pizarra para firmar a mano con el ratón, el dedo o un lápiz.
 *
 * Con un Apple Pencil (u otro lápiz que informe de presión) el trazo engorda y
 * adelgaza como una pluma; sin él, el grosor lo marca la velocidad, que da un
 * resultado parecido. Devuelve un PNG con fondo transparente.
 */
@Component({
  selector: 'app-pizarra',
  imports: [FormsModule],
  templateUrl: './pizarra.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './pizarra.component.css',
})
export class PizarraComponent implements AfterViewInit {
  @ViewChild('lienzo') lienzoRef!: ElementRef<HTMLCanvasElement>;

  @Input() deshabilitado = false;
  /** Se emite al confirmar la firma dibujada, ya como archivo PNG. */
  @Output() firmada = new EventEmitter<File>();

  /** Se enciende en cuanto toca un lápiz: hasta entonces no se ofrece la casilla. */
  hayLapiz = false;
  soloLapiz = true;

  private trazos: Punto[][] = [];
  private actual: Punto[] | null = null;
  private punteroActivo: number | null = null;
  private ultimo: { punto: Punto; momento: number } | null = null;
  private pintadoPedido = false;
  private readonly zona = inject(NgZone);

  get vacia(): boolean {
    return this.trazos.length === 0;
  }

  ngAfterViewInit(): void {
    this.ajustar();
  }

  @HostListener('window:resize')
  ajustar(): void {
    const lienzo = this.lienzoRef?.nativeElement;
    if (!lienzo) {
      return;
    }
    const ancho = lienzo.clientWidth || 600;
    const alto = lienzo.clientHeight || 200;
    const escala = (window.devicePixelRatio || 1) * SOBREMUESTREO;
    lienzo.width = Math.round(ancho * escala);
    lienzo.height = Math.round(alto * escala);
    this.pintar();
  }

  // --- dibujo -----------------------------------------------------------

  alPulsar(evento: PointerEvent): void {
    if (this.deshabilitado || this.punteroActivo !== null || !this.admite(evento)) {
      return;
    }
    // Sin esto, en un iPad el gesto arrastra la página en vez de dibujar.
    evento.preventDefault();
    this.lienzoRef.nativeElement.setPointerCapture(evento.pointerId);

    this.punteroActivo = evento.pointerId;
    this.actual = [];
    this.ultimo = null;
    this.trazos.push(this.actual);
    this.anadir(evento);
  }

  alMover(evento: PointerEvent): void {
    if (this.punteroActivo !== evento.pointerId || !this.actual) {
      return;
    }
    evento.preventDefault();
    // Un lápiz muestrea mucho más rápido de lo que llegan los eventos: sin
    // recuperar los puntos intermedios, un trazo veloz sale con esquinas.
    const eventos = typeof evento.getCoalescedEvents === 'function'
      ? evento.getCoalescedEvents()
      : [evento];
    (eventos.length ? eventos : [evento]).forEach(punto => this.anadir(punto));
    this.programarPintado();
  }

  alSoltar(evento: PointerEvent): void {
    if (this.punteroActivo !== evento.pointerId) {
      return;
    }
    this.punteroActivo = null;
    this.actual = null;
    this.ultimo = null;
    this.pintar();
  }

  /** Descarta el dedo cuando hay un lápiz en juego, para que la palma no manche. */
  private admite(evento: PointerEvent): boolean {
    if (evento.pointerType === 'pen') {
      this.hayLapiz = true;
      return true;
    }
    return !(this.soloLapiz && this.hayLapiz && evento.pointerType === 'touch');
  }

  private anadir(evento: PointerEvent): void {
    const caja = this.lienzoRef.nativeElement.getBoundingClientRect();
    const punto: Punto = {
      x: (evento.clientX - caja.left) / caja.width,
      y: (evento.clientY - caja.top) / caja.height,
      grosor: GROSOR_BASE,
    };
    punto.grosor = GROSOR_BASE * this.factorDeGrosor(evento, punto, caja.width / caja.height);
    this.actual?.push(punto);
    this.ultimo = { punto, momento: evento.timeStamp || performance.now() };
  }

  /**
   * Cuánto engorda o adelgaza el trazo.
   *
   * Con lápiz manda la presión. Si no la hay —dedo, ratón, o un navegador que
   * no la informe— se usa la velocidad, que imita bastante bien el efecto.
   */
  private factorDeGrosor(evento: PointerEvent, punto: Punto, proporcion: number): number {
    if (evento.pointerType === 'pen' && evento.pressure > 0 && evento.pressure !== 0.5) {
      return GROSOR_MINIMO + (GROSOR_MAXIMO - GROSOR_MINIMO) * Math.sqrt(evento.pressure);
    }
    if (!this.ultimo) {
      return 1;
    }
    const momento = evento.timeStamp || performance.now();
    const tiempo = Math.max(1, momento - this.ultimo.momento);
    const avance = Math.hypot(punto.x - this.ultimo.punto.x,
                              (punto.y - this.ultimo.punto.y) / proporcion);
    const rapidez = Math.min(1, avance / tiempo / VELOCIDAD_MAXIMA);
    const objetivo = GROSOR_MAXIMO - (GROSOR_MAXIMO - GROSOR_MINIMO) * rapidez;
    // Media con el grosor anterior: evita saltos bruscos entre dos muestras.
    return (objetivo + this.ultimo.punto.grosor / GROSOR_BASE) / 2;
  }

  // --- pintado ----------------------------------------------------------

  private programarPintado(): void {
    if (this.pintadoPedido) {
      return;
    }
    this.pintadoPedido = true;
    requestAnimationFrame(() => {
      this.pintadoPedido = false;
      this.pintar();
    });
  }

  private pintar(): void {
    const lienzo = this.lienzoRef?.nativeElement;
    const contexto = lienzo?.getContext('2d');
    if (!lienzo || !contexto) {
      return;
    }
    contexto.clearRect(0, 0, lienzo.width, lienzo.height);
    contexto.strokeStyle = '#1a1a2e';
    contexto.lineCap = 'round';
    contexto.lineJoin = 'round';

    this.trazos.forEach(trazo => {
      if (trazo.length === 1) {
        const punto = trazo[0];
        contexto.beginPath();
        contexto.arc(punto.x * lienzo.width, punto.y * lienzo.height,
                     (punto.grosor * lienzo.width) / 2, 0, Math.PI * 2);
        contexto.fillStyle = '#1a1a2e';
        contexto.fill();
        return;
      }
      // Cada tramo va por separado porque cada uno tiene su propio grosor.
      for (let i = 1; i < trazo.length; i++) {
        const anterior = trazo[i - 1];
        const punto = trazo[i];
        contexto.beginPath();
        contexto.lineWidth = ((anterior.grosor + punto.grosor) / 2) * lienzo.width;
        contexto.moveTo(anterior.x * lienzo.width, anterior.y * lienzo.height);
        contexto.lineTo(punto.x * lienzo.width, punto.y * lienzo.height);
        contexto.stroke();
      }
    });
  }

  // --- acciones ---------------------------------------------------------

  deshacer(): void {
    this.trazos.pop();
    this.pintar();
  }

  borrar(): void {
    this.trazos = [];
    this.pintar();
  }

  /**
   * Se entrega dentro de la zona de Angular: zone.js no intercepta `toBlob`, y
   * sin volver a ella quien la recibe cambiaba su estado sin que se repintara
   * nada hasta el siguiente movimiento del ratón. Con la bóveda se veía: la
   * firma se guardaba y la lista seguía igual.
   */
  usar(): void {
    this.lienzoRef.nativeElement.toBlob(blob => {
      if (blob) {
        this.zona.run(() => this.firmada.emit(new File([blob], 'firma-dibujada.png', { type: 'image/png' })));
      }
    }, 'image/png');
  }
}
