
import { Component, ChangeDetectionStrategy } from '@angular/core';

import { FirmaEncontrada, InformeFirmas } from '../../../core/api.service';
import { ArchivoEnCola, FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';

/**
 * Comprobar las firmas digitales de un PDF.
 *
 * Es la única herramienta que **no genera ningún archivo**: sólo mira y cuenta.
 * Por eso no lleva `app-tool-controls` ni botón de ejecutar, y el informe se
 * pide en cuanto el archivo termina de subir, igual que la inspección de
 * "Editar metadatos".
 */
@Component({
  selector: 'app-comprobar-firmas',
  imports: [FileQueueComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './comprobar-firmas.component.html',
})
export class ComprobarFirmasComponent extends PaginaHerramienta {
  protected readonly slug = 'comprobar-firmas';

  informes: InformeFirmas[] = [];
  comprobando = false;

  /** Los archivos se comprueban en cuanto están arriba. */
  protected override alTerminarSubida(): void {
    const ids = this.archivos.filter(a => a.estado === 'subido').map(a => a.id!);
    if (ids.length === 0) {
      this.informes = [];
      return;
    }
    this.comprobando = true;
    this.api.comprobarFirmas(ids).subscribe({
      next: informes => {
        this.comprobando = false;
        this.informes = informes;
      },
      error: err => {
        this.comprobando = false;
        this.informes = [];
        avisoError(mensajeDeError(err, 'No se han podido comprobar las firmas.'));
      },
    });
  }

  alQuitar(): void {
    if (this.archivos.length === 0) {
      this.informes = [];
    }
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.informes = [];
  }

  /**
   * El semáforo de una firma, que es lo primero que se mira.
   *
   * Una firma puede estar perfectamente intacta y aun así no cubrir el archivo
   * entero: alguien añadió páginas después de firmar. Eso no es "válida" ni
   * "rota", es "cuidado", y merece su propio color.
   */
  estado(firma: FirmaEncontrada): 'bien' | 'aviso' | 'mal' | 'desconocido' {
    if (firma.error || firma.intacta === null) {
      return 'desconocido';
    }
    if (!firma.intacta) {
      return 'mal';
    }
    return firma.cobertura === 'todo' ? 'bien' : 'aviso';
  }

  titular(firma: FirmaEncontrada): string {
    return {
      bien: 'Firma correcta: el documento no ha cambiado',
      aviso: 'Firma correcta, pero se añadió algo después',
      mal: 'El documento se ha modificado después de firmarlo',
      desconocido: 'No se ha podido comprobar',
    }[this.estado(firma)];
  }

  fecha(valor: string | null): string {
    return valor ? new Date(valor).toLocaleString('es-ES') : 'sin fecha';
  }

  get sinFirmas(): boolean {
    return this.informes.length > 0 && this.informes.every(i => i.firmas.length === 0);
  }
}
