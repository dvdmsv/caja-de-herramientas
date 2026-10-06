import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  HostListener, Input, OnDestroy, Output, ViewChild, inject,
} from '@angular/core';

import { DocumentoPdf } from '../../core/pdf.service';
import { VisorRenderService, esCancelacion } from '../../core/visor-render.service';

/** Cuánto hay que deslizar el dedo para pasar de página. */
const DESLIZAMIENTO = 50;

/** Cuánto se ve el número de página después de pasarla. */
const AVISO_PAGINA = 1500;

/**
 * Modo presentación: una página cada vez, a pantalla completa y sobre negro.
 *
 * Se pasa con las flechas, Av Pág, la barra espaciadora o un clic (en el tercio
 * izquierdo, hacia atrás); con el dedo, deslizando. Esc sale. Va aparte del
 * visor porque no comparte nada con la lectura: ni disposición, ni capa de
 * texto, ni marcas. Enseña el documento tal cual, con los giros y las páginas
 * quitadas, pero sin lo anotado sin guardar.
 */
@Component({
  selector: 'app-visor-presentacion',
  template: `
    <canvas #lienzo class="lienzo" [style.width.px]="ancho" [style.height.px]="alto"
      role="img" [attr.aria-label]="'Página ' + paginas[indice] + ' de ' + paginas.length"></canvas>
    <span class="numero" [class.numero--visible]="numeroVisible" aria-live="polite">
      {{ indice + 1 }} / {{ paginas.length }}
    </span>
    <button type="button" class="salir" (click)="salir()" aria-label="Salir de la presentación"
      title="Salir (Esc)">
      <i class="bi bi-x-lg" aria-hidden="true"></i>
    </button>
  `,
  styles: `
    /* Negro y blanco fijos a propósito: una presentación es igual con el tema
       claro que con el oscuro, como en cualquier proyector. */
    :host {
      position: fixed;
      inset: 0;
      z-index: 1070;
      display: grid;
      place-items: center;
      background-color: #000;
      /* Los gestos son de la presentación: si no, deslizar desplazaría. */
      touch-action: none;
      user-select: none;
      cursor: pointer;
    }

    .lienzo {
      display: block;
      background-color: #fff;
    }

    .numero,
    .salir {
      position: absolute;
      color: #fff;
      background-color: rgba(0, 0, 0, 0.55);
      border-radius: 2rem;
      transition: opacity 0.3s ease;
    }

    .numero {
      bottom: 1rem;
      left: 50%;
      translate: -50% 0;
      padding: 0.25rem 0.8rem;
      font-size: 0.9rem;
      opacity: 0;
      pointer-events: none;
    }

    .numero--visible {
      opacity: 1;
    }

    /* Discreto mientras se presenta; aparece al acercar el ratón. */
    .salir {
      top: 1rem;
      right: 1rem;
      width: 2.75rem;
      height: 2.75rem;
      border: 0;
      opacity: 0;
    }

    :host(:hover) .salir,
    .salir:focus-visible {
      opacity: 1;
    }

    /* TACTIL (core/pantalla.ts): sin ratón no hay «acercarse», así que el botón
       de salir se ve siempre; con 44 px, como todo lo que se toca. */
    @media (pointer: coarse) {
      .salir {
        opacity: 0.8;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .numero,
      .salir {
        transition: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisorPresentacionComponent implements AfterViewInit, OnDestroy {
  @ViewChild('lienzo', { static: true }) lienzoRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) documento!: DocumentoPdf;
  /** Las páginas que se presentan, en orden: las que no se han quitado. */
  @Input({ required: true }) paginas: number[] = [];
  @Input() rotaciones = new Map<number, number>();
  @Input() inicial = 1;

  /** Al salir, con la página en la que se estaba, para seguir leyendo por ahí. */
  @Output() cerrar = new EventEmitter<number>();

  indice = 0;
  ancho = 0;
  alto = 0;
  numeroVisible = false;

  private readonly render = inject(VisorRenderService);
  private readonly cd = inject(ChangeDetectorRef);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private clave = '';
  private origenDedo: { x: number; y: number } | null = null;
  private avisoNumero = 0;
  private cerrada = false;

  ngAfterViewInit(): void {
    this.indice = Math.max(0, this.paginas.indexOf(this.inicial));
    // Si el navegador no deja la pantalla completa (un iframe, un móvil que no
    // lo admite), se presenta igual dentro de la ventana.
    this.elemento.nativeElement.requestFullscreen?.().catch(() => undefined);
    this.elemento.nativeElement.focus?.();
    this.dibujar();
  }

  ngOnDestroy(): void {
    this.render.cancelar(this.clave);
    this.render.liberar(this.lienzoRef.nativeElement);
    clearTimeout(this.avisoNumero);
    if (document.fullscreenElement === this.elemento.nativeElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  }

  /** Esc con pantalla completa lo atiende el navegador: sale, y aquí se entera. */
  @HostListener('document:fullscreenchange')
  alCambiarPantallaCompleta(): void {
    if (!document.fullscreenElement) {
      this.salir();
    }
  }

  @HostListener('window:resize')
  alRedimensionar(): void {
    this.dibujar();
  }

  @HostListener('window:keydown', ['$event'])
  alPulsarTecla(evento: KeyboardEvent): void {
    const pasos: Record<string, number> = {
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, Enter: 1, n: 1,
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1, p: -1,
    };
    if (evento.key === 'Escape') {
      evento.preventDefault();
      this.salir();
    } else if (evento.key === 'Home' || evento.key === 'End') {
      evento.preventDefault();
      this.ir(evento.key === 'Home' ? 0 : this.paginas.length - 1);
    } else if (pasos[evento.key]) {
      evento.preventDefault();
      this.ir(this.indice + pasos[evento.key]);
    }
  }

  @HostListener('pointerdown', ['$event'])
  alPulsar(evento: PointerEvent): void {
    this.origenDedo = { x: evento.clientX, y: evento.clientY };
  }

  /** Un deslizamiento pasa de página; un toque o un clic, según el lado. */
  @HostListener('pointerup', ['$event'])
  alSoltar(evento: PointerEvent): void {
    const origen = this.origenDedo;
    this.origenDedo = null;
    if (!origen || (evento.target as HTMLElement).closest('.salir')) {
      return;
    }
    const dx = evento.clientX - origen.x;
    const dy = evento.clientY - origen.y;
    if (Math.abs(dx) > DESLIZAMIENTO && Math.abs(dx) > Math.abs(dy)) {
      this.ir(this.indice + (dx < 0 ? 1 : -1));
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      this.ir(this.indice + (evento.clientX < window.innerWidth / 3 ? -1 : 1));
    }
  }

  salir(): void {
    if (this.cerrada) {
      return;
    }
    this.cerrada = true;
    this.cerrar.emit(this.paginas[this.indice] ?? this.inicial);
  }

  private ir(indice: number): void {
    const nuevo = Math.min(this.paginas.length - 1, Math.max(0, indice));
    if (nuevo === this.indice) {
      return;
    }
    this.indice = nuevo;
    this.numeroVisible = true;
    clearTimeout(this.avisoNumero);
    this.avisoNumero = window.setTimeout(() => {
      this.numeroVisible = false;
      this.cd.markForCheck();
    }, AVISO_PAGINA);
    this.dibujar();
  }

  /** La página que toca, ajustada a la pantalla entera. */
  private async dibujar(): Promise<void> {
    const numero = this.paginas[this.indice];
    if (!numero) {
      return;
    }
    const rotacion = this.rotaciones.get(numero) ?? 0;
    const pagina = await this.documento.pagina(numero);
    const natural = pagina.getViewport({ scale: 1, rotation: (pagina.rotate + rotacion) % 360 });
    const escala = Math.min(window.innerWidth / natural.width, window.innerHeight / natural.height);
    this.ancho = Math.floor(natural.width * escala);
    this.alto = Math.floor(natural.height * escala);
    this.cd.markForCheck();

    this.render.cancelar(this.clave);
    this.clave = `presentacion:${numero}:${rotacion}:${escala}`;
    try {
      await this.render.dibujar(this.documento, numero, rotacion, escala,
                                this.lienzoRef.nativeElement, this.clave);
    } catch (err) {
      if (!esCancelacion(err)) {
        console.error(`No se ha podido presentar la página ${numero}:`, err);
      }
    }
  }
}
