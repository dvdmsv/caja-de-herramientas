import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CambiosAjustes, EstadoAjustes, SECCIONES, Seccion, seccionDe } from '../../core/ajustes-escritorio';
import { EscritorioService } from '../../core/escritorio.service';
import { mensajeDeError } from '../../shared/notify';
import { AjustesActualizacionesComponent } from './secciones/actualizaciones.component';
import { AjustesAvanzadoComponent } from './secciones/avanzado.component';
import { AjustesAvisosComponent } from './secciones/avisos.component';
import { AjustesAyudaComponent } from './secciones/ayuda.component';
import { AjustesEspacioComponent } from './secciones/espacio.component';
import { AjustesExploradorComponent } from './secciones/explorador.component';
import { AjustesGuardadoComponent } from './secciones/guardado.component';

/**
 * Ajustes de la aplicación de Windows, con la disposición de la Configuración
 * de Windows 11: las secciones en un menú a la izquierda y la elegida a la
 * derecha. Sólo se enlaza dentro de la aplicación; en la web la ruta existe,
 * pero no lleva nadie a ella.
 *
 * La sección va en el fragmento de la URL (`/ajustes#avanzado`): se vuelve a
 * ella al recargar y se puede enlazar directamente.
 *
 * Esto sólo es el marco. Cada sección es su componente (`secciones/`), y aquí se
 * guarda lo que cambian (`guardar_ajustes` en main.rs) y se dice si ha ido bien.
 */
@Component({
  selector: 'app-ajustes',
  imports: [
    RouterLink,
    AjustesActualizacionesComponent,
    AjustesAvanzadoComponent,
    AjustesAvisosComponent,
    AjustesAyudaComponent,
    AjustesEspacioComponent,
    AjustesExploradorComponent,
    AjustesGuardadoComponent,
  ],
  templateUrl: './ajustes.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './ajustes.component.css',
})
export class AjustesComponent {
  private readonly escritorio = inject(EscritorioService);

  readonly enAplicacion = this.escritorio.activo;
  readonly secciones = SECCIONES;

  actual: Seccion = seccionDe(null);
  estado: EstadoAjustes | null = null;
  version: string | null = null;
  guardando = false;
  /** Lo que se dice tras el último cambio: «Guardado» o el error. */
  mensaje = '';
  fallo = false;
  reiniciando = false;

  constructor() {
    inject(ActivatedRoute).fragment.pipe(takeUntilDestroyed()).subscribe(fragmento => {
      this.actual = seccionDe(fragmento);
      this.mensaje = '';
      // Con el menú en pestañas (ventana estrecha), la de la sección puede
      // quedar fuera por la derecha: se trae a la vista, sin mover la página.
      setTimeout(() => document.querySelector('.menu__enlace--activa')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    });
    if (!this.enAplicacion) {
      return;
    }
    this.escritorio.estadoAjustes()
      .then(estado => (this.estado = estado))
      .catch(error => this.decir(mensajeDeError(error, 'No se han podido leer los ajustes.'), true));
    this.escritorio.version().then(version => (this.version = version));
  }

  /** Un punto junto a la sección que tiene algo pendiente. */
  pendiente(seccion: Seccion): boolean {
    return seccion.id === 'avanzado' && !!this.estado?.reinicio_pendiente;
  }

  async guardar(cambios: CambiosAjustes): Promise<void> {
    this.guardando = true;
    try {
      this.estado = await this.escritorio.guardarAjustes(cambios);
      this.decir(cambios.avanzado ? 'Guardado. Se aplicará al volver a abrir la aplicación.' : 'Guardado.', false);
    } catch (error) {
      this.decir(mensajeDeError(error, 'No se ha podido guardar.'), true);
    } finally {
      this.guardando = false;
    }
  }

  alCambiarEstado(estado: EstadoAjustes): void {
    this.estado = estado;
    this.decir('Guardado.', false);
  }

  decir(texto: string, fallo: boolean): void {
    this.mensaje = texto;
    this.fallo = fallo;
  }

  async reiniciar(): Promise<void> {
    this.reiniciando = true;
    try {
      await this.escritorio.reiniciar();
    } catch (error) {
      this.reiniciando = false;
      this.decir(mensajeDeError(error, 'No se ha podido reiniciar. Ciérrala y vuelve a abrirla.'), true);
    }
  }
}
