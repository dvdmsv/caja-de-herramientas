import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output, inject,
} from '@angular/core';

import { BovedaService } from '../../core/boveda.service';
import { FirmaGuardada } from '../../core/boveda/contenido';
import { asegurarAbierta } from './dialogos';

/**
 * Las firmas de la bóveda, para elegir una. Entrega un `File`, igual que la
 * pizarra o una subida, así que quien lo usa no distingue de dónde viene.
 * Fuera de la aplicación no pinta nada.
 */
@Component({
  selector: 'app-elegir-firma',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (boveda.disponible) {
      @if (!boveda.abierta) {
        <button type="button" class="btn btn-outline-primary" [disabled]="deshabilitado" (click)="abrir()">
          <i class="bi bi-safe2 me-1" aria-hidden="true"></i>{{ textoAbrir }}
        </button>
      } @else if (boveda.contenido.firmas.length === 0) {
        <p class="text-body-secondary mb-0">
          Aún no tienes firmas guardadas. Dibuja o sube una y pulsa «Guardar en la bóveda».
        </p>
      } @else {
        <div class="firmas">
          @for (firma of boveda.contenido.firmas; track firma.id) {
            <button type="button" class="firma" [disabled]="deshabilitado"
              [attr.aria-label]="'Usar «' + firma.nombre + '»'" (click)="elegir(firma)">
              <img [src]="boveda.miniatura(firma)" alt="">
              <span class="firma__nombre">{{ firma.nombre }}</span>
            </button>
          }
        </div>
      }
    }
  `,
  styleUrl: './elegir-firma.component.css',
})
export class ElegirFirmaComponent implements OnInit {
  @Input() deshabilitado = false;
  @Output() elegida = new EventEmitter<File>();

  protected readonly boveda = inject(BovedaService);
  private readonly cd = inject(ChangeDetectorRef);

  async ngOnInit(): Promise<void> {
    await this.boveda.comprobar();
    this.cd.markForCheck();
  }

  get textoAbrir(): string {
    return this.boveda.estado === 'sin-crear' ? 'Crear la bóveda' : 'Abrir la bóveda';
  }

  /** Con `markForCheck`: el visor pinta este componente dentro de uno `OnPush`. */
  async abrir(): Promise<void> {
    await asegurarAbierta(this.boveda);
    this.cd.markForCheck();
  }

  elegir(firma: FirmaGuardada): void {
    this.elegida.emit(this.boveda.firmaComoArchivo(firma));
  }
}
