import { Component, ChangeDetectionStrategy } from '@angular/core';

import { CodigoLeido, InformeCodigos } from '../../../core/api.service';
import { CampoLeido, desglosar } from '../../../shared/codigos';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, avisoExito, mensajeDeError } from '../../../shared/notify';
import { copiarAlPortapapeles } from '../../../shared/portapapeles';

/**
 * Leer códigos QR y de barras.
 *
 * Como "Comprobar firmas", **no genera ningún archivo**: sólo mira y cuenta. Por
 * eso no lleva `app-tool-controls` ni botón de ejecutar, y el informe se pide en
 * cuanto los archivos terminan de subir.
 */
@Component({
  selector: 'app-leer-codigo',
  imports: [FileQueueComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './leer-codigo.component.html',
})
export class LeerCodigoComponent extends PaginaHerramienta {
  protected readonly slug = 'leer-codigo';

  informes: InformeCodigos[] = [];
  leyendo = false;

  protected override alTerminarSubida(): void {
    const ids = this.archivos.filter(a => a.estado === 'subido').map(a => a.id!);
    if (ids.length === 0) {
      this.informes = [];
      return;
    }
    this.leyendo = true;
    this.api.leerCodigos(ids).subscribe({
      next: informes => {
        this.leyendo = false;
        this.informes = informes;
      },
      error: err => {
        this.leyendo = false;
        this.informes = [];
        avisoError(mensajeDeError(err, 'No se han podido leer los códigos.'));
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

  get sinCodigos(): boolean {
    return this.informes.length > 0 && this.informes.every(i => i.codigos.length === 0);
  }

  /** Los campos legibles de un código, o vacío si se lee tal cual. */
  campos(codigo: CodigoLeido): CampoLeido[] {
    return desglosar(codigo.clase, codigo.contenido);
  }

  /** Si el contenido es un enlace, para ofrecerlo como tal. */
  esEnlace(codigo: CodigoLeido): boolean {
    return codigo.clase === 'enlace';
  }

  icono(codigo: CodigoLeido): string {
    return {
      wifi: 'bi-wifi',
      correo: 'bi-envelope',
      telefono: 'bi-telephone',
      contacto: 'bi-person-vcard',
      enlace: 'bi-link-45deg',
      evento: 'bi-calendar-event',
    }[codigo.clase] ?? 'bi-upc-scan';
  }

  copiar(codigo: CodigoLeido): void {
    copiarAlPortapapeles(codigo.contenido)
      .then(() => avisoExito('Copiado al portapapeles'))
      .catch(() => avisoError('No se ha podido copiar. Selecciónalo y cópialo a mano.'));
  }
}
