
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaConVista } from '../../../shared/pagina-con-vista';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { VistaPaginaComponent } from '../../../shared/vista-pagina/vista-pagina.component';

interface Opcion { id: string; nombre: string; detalle?: string; }

@Component({
  selector: 'app-numerar-paginas',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent, VistaPaginaComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './numerar-paginas.component.html',
})
export class NumerarPaginasComponent extends PaginaConVista {
  protected readonly slug = 'numerar-paginas';
  protected override readonly unoPorUno = true;
  protected override get mensajeExito(): string {
    return 'PDF numerado';
  }

  readonly bordes: Opcion[] = [
    { id: 'abajo', nombre: 'Abajo' },
    { id: 'arriba', nombre: 'Arriba' },
  ];
  readonly alineaciones: Opcion[] = [
    { id: 'izquierda', nombre: 'Izquierda' },
    { id: 'centro', nombre: 'Centro' },
    { id: 'derecha', nombre: 'Derecha' },
  ];
  readonly formatos: Opcion[] = [
    { id: 'numero', nombre: '7', detalle: 'sólo el número' },
    { id: 'de-total', nombre: '7 de 20', detalle: 'con el total' },
    { id: 'pagina-de-total', nombre: 'Página 7 de 20', detalle: 'con todas las letras' },
  ];
  readonly fuentes: Opcion[] = [
    { id: 'sans', nombre: 'Sans' },
    { id: 'serif', nombre: 'Serif' },
    { id: 'mono', nombre: 'Mono' },
  ];
  readonly colores: Opcion[] = [
    { id: 'negro', nombre: 'Negro' },
    { id: 'azul', nombre: 'Azul' },
    { id: 'rojo', nombre: 'Rojo' },
  ];

  borde = 'abajo';
  alineacion = 'centro';
  formato = 'numero';
  fuente = 'sans';
  color = 'negro';
  tamano = 10;
  margen = 15;
  desde = 1;
  empezarEn = 1;

  protected override opciones(): Record<string, unknown> {
    return {
      borde: this.borde, alineacion: this.alineacion, formato: this.formato,
      fuente: this.fuente, color: this.color, tamano: this.tamano,
      margen: this.margen, desde: this.desde, empezar_en: this.empezarEn,
    };
  }

  elegir(campo: 'borde' | 'alineacion' | 'formato' | 'fuente' | 'color', id: string): void {
    this[campo] = id;
    this.alCambiarAjuste();
  }
}
