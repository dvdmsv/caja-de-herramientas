import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Una fila de ajuste, como en la Configuración de Windows 11: a la izquierda qué
 * es y una línea que lo explica, a la derecha el control. Lo de debajo del texto
 * (un resultado, una advertencia) va con el atributo `debajo`.
 *
 * El control lo pone quien la usa, con su propio `aria-label` o su `<label>`:
 * aquí no se sabe si es un interruptor, un desplegable o un botón.
 */
@Component({
  selector: 'app-fila-ajuste',
  template: `
    <div class="fila">
      <div class="fila__texto">
        <div class="fila__titulo">{{ titulo }}</div>
        @if (detalle) {
          <div class="fila__detalle">{{ detalle }}</div>
        }
        <ng-content select="[debajo]"></ng-content>
      </div>
      <div class="fila__control"><ng-content></ng-content></div>
    </div>
  `,
  styleUrl: './fila-ajuste.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FilaAjusteComponent {
  @Input({ required: true }) titulo = '';
  @Input() detalle = '';
}
