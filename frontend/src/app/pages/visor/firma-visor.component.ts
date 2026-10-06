import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener, NgZone, Output,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { PizarraComponent } from '../../shared/firma/pizarra.component';
import { FirmaPendiente } from './capa-dibujo.component';

/** Lado mayor con que se guarda la firma: de sobra para una firma, y ligera en el borrador. */
const LADO_MAXIMO = 900;

/**
 * Pedir la firma para estamparla en el visor: dibujarla, o una foto o
 * escaneo suyo. Sale como PNG recortado a lo dibujado, para que al colocarla
 * el recuadro sea la firma y no el lienzo entero.
 *
 * No es una firma digital, y lo dice: para eso está «Firmar con certificado».
 */
@Component({
  selector: 'app-visor-firma',
  imports: [PizarraComponent, RouterLink],
  template: `
    <div class="fondo" (click)="cancelar.emit()"></div>
    <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="titulo-firma">
      <h2 class="h5" id="titulo-firma">Tu firma</h2>
      <app-pizarra (firmada)="usarArchivo($event)"></app-pizarra>
      <p class="mt-3 mb-2 small">
        O usa una foto o un escaneo de ella:
        <label class="btn btn-outline-secondary btn-sm ms-1">
          Elegir imagen
          <input type="file" accept="image/png,image/jpeg" hidden (change)="alElegir($event)">
        </label>
      </p>
      <p class="small text-body-secondary mb-3">
        Es la imagen de tu firma, no una firma digital: para que el documento quede firmado
        de verdad, usa <a routerLink="/herramientas/firmar-certificado" (click)="cancelar.emit()">Firmar con
        certificado</a>.
      </p>
      @if (error) {
        <p class="small text-danger" role="alert">{{ error }}</p>
      }
      <button type="button" class="btn btn-outline-secondary btn-sm" (click)="cancelar.emit()">Cancelar</button>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 1060;
      display: grid;
      place-items: center;
      padding: 1rem;
    }

    .fondo {
      position: absolute;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.4);
    }

    .dialogo {
      position: relative;
      width: min(34rem, 100%);
      max-height: 100%;
      overflow-y: auto;
      padding: 1.25rem;
      border-radius: var(--bs-border-radius-lg);
      background-color: var(--bs-body-bg);
      box-shadow: var(--bs-box-shadow);
    }

    /* ESTRECHA (core/pantalla.ts): a pantalla completa, como las demás ventanas
       en el móvil; con márgenes, la pizarra se quedaba en una tira estrecha. */
    @media (max-width: 575.98px) {
      :host {
        padding: 0;
      }

      .dialogo {
        width: 100%;
        height: 100%;
        border-radius: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisorFirmaComponent {
  @Output() lista = new EventEmitter<FirmaPendiente>();
  @Output() cancelar = new EventEmitter<void>();

  error = '';

  private readonly cd = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    this.cancelar.emit();
  }

  alElegir(evento: Event): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (archivo) {
      this.usarArchivo(archivo);
    }
  }

  async usarArchivo(archivo: File): Promise<void> {
    // `createImageBitmap` resuelve fuera de la zona de Angular: sin volver a
    // ella, el visor recibía la firma y no se repintaba.
    try {
      const firma = await prepararFirma(archivo);
      this.zone.run(() => this.lista.emit(firma));
    } catch {
      this.zone.run(() => {
        this.error = 'No se ha podido leer esa imagen. Prueba con un PNG o un JPEG.';
        this.cd.markForCheck();
      });
    }
  }
}

/**
 * La imagen, recortada a lo que tiene tinta (en un PNG con transparencia) y
 * reducida a `LADO_MAXIMO`, como `data:` PNG.
 */
async function prepararFirma(archivo: File): Promise<FirmaPendiente> {
  const mapa = await createImageBitmap(archivo);
  const lienzo = document.createElement('canvas');
  lienzo.width = mapa.width;
  lienzo.height = mapa.height;
  const contexto = lienzo.getContext('2d', { willReadFrequently: true })!;
  contexto.drawImage(mapa, 0, 0);
  mapa.close();

  const [x0, y0, x1, y1] = conTinta(contexto, lienzo.width, lienzo.height);
  const ancho = x1 - x0;
  const alto = y1 - y0;
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  const salida = document.createElement('canvas');
  salida.width = Math.max(1, Math.round(ancho * escala));
  salida.height = Math.max(1, Math.round(alto * escala));
  salida.getContext('2d')!.drawImage(lienzo, x0, y0, ancho, alto, 0, 0, salida.width, salida.height);
  return { datos: salida.toDataURL('image/png'), relacion: salida.width / salida.height };
}

/** El rectángulo con algo pintado, con un pequeño margen; entera si no es transparente. */
function conTinta(contexto: CanvasRenderingContext2D, ancho: number,
                  alto: number): [number, number, number, number] {
  const { data } = contexto.getImageData(0, 0, ancho, alto);
  let [x0, y0, x1, y1] = [ancho, alto, -1, -1];
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (data[(y * ancho + x) * 4 + 3] > 16) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) {
    return [0, 0, ancho, alto];
  }
  const margen = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  return [Math.max(0, x0 - margen), Math.max(0, y0 - margen),
          Math.min(ancho, x1 + margen + 1), Math.min(alto, y1 + margen + 1)];
}
