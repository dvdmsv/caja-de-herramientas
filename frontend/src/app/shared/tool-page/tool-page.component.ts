
import { Component, Input, OnDestroy, OnInit, ChangeDetectionStrategy, forwardRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RecientesService } from '../../core/recientes.service';
import { ClaveCategoria, Herramienta, buscarPorSlug, claveDeCategoria } from '../../core/tools';
import { TraspasoService } from '../../core/traspaso.service';
import { ColaReceptora, MARCO_HERRAMIENTA, MarcoHerramienta } from '../marco-herramienta';

/**
 * Marco común de todas las páginas de herramienta: migas de pan, título y
 * descripción sacados del catálogo. El contenido concreto llega por proyección.
 *
 * También tiñe la página del color de su categoría, marcando
 * `<html data-categoria>` (ver `estilos/tema.css`). Va en `<html>` y no en este
 * elemento para que lo hereden también el menú y los diálogos, que se pintan
 * fuera de aquí.
 *
 * Y es quien entrega los archivos que llegan de otra herramienta ("Usar en…" o
 * soltados en el inicio): se los pasa a la primera cola de subida que se
 * registre, que los trata como si el usuario los hubiera soltado. Así cada
 * página sube y reacciona a su manera sin saber nada de traspasos.
 */
@Component({
  selector: 'app-tool-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.Eager,
  // `providers` y no `viewProviders`: la cola de subida llega por proyección y
  // tiene que poder encontrar este marco.
  providers: [{ provide: MARCO_HERRAMIENTA, useExisting: forwardRef(() => ToolPageComponent) }],
  template: `
    <div class="contenido-estrecho">
      <nav aria-label="Ruta de navegación">
        <ol class="breadcrumb small">
          <li class="breadcrumb-item"><a routerLink="/">Inicio</a></li>
          <li class="breadcrumb-item active" aria-current="page">{{ herramienta?.nombre }}</li>
        </ol>
      </nav>
    
      @if (herramienta; as h) {
        <header class="mb-4">
          <h1 class="h3 d-flex align-items-center gap-3">
            <span class="pastilla pastilla--lg" aria-hidden="true"><i class="bi {{ h.icono }}"></i></span>
            {{ h.nombre }}
          </h1>
          <p class="text-body-secondary mb-0">{{ h.descripcion }}</p>
        </header>
      }
    
      <ng-content></ng-content>
    </div>
    `,
})
export class ToolPageComponent implements OnInit, OnDestroy, MarcoHerramienta {
  /** Slug de la herramienta en `core/tools.ts`. */
  @Input({ required: true }) slug!: string;

  herramienta?: Herramienta;

  private categoria?: ClaveCategoria;
  private colaPrincipal?: ColaReceptora;
  private readonly traspaso = inject(TraspasoService);
  private readonly recientes = inject(RecientesService);

  registrarCola(cola: ColaReceptora): void {
    if (this.colaPrincipal) {
      return;
    }
    this.colaPrincipal = cola;
    const llegados = this.traspaso.tomar();
    if (llegados.length > 0) {
      // Fuera del ciclo de detección en curso: recibir dispara la subida y
      // cambia el estado de la página mientras Angular aún la está pintando.
      setTimeout(() => cola.recibir(llegados));
    }
  }

  ngOnInit(): void {
    this.herramienta = buscarPorSlug(this.slug);
    this.recientes.anotar(this.slug);
    if (this.herramienta) {
      this.categoria = claveDeCategoria(this.herramienta.categoria);
      document.documentElement.dataset['categoria'] = this.categoria;
    }
  }

  ngOnDestroy(): void {
    // Sólo si sigue siendo la suya: al saltar de una herramienta a otra, no
    // borrar la marca que acaba de poner la siguiente.
    if (document.documentElement.dataset['categoria'] === this.categoria) {
      delete document.documentElement.dataset['categoria'];
    }
  }
}
