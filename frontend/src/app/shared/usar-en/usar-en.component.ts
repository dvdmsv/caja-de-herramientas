import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, Input, ViewChild, inject,
} from '@angular/core';
import { Router } from '@angular/router';

import { ApiService, ArchivoServidor } from '../../core/api.service';
import {
  CATEGORIAS, Categoria, ClaveCategoria, Herramienta, claveDeCategoria, destinosPara, rutaDe,
} from '../../core/tools';
import { prepararTraspaso, TraspasoService } from '../../core/traspaso.service';
import { MARCO_HERRAMIENTA } from '../marco-herramienta';
import { avisoError, mensajeDeError } from '../notify';

interface GrupoDestinos {
  categoria: Categoria;
  clave: ClaveCategoria;
  herramientas: Herramienta[];
}

/**
 * "Usar en…": manda uno o varios resultados a otra herramienta sin descargarlos
 * y volverlos a subir a mano.
 *
 * Sólo ofrece las herramientas que admiten esos archivos (por su `acepta` en el
 * catálogo). Los destinos que trabajan en el servidor reciben directamente los ID.
 */
@Component({
  selector: 'app-usar-en',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './usar-en.component.html',
  styleUrl: './usar-en.component.css',
})
export class UsarEnComponent {
  @Input({ required: true }) archivos: ArchivoServidor[] = [];
  /** Texto del botón; sin texto, sólo el icono (para las filas de la lista). */
  @Input() etiqueta = '';

  @ViewChild('disparador') disparador?: ElementRef<HTMLButtonElement>;
  @ViewChild('menu') menu?: ElementRef<HTMLElement>;

  abierto = false;
  cargando = false;
  /** Se abre hacia arriba si debajo del botón no cabe y encima sí. */
  haciaArriba = false;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly traspaso = inject(TraspasoService);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly marco = inject(MARCO_HERRAMIENTA, { optional: true });

  get grupos(): GrupoDestinos[] {
    const destinos = destinosPara(this.archivos.map(a => ({ name: a.name, type: '' })), this.marco?.herramienta?.slug);
    return CATEGORIAS
      .map(categoria => ({
        categoria,
        clave: claveDeCategoria(categoria),
        herramientas: destinos.filter(h => h.categoria === categoria),
      }))
      .filter(grupo => grupo.herramientas.length > 0);
  }

  get descripcion(): string {
    return this.archivos.length === 1 ? `Usar ${this.archivos[0].name} en otra herramienta` : 'Usar todos en otra herramienta';
  }

  alternar(): void {
    this.abierto = !this.abierto;
    if (this.abierto) {
      const caja = this.disparador?.nativeElement.getBoundingClientRect();
      const alto = Math.min(384, window.innerHeight * 0.6);
      this.haciaArriba = !!caja && window.innerHeight - caja.bottom < alto && caja.top > window.innerHeight - caja.bottom;
      // Quien llega con el teclado sigue dentro del menú que acaba de abrir.
      setTimeout(() => this.menu?.nativeElement.querySelector<HTMLElement>('button')?.focus());
    }
  }

  async usarEn(herramienta: Herramienta): Promise<void> {
    this.cargando = true;
    try {
      const entradas = await prepararTraspaso(this.archivos, herramienta.slug, this.api);
      this.traspaso.dejarEntradas(entradas);
      this.abierto = false;
      await this.router.navigateByUrl(rutaDe(herramienta));
    } catch (err) {
      avisoError(mensajeDeError(err, 'No se ha podido pasar el archivo a la otra herramienta.'));
    } finally {
      this.cargando = false;
    }
  }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(evento: MouseEvent): void {
    if (this.abierto && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.abierto = false;
    }
  }

  @HostListener('keydown.escape')
  alPulsarEscape(): void {
    if (this.abierto) {
      this.abierto = false;
      this.disparador?.nativeElement.focus();
    }
  }
}
