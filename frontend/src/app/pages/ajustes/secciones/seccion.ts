import { Directive, EventEmitter, Input, Output, inject } from '@angular/core';

import { CambiosAjustes, EstadoAjustes } from '../../../core/ajustes-escritorio';
import { EscritorioService } from '../../../core/escritorio.service';

/**
 * Lo común a las secciones de Ajustes: reciben los ajustes y avisan de lo que
 * cambia. Quien guarda es la página (`ajustes.component.ts`), que así dice en un
 * solo sitio «Guardado» o por qué no se ha podido.
 */
@Directive()
export abstract class SeccionAjustes {
  protected readonly escritorio = inject(EscritorioService);

  @Input({ required: true }) estado!: EstadoAjustes;
  @Input() ocupada = false;
  @Output() readonly cambiar = new EventEmitter<CambiosAjustes>();
  /** Para lo que cambia sin pasar por `cambiar` (un diálogo): el estado nuevo. */
  @Output() readonly nuevoEstado = new EventEmitter<EstadoAjustes>();

  get ajustes() {
    return this.estado.ajustes;
  }
}
