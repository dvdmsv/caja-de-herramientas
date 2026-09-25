import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { EscritorioService } from '../../core/escritorio.service';
import { RecientesService } from '../../core/recientes.service';
import {
  ClaveCategoria, Grupo, Herramienta, agruparPorCategoria, buscar, buscarPorSlug, claveDeCategoria,
  destinosPara, rutaDe,
} from '../../core/tools';
import { TraspasoService } from '../../core/traspaso.service';

@Component({
  selector: 'app-home',
  imports: [FormsModule, NgTemplateOutlet, RouterLink],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './home.component.css',
})
export class HomeComponent {
  /** La portada sí anuncia las herramientas que aún no están listas. */
  readonly grupos: Grupo[] = agruparPorCategoria(true);

  @ViewChild('buscador') buscador?: ElementRef<HTMLInputElement>;

  busqueda = '';

  /** Archivos soltados o elegidos en la portada, a la espera de elegir herramienta. */
  soltados: File[] = [];

  /** Hay archivos arrastrándose por encima de la ventana. */
  arrastrando = false;
  private profundidadArrastre = 0;

  private readonly router = inject(Router);
  private readonly traspaso = inject(TraspasoService);

  constructor() {
    // En la aplicación de Windows, lo abierto con «Abrir con…» llega aquí como
    // si se hubiera soltado en la portada: se ofrecen las herramientas que lo
    // aceptan, igual que al soltar.
    const escritorio = inject(EscritorioService);
    const recibidos = escritorio.tomar();
    if (recibidos.length) {
      this.soltados = recibidos;
    }
    escritorio.llegan.pipe(takeUntilDestroyed()).subscribe(archivos => {
      escritorio.tomar();
      this.soltados = archivos;
    });
  }

  /** Leídas una vez al entrar: la lista no cambia mientras se está en la portada. */
  readonly recientes: Herramienta[] = inject(RecientesService).lista()
    .map(slug => buscarPorSlug(slug))
    .filter((h): h is Herramienta => !!h && h.disponible);

  get resultados(): Herramienta[] {
    return buscar(this.busqueda);
  }

  get destinos(): Herramienta[] {
    return destinosPara(this.soltados);
  }

  rutaDe(herramienta: Herramienta): string {
    return rutaDe(herramienta);
  }

  clave(grupo: Grupo): ClaveCategoria {
    return claveDeCategoria(grupo.categoria);
  }

  claveDe(herramienta: Herramienta): ClaveCategoria {
    return claveDeCategoria(herramienta.categoria);
  }

  /** Con Intro se entra en la primera que casa: buscar y abrir sin tocar el ratón. */
  abrirPrimera(): void {
    const primera = this.resultados[0];
    if (primera) {
      this.router.navigateByUrl(rutaDe(primera));
    }
  }

  // --- archivos en la portada -------------------------------------------

  alElegir(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    this.soltados = Array.from(entrada.files ?? []);
    entrada.value = '';
  }

  usarCon(herramienta: Herramienta): void {
    this.traspaso.dejar(this.soltados);
    this.router.navigateByUrl(rutaDe(herramienta));
  }

  descartar(): void {
    this.soltados = [];
  }

  /**
   * Se puede soltar en cualquier parte de la portada. Se cuenta la profundidad
   * porque el navegador lanza `dragleave` al pasar de un elemento a su hijo, y
   * sin contar la capa parpadearía.
   */
  @HostListener('document:dragenter', ['$event'])
  alEntrarArrastre(evento: DragEvent): void {
    if (this.traeArchivos(evento)) {
      this.profundidadArrastre++;
      this.arrastrando = true;
    }
  }

  @HostListener('document:dragleave', ['$event'])
  alSalirArrastre(evento: DragEvent): void {
    if (this.traeArchivos(evento) && --this.profundidadArrastre <= 0) {
      this.profundidadArrastre = 0;
      this.arrastrando = false;
    }
  }

  @HostListener('document:dragover', ['$event'])
  alArrastrarEncima(evento: DragEvent): void {
    if (this.traeArchivos(evento)) {
      evento.preventDefault();
    }
  }

  @HostListener('document:drop', ['$event'])
  alSoltar(evento: DragEvent): void {
    if (!this.traeArchivos(evento)) {
      return;
    }
    evento.preventDefault();
    this.profundidadArrastre = 0;
    this.arrastrando = false;
    this.soltados = Array.from(evento.dataTransfer?.files ?? []);
  }

  /** "/" lleva al buscador, como en tantas webs; salvo si ya se está escribiendo. */
  @HostListener('document:keydown', ['$event'])
  alPulsarTecla(evento: KeyboardEvent): void {
    const destino = evento.target as HTMLElement;
    const escribiendo = destino.closest('input, textarea, select, [contenteditable="true"]');
    if (evento.key === '/' && !escribiendo && !evento.ctrlKey && !evento.metaKey && !evento.altKey) {
      evento.preventDefault();
      this.buscador?.nativeElement.focus();
    }
  }

  private traeArchivos(evento: DragEvent): boolean {
    return Array.from(evento.dataTransfer?.types ?? []).includes('Files');
  }
}
