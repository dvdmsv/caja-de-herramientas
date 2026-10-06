import { factorDeRueda } from './zoom';

/**
 * Pellizco con dos dedos y Ctrl+rueda sobre el área de lectura.
 *
 * Mientras dura el gesto sólo se avisa del factor y del punto (`alMover`), y el
 * visor lo enseña escalando con CSS, que es inmediato; al acabar (`alTerminar`)
 * se recoloca de verdad y se redibuja. Redibujar en cada paso del gesto
 * pondría a pdf.js a pintar decenas de páginas que nadie va a ver.
 *
 * Con eventos `touch*` y no `pointer*`: con `touch-action: pan-x pan-y` el
 * navegador se queda el primer dedo para desplazar y manda `pointercancel`, así
 * que un pellizco que no empiece con los dos dedos a la vez no llegaría. Los
 * eventos táctiles siguen llegando, y basta cancelar el `touchmove` de dos
 * dedos para que no se desplace mientras se pellizca. Es lo que hace pdf.js.
 */
export class GestoZoom {
  /** Cuánto se espera tras el último giro de rueda para dar el gesto por acabado. */
  private static readonly PAUSA_RUEDA = 180;

  private factor = 1;
  private origen = { x: 0, y: 0 };
  private distanciaInicial = 0;
  private activo = false;
  private esperaRueda = 0;
  private readonly abortar = new AbortController();

  constructor(
    elemento: HTMLElement,
    /** Lo que se puede ampliar desde la escala actual: recorta el factor a los topes. */
    private readonly limitar: (factor: number) => number,
    private readonly alMover: (factor: number, origen: { x: number; y: number }) => void,
    private readonly alTerminar: (factor: number, origen: { x: number; y: number }) => void,
  ) {
    const opciones = { signal: this.abortar.signal, passive: false };
    elemento.addEventListener('wheel', this.alGirar, opciones);
    elemento.addEventListener('touchstart', this.alTocar, opciones);
    elemento.addEventListener('touchmove', this.alArrastrar, opciones);
    elemento.addEventListener('touchend', this.alSoltar, opciones);
    elemento.addEventListener('touchcancel', this.alSoltar, opciones);
  }

  destruir(): void {
    this.abortar.abort();
    clearTimeout(this.esperaRueda);
  }

  private readonly alGirar = (evento: WheelEvent): void => {
    // Sin Ctrl la rueda desplaza, como siempre. Un panel táctil que pellizca
    // llega aquí también con `ctrlKey`: Chrome lo traduce así.
    if (!evento.ctrlKey) {
      return;
    }
    evento.preventDefault();
    // El punto fijo es donde empezó el gesto: moverlo a mitad haría saltar la
    // página, porque cambiaría el centro de una escala ya aplicada.
    if (!this.activo) {
      this.empezar(evento.clientX, evento.clientY);
    }
    this.factor = this.limitar(this.factor * factorDeRueda(evento.deltaY, evento.deltaMode));
    this.alMover(this.factor, this.origen);
    clearTimeout(this.esperaRueda);
    this.esperaRueda = window.setTimeout(() => this.terminar(), GestoZoom.PAUSA_RUEDA);
  };

  private readonly alTocar = (evento: TouchEvent): void => {
    if (evento.touches.length !== 2) {
      return;
    }
    const [a, b] = [evento.touches[0], evento.touches[1]];
    this.distanciaInicial = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    this.empezar((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  };

  private readonly alArrastrar = (evento: TouchEvent): void => {
    if (!this.activo || evento.touches.length !== 2) {
      return;
    }
    evento.preventDefault();
    const [a, b] = [evento.touches[0], evento.touches[1]];
    const distancia = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    this.factor = this.limitar(distancia / this.distanciaInicial);
    // El punto fijo es el del principio: si siguiera a los dedos, ampliar
    // mientras se mueven a la vez haría ir la página a saltos.
    this.alMover(this.factor, this.origen);
  };

  private readonly alSoltar = (evento: TouchEvent): void => {
    if (this.activo && evento.touches.length < 2) {
      this.terminar();
    }
  };

  private empezar(x: number, y: number): void {
    this.activo = true;
    this.factor = 1;
    this.origen = { x, y };
  }

  private terminar(): void {
    if (!this.activo) {
      return;
    }
    this.activo = false;
    this.alTerminar(this.factor, this.origen);
    this.factor = 1;
  }
}
