import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, Input, ViewChild, inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ApiService, ArchivoServidor } from '../../core/api.service';
import {
  CATEGORIAS, Categoria, ClaveCategoria, Herramienta, claveDeCategoria, destinosPara, rutaDe,
} from '../../core/tools';
import { TraspasoService } from '../../core/traspaso.service';
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
 * catálogo) y, si son varios, las que trabajan con varios. Al elegir una, baja
 * los archivos, los deja en `TraspasoService` y navega; allí los recoge el marco
 * de la herramienta. Se vuelven a subir en vez de reutilizar su id del servidor
 * porque varias herramientas necesitan el archivo en el navegador (pdf.js), y
 * así todas lo reciben igual que si el usuario lo hubiera soltado.
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

  usarEn(herramienta: Herramienta): void {
    this.cargando = true;
    forkJoin(this.archivos.map(archivo => this.api.contenido(archivo))).subscribe({
      next: blobs => {
        const archivos = blobs.map((blob, i) => new File([blob], this.archivos[i].name, { type: blob.type }));
        this.traspaso.dejar(archivos);
        this.cargando = false;
        this.abierto = false;
        this.router.navigateByUrl(rutaDe(herramienta));
      },
      error: err => {
        this.cargando = false;
        avisoError(mensajeDeError(err, 'No se ha podido pasar el archivo a la otra herramienta.'));
      },
    });
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
