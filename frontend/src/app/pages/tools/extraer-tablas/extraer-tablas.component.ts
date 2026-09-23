import { Component, ChangeDetectionStrategy } from '@angular/core';

import { TablaDetectada } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { mensajeDeError } from '../../../shared/notify';

@Component({
  selector: 'app-extraer-tablas',
  imports: [FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './extraer-tablas.component.html',
})
export class ExtraerTablasComponent extends PaginaHerramienta {
  protected readonly slug = 'extraer-tablas';
  protected override get mensajeExito(): string {
    return 'Tablas extraídas';
  }

  formato = 'xlsx';

  /** Lo que se ha detectado, o `null` si aún no se ha mirado. */
  tablas: TablaDetectada[] | null = null;
  buscando = false;
  problema = '';

  /** Cuál es la petición vigente: cambiar de documento deja obsoleta la anterior. */
  private peticion = 0;

  elegirFormato(valor: string): void {
    this.formato = valor;
    this.alCambiarLista();
  }

  protected override opciones(): Record<string, unknown> {
    return { formato: this.formato };
  }

  /** En cuanto el PDF está arriba se mira qué trae dentro. */
  protected override alTerminarSubida(): void {
    this.buscar();
  }

  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (!this.documento) {
      this.olvidar();
    }
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.olvidar();
  }

  /** Las páginas donde hay tablas, dichas como las diría una persona. */
  get paginasConTablas(): string {
    const paginas = [...new Set((this.tablas ?? []).map(tabla => tabla.pagina))];
    if (paginas.length === 1) {
      return `la página ${paginas[0]}`;
    }
    return `las páginas ${paginas.slice(0, -1).join(', ')} y ${paginas[paginas.length - 1]}`;
  }

  private get documento(): string | null {
    return this.archivos.find(archivo => archivo.estado === 'subido')?.id ?? null;
  }

  private buscar(): void {
    const id = this.documento;
    if (!id) {
      this.olvidar();
      return;
    }

    const mia = ++this.peticion;
    this.buscando = true;
    this.api.inspeccionarTablas(id).subscribe({
      next: encontradas => {
        if (mia !== this.peticion) {
          return;
        }
        this.buscando = false;
        this.problema = '';
        this.tablas = encontradas.tablas;
      },
      error: err => {
        if (mia !== this.peticion) {
          return;
        }
        this.buscando = false;
        this.tablas = null;
        this.problema = mensajeDeError(err, 'No se ha podido mirar el documento.');
      },
    });
  }

  private olvidar(): void {
    this.peticion++;
    this.buscando = false;
    this.tablas = null;
    this.problema = '';
  }
}
