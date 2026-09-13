
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ClaveCategoria, Grupo, Herramienta, agruparPorCategoria, claveDeCategoria, rutaDe } from '../../core/tools';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './home.component.css',
})
export class HomeComponent {
  /** La portada sí anuncia las herramientas que aún no están listas. */
  readonly grupos: Grupo[] = agruparPorCategoria(true);

  rutaDe(herramienta: Herramienta): string {
    return rutaDe(herramienta);
  }

  clave(grupo: Grupo): ClaveCategoria {
    return claveDeCategoria(grupo.categoria);
  }
}
