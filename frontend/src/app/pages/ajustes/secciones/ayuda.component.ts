import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { avisoError, mensajeDeError } from '../../../shared/notify';
import { copiarAlPortapapeles } from '../../../shared/portapapeles';
import { FilaAjusteComponent } from '../fila-ajuste.component';
import { SeccionAjustes } from './seccion';

/** Para cuando algo no va bien: lo que hace falta mandar para que se pueda arreglar. */
@Component({
  selector: 'app-ajustes-ayuda',
  imports: [FilaAjusteComponent, RouterLink],
  template: `
    <div class="card tarjeta-ajustes">
      <app-fila-ajuste titulo="Copiar información para soporte"
        detalle="La versión, tu Windows, la memoria, los ajustes avanzados que hayas cambiado y lo último que apuntó la aplicación en su registro. No lleva nombres de archivos ni su contenido.">
        <button type="button" class="btn btn-outline-primary" [disabled]="copiando" (click)="copiar()">
          <i class="bi me-1" [class.bi-clipboard]="!copiada" [class.bi-check-lg]="copiada" aria-hidden="true"></i>
          {{ copiada ? 'Copiada' : 'Copiar' }}
        </button>
        @if (copiada) {
          <p debajo class="small text-success mt-1 mb-0" role="status">
            Pégala en un correo o en una incidencia de GitHub.
          </p>
        }
      </app-fila-ajuste>
      <app-fila-ajuste titulo="Registros" detalle="La carpeta con lo que apunta la aplicación mientras trabaja.">
        <button type="button" class="btn btn-outline-secondary" (click)="abrir()">
          <i class="bi bi-folder2-open me-1" aria-hidden="true"></i>Abrir la carpeta
        </button>
      </app-fila-ajuste>
      <app-fila-ajuste titulo="Contar un fallo o pedir algo"
        detalle="En GitHub, donde se desarrolla. Si es un fallo, pega la información de arriba.">
        <a class="btn btn-outline-secondary" href="https://github.com/dvdmsv/caja-de-herramientas/issues"
          target="_blank" rel="noopener">
          <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>Abrir GitHub
        </a>
      </app-fila-ajuste>
      <app-fila-ajuste titulo="Acerca de" detalle="Quién la hace, con qué y con qué licencia.">
        <a class="btn btn-outline-secondary" routerLink="/acerca-de">Ver</a>
      </app-fila-ajuste>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AjustesAyudaComponent extends SeccionAjustes {
  copiando = false;
  copiada = false;

  async copiar(): Promise<void> {
    this.copiando = true;
    try {
      await copiarAlPortapapeles(await this.escritorio.informacionDeSoporte());
      this.copiada = true;
      setTimeout(() => (this.copiada = false), 4000);
    } catch (error) {
      avisoError(mensajeDeError(error, 'No se ha podido copiar.'));
    } finally {
      this.copiando = false;
    }
  }

  abrir(): void {
    this.escritorio.abrirCarpetaDeDatos().catch(error => avisoError(mensajeDeError(error, 'No se ha podido abrir.')));
  }
}
