import { Component, ElementRef, EventEmitter, Input, Output, ViewChild,
         ChangeDetectionStrategy } from '@angular/core';

import { Recorte, Tirador, enEspacioImagen, mover, redimensionar } from './recorte';

interface Gesto {
  tirador: Tirador;
  /**
   * Medidas del lienzo **sin girar**, congeladas al empezar el gesto.
   *
   * Se usan `offsetWidth`/`offsetHeight` y no `getBoundingClientRect()` a
   * propósito: de un elemento girado, el rectángulo que devuelve el navegador es
   * su caja envolvente, que con 90° tiene el ancho y el alto cambiados. El
   * `offset*` no lo altera la transformación, que es justo lo que hace falta
   * para pasar a fracciones de la imagen.
   */
  ancho: number;
  alto: number;
  inicio: Recorte;
  puntero: { x: number; y: number };
}

/**
 * Una imagen con un recuadro de recorte encima, arrastrable con ratón o dedo.
 *
 * **Aquí lo pinta el navegador, y no contradice la regla del proyecto.** Las
 * vistas previas las dibuja el servidor porque estampar sobre un PDF exige
 * corregir el giro de la página, y eso sólo lo sabe PyMuPDF. Aquí no se estampa
 * nada: lo que se enseña es la propia imagen con un rectángulo encima, y llevar
 * eso al servidor sería una petición por cada píxel de arrastre.
 *
 * Lo que sí es del servidor es el recorte de verdad. Por eso el recuadro se
 * guarda en fracciones de 0 a 1 (ver `recorte.ts`): lo que se ve es lo que
 * recorta `editar_imagen.py`, se esté viendo la foto al tamaño que se esté
 * viendo.
 */
@Component({
  selector: 'app-recuadro',
  imports: [],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './recuadro.component.html',
  styleUrl: './recuadro.component.css',
})
export class RecuadroComponent {
  @ViewChild('lienzo') lienzoRef!: ElementRef<HTMLElement>;

  @Input({ required: true }) imagen!: string;
  @Input({ required: true }) recorte!: Recorte;
  /** Proporción ancho/alto a respetar, ya en fracciones, o `null` si es libre. */
  @Input() objetivo: number | null = null;
  @Input() deshabilitado = false;
  /**
   * Cómo se está viendo la foto. **El recuadro no se gira con esto**: la imagen
   * y el recuadro giran juntos porque el marco de fuera los gira a los dos, así
   * que el recorte sigue viviendo en el espacio sin girar y no hay ninguna
   * conversión de coordenadas que se pueda desviar. Lo único que hay que
   * corregir es el desplazamiento del puntero.
   */
  @Input() giro = 0;
  @Input() espejo = false;

  @Output() recorteChange = new EventEmitter<Recorte>();

  readonly tiradores: Tirador[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  private gesto: Gesto | null = null;

  /** El recuadro en porcentajes, que es como lo quiere el CSS. */
  get estilo(): Record<string, string> {
    return {
      left: `${this.recorte.x * 100}%`,
      top: `${this.recorte.y * 100}%`,
      width: `${this.recorte.ancho * 100}%`,
      height: `${this.recorte.alto * 100}%`,
    };
  }

  empezar(evento: PointerEvent, tirador: Tirador): void {
    if (this.deshabilitado) {
      return;
    }
    // Sin esto el navegador se lleva la imagen como si fuera un enlace.
    evento.preventDefault();
    evento.stopPropagation();

    const lienzo = this.lienzoRef.nativeElement;
    if (!lienzo.offsetWidth || !lienzo.offsetHeight) {
      return;
    }
    this.gesto = {
      tirador,
      ancho: lienzo.offsetWidth,
      alto: lienzo.offsetHeight,
      inicio: { ...this.recorte },
      puntero: { x: evento.clientX, y: evento.clientY },
    };
    (evento.target as Element).setPointerCapture?.(evento.pointerId);
  }

  seguir(evento: PointerEvent): void {
    if (!this.gesto) {
      return;
    }
    evento.preventDefault();
    const { tirador, ancho, alto, inicio, puntero } = this.gesto;

    // De la pantalla a la imagen primero, y a fracciones después: al girar 90°
    // un píxel horizontal de pantalla es uno vertical de la imagen, y hay que
    // dividirlo por el alto, no por el ancho.
    const [px, py] = enEspacioImagen(evento.clientX - puntero.x, evento.clientY - puntero.y,
                                     this.giro, this.espejo);
    const dx = px / ancho;
    const dy = py / alto;

    // Mover no respeta proporción: el recuadro no cambia de forma al arrastrarlo.
    this.recorte = tirador === 'mover'
      ? mover(inicio, dx, dy)
      : redimensionar(inicio, tirador, dx, dy, this.objetivo);
    this.recorteChange.emit(this.recorte);
  }

  soltar(evento: PointerEvent): void {
    if (!this.gesto) {
      return;
    }
    (evento.target as Element).releasePointerCapture?.(evento.pointerId);
    this.gesto = null;
  }
}
