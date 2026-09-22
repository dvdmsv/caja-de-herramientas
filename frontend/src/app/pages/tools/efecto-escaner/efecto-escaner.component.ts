import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaConVista } from '../../../shared/pagina-con-vista';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { VistaPaginaComponent } from '../../../shared/vista-pagina/vista-pagina.component';

interface Modo {
  id: string;
  nombre: string;
  ayuda: string;
}

/** Coinciden con `MODOS` de `backend/api/escaneo.py`, que rechaza los demás. */
const MODOS: Modo[] = [
  {
    id: 'blanco-y-negro',
    nombre: 'Blanco y negro',
    ayuda: 'Lo que más ayuda a leerlo y al OCR. Sale en PNG, que no ensucia los bordes.',
  },
  {
    id: 'gris',
    nombre: 'Grises',
    ayuda: 'Conserva los tonos: mejor si hay lápiz, sellos flojos o fotos.',
  },
  {
    id: 'color',
    nombre: 'Color',
    ayuda: 'Blanquea el papel y deja el color como estaba: firmas azules, logotipos.',
  },
];

@Component({
  selector: 'app-efecto-escaner',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
    VistaPaginaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './efecto-escaner.component.html',
})
export class EfectoEscanerComponent extends PaginaConVista {
  protected readonly slug = 'efecto-escaner';
  protected override get mensajeExito(): string {
    return 'Imágenes limpiadas';
  }

  readonly modos = MODOS;
  modo = 'blanco-y-negro';
  intensidad = 50;

  elegirModo(id: string): void {
    this.modo = id;
    this.alCambiarAjuste();
  }

  protected override opciones(): Record<string, unknown> {
    return { modo: this.modo, intensidad: this.intensidad };
  }
}
