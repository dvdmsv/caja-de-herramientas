import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output,
  ViewChild, inject,
  ChangeDetectionStrategy
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { ApiService, ArchivoServidor } from '../../core/api.service';
import { TraspasoService } from '../../core/traspaso.service';
import { PesoPipe } from '../peso.pipe';
import { TipoVistaPrevia, tipoDeVistaPrevia } from '../tipos-archivo';
import { avisoError, mensajeDeError } from '../notify';

/**
 * Ventana para ver un resultado sin descargarlo.
 *
 * El archivo se trae por `ApiService` y se pinta desde un object URL: la sesión
 * va en una cabecera, así que apuntar directamente a la API no funcionaría.
 *
 * Los PDF los enseña el visor del propio navegador dentro de un `iframe`. Es a
 * propósito: esta ventana la usan las quince herramientas, y traer pdf.js aquí
 * le costaría ~105 kB a las once que hoy no lo cargan.
 *
 * Pero Chrome en Android no tiene ese visor: el `iframe` sale en blanco. Lo
 * dice `navigator.pdfViewerEnabled`, y entonces se ofrece abrir el archivo en
 * el visor de la aplicación, que sí trae pdf.js y ya sabe recibir traspasos.
 */

/** Por encima de esto el texto se recorta: un `<pre>` de diez megas cuelga la página. */
const MAXIMO_TEXTO = 1024 * 1024;

@Component({
  selector: 'app-vista-previa',
  imports: [NgIf, NgSwitch, NgSwitchCase, PesoPipe],
  templateUrl: './vista-previa.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './vista-previa.component.css',
})
export class VistaPreviaComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly traspaso = inject(TraspasoService);

  /** Si el navegador pinta PDF en un `iframe`. Sin la propiedad, se supone que sí. */
  readonly pdfEnLinea = navigator.pdfViewerEnabled !== false;

  @ViewChild('botonCerrar') botonCerrar?: ElementRef<HTMLButtonElement>;

  @Input() archivo: ArchivoServidor | null = null;
  @Output() cerrado = new EventEmitter<void>();

  tipo: TipoVistaPrevia | null = null;
  cargando = false;

  /** Lo descargado, para poder pasárselo al visor sin volver a pedirlo. */
  private contenido: Blob | null = null;

  /** Object URL del archivo; hay que revocarlo al cerrar. */
  private url = '';
  /** El mismo, ya aprobado para el `iframe`: Angular no admite `blob:` sin esto. */
  urlSegura: SafeResourceUrl | null = null;
  imagen = '';
  texto = '';
  recortado = false;

  ngOnChanges(): void {
    this.olvidar();
    if (this.archivo) {
      this.tipo = tipoDeVistaPrevia(this.archivo.name);
      this.cargar(this.archivo);
    }
  }

  ngOnDestroy(): void {
    this.olvidar();
  }

  @HostListener('document:keydown.escape')
  cerrar(): void {
    if (this.archivo) {
      this.cerrado.emit();
    }
  }

  /** Sólo cierra si se pulsa el fondo, no el contenido de la ventana. */
  alPulsarFuera(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) {
      this.cerrar();
    }
  }

  descargar(): void {
    if (!this.archivo) {
      return;
    }
    this.api.descargar(this.archivo).subscribe({
      error: err => avisoError(mensajeDeError(err, 'No se ha podido descargar el archivo.')),
    });
  }

  private cargar(archivo: ArchivoServidor): void {
    this.cargando = true;
    this.api.contenido(archivo).subscribe({
      next: blob => {
        this.cargando = false;
        // Puede haberse cerrado mientras bajaba: entonces esto ya no vale.
        if (this.archivo?.id !== archivo.id) {
          return;
        }
        this.mostrar(blob);
        setTimeout(() => this.botonCerrar?.nativeElement.focus());
      },
      error: err => {
        this.cargando = false;
        this.cerrado.emit();
        avisoError(mensajeDeError(err, 'No se ha podido abrir el archivo.'));
      },
    });
  }

  /** Para el navegador que no enseña PDF: abrirlo en el visor de la aplicación. */
  abrirEnVisor(): void {
    if (!this.archivo || !this.contenido) {
      return;
    }
    this.traspaso.dejar([new File([this.contenido], this.archivo.name, { type: 'application/pdf' })]);
    this.cerrado.emit();
    this.router.navigateByUrl('/visor');
  }

  private mostrar(blob: Blob): void {
    this.contenido = blob;
    if (this.tipo === 'texto') {
      blob.slice(0, MAXIMO_TEXTO).text().then(texto => {
        this.texto = texto;
        this.recortado = blob.size > MAXIMO_TEXTO;
      });
      return;
    }

    this.url = URL.createObjectURL(blob);
    if (this.tipo === 'imagen') {
      this.imagen = this.url;
    } else {
      this.urlSegura = this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
    }
  }

  /** Suelta el object URL: lo dibujado no debe sobrevivir a la ventana. */
  private olvidar(): void {
    if (this.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.url);
    }
    this.url = '';
    this.contenido = null;
    this.urlSegura = null;
    this.imagen = '';
    this.texto = '';
    this.recortado = false;
  }
}
