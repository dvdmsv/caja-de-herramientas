import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { FavoritosService } from '../../core/favoritos.service';

/**
 * La estrella que marca una herramienta como favorita, en las tarjetas del
 * inicio y en la cabecera de cada herramienta.
 *
 * Es un botón de alternar: la etiqueta no cambia y `aria-pressed` dice si está
 * marcada, que es como lo anuncia un lector de pantalla. Lo que cambia es el
 * `title`, para quien pasa el ratón.
 */
@Component({
  selector: 'app-estrella',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button type="button" class="estrella" [class.estrella--marcada]="marcada"
      [attr.aria-pressed]="marcada" [attr.aria-label]="'Favorita: ' + nombre"
      [title]="marcada ? 'Quitar de favoritas' : 'Añadir a favoritas'"
      (click)="favoritos.alternar(slug)">
      <i class="bi" [class.bi-star-fill]="marcada" [class.bi-star]="!marcada" aria-hidden="true"></i>
    </button>
  `,
  styleUrl: './estrella.component.css',
})
export class EstrellaComponent {
  @Input({ required: true }) slug!: string;
  /** Para la etiqueta: «Favorita: Unir PDF». */
  @Input({ required: true }) nombre!: string;

  protected readonly favoritos = inject(FavoritosService);

  get marcada(): boolean {
    return this.favoritos.es(this.slug);
  }
}
