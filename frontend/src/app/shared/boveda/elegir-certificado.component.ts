import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output, inject,
} from '@angular/core';

import { BovedaService, CertificadoElegido } from '../../core/boveda.service';
import { CertificadoGuardado } from '../../core/boveda/contenido';
import { asegurarAbierta } from './dialogos';

/**
 * Los certificados de la bóveda, para elegir uno en «Firmar con certificado».
 * Entrega el `.p12` en base64 y su contraseña si se guardó con él. Fuera de la
 * aplicación no pinta nada.
 */
@Component({
  selector: 'app-elegir-certificado',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (boveda.disponible) {
      @if (!boveda.abierta) {
        <button type="button" class="btn btn-outline-primary" [disabled]="deshabilitado" (click)="abrir()">
          <i class="bi bi-safe2 me-1" aria-hidden="true"></i>{{ textoAbrir }}
        </button>
      } @else if (boveda.contenido.certificados.length === 0) {
        <p class="text-body-secondary mb-0">
          Aún no tienes certificados guardados. Elige el archivo aquí abajo y, cuando se compruebe,
          pulsa «Guardar en la bóveda».
        </p>
      } @else {
        <div class="list-group">
          @for (certificado of boveda.contenido.certificados; track certificado.id) {
            <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2"
              [disabled]="deshabilitado" (click)="elegir(certificado)">
              <i class="bi bi-file-earmark-lock2 text-body-secondary" aria-hidden="true"></i>
              <span class="flex-grow-1 text-start">
                <span class="d-block fw-semibold">{{ certificado.nombre }}</span>
                <span class="d-block small text-body-secondary">{{ certificado.titular }}</span>
              </span>
              @if (!certificado.contrasena) {
                <span class="small text-body-secondary">pide contraseña</span>
              }
            </button>
          }
        </div>
      }
    }
  `,
})
export class ElegirCertificadoComponent implements OnInit {
  @Input() deshabilitado = false;
  @Output() elegido = new EventEmitter<CertificadoElegido>();

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

  elegir(certificado: CertificadoGuardado): void {
    this.elegido.emit(this.boveda.usarCertificado(certificado));
  }
}
