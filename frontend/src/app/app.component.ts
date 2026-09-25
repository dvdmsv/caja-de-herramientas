import { AsyncPipe } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { EscritorioService } from './core/escritorio.service';
import { TemaService } from './core/tema.service';
import { MenuPrincipalComponent } from './shared/menu-principal/menu-principal.component';
import { UsoSesionComponent } from './shared/uso-sesion/uso-sesion.component';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe, RouterOutlet, RouterLink, MenuPrincipalComponent, UsoSesionComponent],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly anio = new Date().getFullYear();
  readonly perfilAutor = 'https://github.com/dvdmsv';

  private readonly router = inject(Router);
  readonly tema = inject(TemaService);

  /** Dentro de la aplicación de Windows; en la web, inactivo. */
  readonly escritorio = inject(EscritorioService);

  constructor() {
    // Dentro de la aplicación de Windows, recoge lo abierto con «Abrir con…».
    // En la web no hace nada.
    this.escritorio.iniciar();
  }

  get iconoTema(): string {
    return { sistema: 'bi-circle-half', claro: 'bi-sun', oscuro: 'bi-moon-stars' }[this.tema.preferencia];
  }

  get etiquetaTema(): string {
    return { sistema: 'automático', claro: 'claro', oscuro: 'oscuro' }[this.tema.preferencia];
  }

  /**
   * Hay pantallas, como el visor, que necesitan todo el alto: ahí no se pintan
   * ni la barra de navegación ni el pie.
   */
  readonly pantallaCompleta = this.router.events.pipe(
    filter(evento => evento instanceof NavigationEnd),
    startWith(null),
    map(() => this.rutaActual()?.snapshot.data?.['pantallaCompleta'] === true),
  );

  private rutaActual() {
    let ruta = this.router.routerState.root;
    while (ruta.firstChild) {
      ruta = ruta.firstChild;
    }
    return ruta;
  }

  /**
   * Estado del menú en pantallas estrechas. Lo lleva Angular y no el JavaScript
   * de Bootstrap, que no se carga: sólo se usaba para esto.
   */
  menuAbierto = false;
}
