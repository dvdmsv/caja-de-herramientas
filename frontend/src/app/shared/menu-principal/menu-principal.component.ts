
import { Component, ElementRef, EventEmitter, HostListener, Output, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { Categoria, ClaveCategoria, Grupo, Herramienta, agruparPorCategoria, claveDeCategoria, rutaDe } from '../../core/tools';

/**
 * Al salir del botón no se cierra en el acto: hay un hueco entre el botón y su
 * panel, y sin este margen el menú se cierra en las narices al bajar el ratón.
 */
const ESPERA_AL_SALIR = 150;

/** A partir de aquí la barra es horizontal; debe coincidir con el CSS y con `navbar-expand-lg`. */
const BARRA_HORIZONTAL = '(min-width: 992px)';

/**
 * Menú principal agrupado por categorías.
 *
 * En escritorio cada sección abre su panel al pasar el ratón; en pantallas
 * estrechas se comporta como un acordeón dentro del menú plegable. Todo va a
 * mano porque el JavaScript de Bootstrap no se carga en esta aplicación.
 */
@Component({
  selector: 'app-menu-principal',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './menu-principal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './menu-principal.component.css',
})
export class MenuPrincipalComponent {
  /** Avisa de que se ha entrado en una herramienta, para cerrar el menú plegable. */
  @Output() navegado = new EventEmitter<void>();

  readonly grupos: Grupo[] = agruparPorCategoria();

  /** Sólo una sección abierta a la vez, en ambos tamaños de pantalla. */
  seccionAbierta: Categoria | null = null;

  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly router = inject(Router);
  private cierrePendiente?: ReturnType<typeof setTimeout>;
  private abiertaPorRaton = false;

  /**
   * Abre o cierra una sección al pulsarla.
   *
   * Con ratón, el panel ya se ha abierto solo al pasar por encima: cerrarlo
   * ahora haría que el clic pareciera no responder. Desde el teclado
   * (`detail === 0`) no hay hover previo, así que ahí sí alterna siempre.
   */
  alternar(evento: MouseEvent, categoria: Categoria): void {
    const conTeclado = evento.detail === 0;
    if (!conTeclado && this.abiertaPorRaton && this.seccionAbierta === categoria) {
      this.abiertaPorRaton = false;
      return;
    }
    this.seccionAbierta = this.seccionAbierta === categoria ? null : categoria;
    this.abiertaPorRaton = false;
  }

  /**
   * Con el ratón la sección se abre sola al pasar por encima; con el dedo o el
   * lápiz hay que tocarla.
   *
   * Se mira de qué apuntador viene el evento en vez de preguntarle al
   * dispositivo si "tiene hover": en un portátil táctil ambas cosas conviven, y
   * lo que importa es con qué se está señalando ahora mismo.
   */
  alEntrar(evento: PointerEvent, categoria: Categoria): void {
    if (!this.conRaton(evento)) {
      return;
    }
    clearTimeout(this.cierrePendiente);
    this.seccionAbierta = categoria;
    this.abiertaPorRaton = true;
  }

  alSalir(evento: PointerEvent): void {
    if (!this.conRaton(evento)) {
      return;
    }
    clearTimeout(this.cierrePendiente);
    this.cierrePendiente = setTimeout(() => {
      this.seccionAbierta = null;
      this.abiertaPorRaton = false;
    }, ESPERA_AL_SALIR);
  }

  alNavegar(): void {
    this.seccionAbierta = null;
    this.navegado.emit();
  }

  /** Marca la sección de la herramienta que se está usando. */
  esActiva(grupo: Grupo): boolean {
    return grupo.herramientas.some(herramienta => this.router.url === rutaDe(herramienta));
  }

  rutaDe(herramienta: Herramienta): string {
    return rutaDe(herramienta);
  }

  clave(grupo: Grupo): ClaveCategoria {
    return claveDeCategoria(grupo.categoria);
  }

  identificador(categoria: Categoria): string {
    return 'seccion-' + categoria.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(evento: MouseEvent): void {
    if (this.seccionAbierta && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.seccionAbierta = null;
    }
  }

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    if (this.seccionAbierta) {
      this.seccionAbierta = null;
      // El foco vuelve al botón de la sección: si no, se queda en el limbo.
      this.elemento.nativeElement.querySelector<HTMLElement>('.seccion__boton')?.focus();
    }
  }

  private conRaton(evento: PointerEvent): boolean {
    return evento.pointerType === 'mouse' && window.matchMedia(BARRA_HORIZONTAL).matches;
  }
}
