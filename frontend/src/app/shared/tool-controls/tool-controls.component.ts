
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

import { PaginaHerramienta } from '../pagina-herramienta';

/**
 * Barra de acciones común: progreso de subida, botón principal, reintento y
 * "empezar de cero". Trabaja sobre la página de herramienta que lo contiene.
 */
@Component({
  selector: 'app-tool-controls',
  imports: [],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './tool-controls.component.html',
  styleUrl: './tool-controls.component.css',
})
export class ToolControlsComponent {
  @Input({ required: true }) pagina!: PaginaHerramienta;
  /** Texto del botón principal, p. ej. "Combinar PDF". */
  @Input({ required: true }) accion!: string;
  @Input() icono = 'bi-play-fill';
}
