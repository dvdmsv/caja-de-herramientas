import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { UsoService } from '../../core/uso.service';
import { avisoError, avisoExito, mensajeDeError } from '../notify';
import { PesoPipe } from '../peso.pipe';
import { NivelDeUso, horaDeBorrado, nivelDeUso, porcentajeDeUso } from '../uso';

/**
 * Cuánto ocupa la sesión en el servidor, siempre a la vista en la barra.
 *
 * Existe para que el tope no sea una sorpresa: antes sólo se veía dentro de una
 * herramienta y después de subir algo, así que quien volvía con la sesión
 * llena se enteraba con el error. Al pulsarlo se abre el detalle: cuándo se
 * borrarán los archivos y un botón para vaciarla, que es la única forma de
 * liberar sitio sin tener archivos en la cola de una herramienta.
 */
@Component({
  selector: 'app-uso-sesion',
  imports: [AsyncPipe, PesoPipe],
  templateUrl: './uso-sesion.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './uso-sesion.component.css',
})
export class UsoSesionComponent implements OnInit {
  private readonly servicio = inject(UsoService);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);

  readonly uso = this.servicio.uso;

  abierto = false;
  /** Vaciar no se puede deshacer: se pide una segunda pulsación. */
  confirmando = false;
  vaciando = false;

  constructor() {
    inject(Router).events
      .pipe(filter(evento => evento instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.cerrar());
  }

  ngOnInit(): void {
    this.servicio.refrescar();
  }

  nivel(usado: number, tope: number): NivelDeUso {
    return nivelDeUso(usado, tope);
  }

  porcentaje(usado: number, tope: number): number {
    return porcentajeDeUso(usado, tope);
  }

  cuando(caduca: number): string {
    return horaDeBorrado(caduca);
  }

  alternar(): void {
    if (this.abierto) {
      this.cerrar();
      return;
    }
    // Al abrir se vuelve a preguntar: el dato puede tener un rato.
    this.servicio.refrescar();
    this.abierto = true;
  }

  vaciar(): void {
    this.vaciando = true;
    this.servicio.vaciar().subscribe({
      next: () => {
        this.vaciando = false;
        this.confirmando = false;
        avisoExito('Sesión vaciada');
      },
      error: err => {
        this.vaciando = false;
        avisoError(mensajeDeError(err, 'No se han podido borrar los archivos.'));
      },
    });
  }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(evento: MouseEvent): void {
    // Con la ruta del evento y no con `contains`: al pulsar «Vaciar ahora» ese
    // botón se sustituye por la confirmación, y para cuando llega aquí ya no
    // está dentro del componente.
    if (this.abierto && !evento.composedPath().includes(this.elemento.nativeElement)) {
      this.cerrar();
    }
  }

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    if (this.abierto) {
      this.cerrar();
      // El foco vuelve al botón: si no, se queda en el limbo.
      this.elemento.nativeElement.querySelector<HTMLElement>('.uso__boton')?.focus();
    }
  }

  private cerrar(): void {
    this.abierto = false;
    this.confirmando = false;
  }
}
