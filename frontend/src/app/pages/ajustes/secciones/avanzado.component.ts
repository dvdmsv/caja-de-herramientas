import { ChangeDetectionStrategy, Component } from '@angular/core';

import {
  Avanzado, DE_SERIE, RANGOS, avanzadoDeSerie, esUrlSegura, fueraDeRango, textoDeMegas,
} from '../../../core/ajustes-escritorio';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/**
 * Memoria, prioridad y límites. Se aplican al volver a abrir la aplicación: la
 * memoria y la prioridad van en el job de Windows del backend (`trabajo.rs`), y
 * los límites son variables de entorno con las que arranca (`ajustes.rs`).
 *
 * Los números se validan aquí para decirlo al escribir; quien los recorta de
 * verdad es `ajustes.rs`.
 */
@Component({
  selector: 'app-ajustes-avanzado',
  imports: [FilaAjusteComponent],
  template: `
    <div class="alert alert-warning d-flex gap-2 align-items-start" role="note">
      <i class="bi bi-exclamation-triangle mt-1" aria-hidden="true"></i>
      <div>
        Para quien sepa lo que toca. Con valores muy bajos, algunas herramientas dejarán de funcionar
        con documentos grandes. <strong>Se aplica al volver a abrir la aplicación.</strong>
      </div>
    </div>

    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Memoria máxima"
        [detalle]="'Lo que pueden usar los trabajos, con todo lo que lancen (LibreOffice, el OCR…). De serie, el ' + serie.memoriaPorcentaje + ' % de la RAM.'">
        <select class="form-select" aria-label="Memoria máxima" [disabled]="ocupada"
          (change)="memoria($any($event.target).value)">
          <option value="" [selected]="av.memoria_porcentaje === null">De serie ({{ serie.memoriaPorcentaje }} %)</option>
          @for (p of porcentajes; track p) {
            <option [value]="p" [selected]="av.memoria_porcentaje === p">{{ p }} % de la RAM</option>
          }
          <option value="0" [selected]="av.memoria_porcentaje === 0">Sin límite</option>
        </select>
      </app-fila-ajuste>

      <app-fila-ajuste titulo="Trabajar con prioridad baja"
        detalle="Los trabajos usan toda la CPU libre pero ceden en cuanto usas el equipo. Sin ella acaban antes, pero el equipo puede ir a tirones.">
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" role="switch" aria-label="Trabajar con prioridad baja"
            [checked]="av.prioridad_baja !== false" [disabled]="ocupada"
            (change)="cambiar.emit({ avanzado: { prioridad_baja: $any($event.target).checked ? null : false } })">
        </div>
      </app-fila-ajuste>

      <app-fila-ajuste titulo="Lo más que se sube de una vez"
        [detalle]="'La suma de los archivos de una subida. De serie, ' + megas(serie.subidaMaxMb) + '.'">
        <div class="input-group numero">
          <input type="number" class="form-control" aria-label="Lo más que se sube de una vez, en MB"
            [min]="rangos.subidaMaxMb[0]" [max]="rangos.subidaMaxMb[1]" step="1"
            [placeholder]="serie.subidaMaxMb" [value]="av.subida_max_mb ?? ''" [disabled]="ocupada"
            (change)="numero('subida_max_mb', 'subidaMaxMb', $any($event.target).value)">
          <span class="input-group-text">MB</span>
        </div>
        @if (errores['subida_max_mb']) {
          <p debajo class="small text-danger mt-1 mb-0" role="alert">{{ errores['subida_max_mb'] }}</p>
        }
      </app-fila-ajuste>

      <app-fila-ajuste titulo="Espacio para cada ventana"
        [detalle]="'Lo que pueden ocupar las subidas y los resultados de una ventana. De serie, ' + megas(serie.cuotaMb) + '.'">
        <div class="input-group numero">
          <input type="number" class="form-control" aria-label="Espacio para cada ventana, en MB"
            [min]="rangos.cuotaMb[0]" [max]="rangos.cuotaMb[1]" step="1"
            [placeholder]="serie.cuotaMb" [value]="av.cuota_mb ?? ''" [disabled]="ocupada"
            (change)="numero('cuota_mb', 'cuotaMb', $any($event.target).value)">
          <span class="input-group-text">MB</span>
        </div>
        @if (errores['cuota_mb']) {
          <p debajo class="small text-danger mt-1 mb-0" role="alert">{{ errores['cuota_mb'] }}</p>
        }
      </app-fila-ajuste>

      <app-fila-ajuste titulo="Servidor de sello de tiempo"
        detalle="El que usan «Firmar con certificado» y «Marca de tiempo». Sólo le llega un resumen criptográfico, nunca el documento.">
        <input type="url" class="form-control url" aria-label="Servidor de sello de tiempo"
          [placeholder]="serie.selloTiempo" [value]="av.sello_tiempo ?? ''" [disabled]="ocupada"
          (change)="sello($any($event.target).value)">
        @if (errores['sello_tiempo']) {
          <p debajo class="small text-danger mt-1 mb-0" role="alert">{{ errores['sello_tiempo'] }}</p>
        }
      </app-fila-ajuste>
    </div>

    <div class="mt-3">
      <button type="button" class="btn btn-outline-secondary" [disabled]="ocupada || deSerie"
        (click)="restablecer()">
        <i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Volver a los valores de serie
      </button>
    </div>
  `,
  styles: `
    .numero { width: 10rem; }
    .url { width: 16rem; }
    /* ESTRECHA (core/pantalla.ts): bajo el texto, a todo el ancho. */
    @media (max-width: 575.98px) { .numero, .url { width: 100%; } }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesAvanzadoComponent extends SeccionAjustes {
  readonly serie = DE_SERIE;
  readonly rangos = RANGOS;
  readonly porcentajes = [30, 40, 50, 70, 80, 90];
  readonly megas = textoDeMegas;
  errores: Partial<Record<keyof Avanzado, string>> = {};

  get av(): Avanzado {
    return this.ajustes.avanzado;
  }

  get deSerie(): boolean {
    return avanzadoDeSerie(this.av);
  }

  memoria(valor: string): void {
    this.cambiar.emit({ avanzado: { memoria_porcentaje: valor === '' ? null : Number(valor) } });
  }

  /** Vacío es «el de serie»; fuera de rango se dice y no se guarda. */
  numero(campo: 'subida_max_mb' | 'cuota_mb', rango: keyof typeof RANGOS, texto: string): void {
    if (texto.trim() === '') {
      delete this.errores[campo];
      this.cambiar.emit({ avanzado: { [campo]: null } });
      return;
    }
    const error = fueraDeRango(rango, Number(texto));
    if (error) {
      this.errores[campo] = error;
      return;
    }
    delete this.errores[campo];
    this.cambiar.emit({ avanzado: { [campo]: Number(texto) } });
  }

  sello(texto: string): void {
    const url = texto.trim();
    if (url && !esUrlSegura(url)) {
      this.errores.sello_tiempo = 'Tiene que empezar por https:// y no llevar espacios.';
      return;
    }
    delete this.errores.sello_tiempo;
    this.cambiar.emit({ avanzado: { sello_tiempo: url || null } });
  }

  restablecer(): void {
    this.errores = {};
    this.cambiar.emit({
      avanzado: { memoria_porcentaje: null, prioridad_baja: null, subida_max_mb: null, cuota_mb: null, sello_tiempo: null },
    });
  }
}
