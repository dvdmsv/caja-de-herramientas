import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { BovedaService, CIERRE_TRAS_MS } from '../../core/boveda.service';
import { abrirConDialogo, cambiarContrasenaConDialogo, crearConDialogo } from '../../shared/boveda/dialogos';
import { avisoError, avisoExito, confirmar } from '../../shared/notify';
import { FirmasBovedaComponent } from './firmas-boveda.component';
import { SecretosBovedaComponent } from './secretos-boveda.component';

type Seccion = 'firmas' | 'secretos';

const TITULOS: Record<Seccion, string> = { firmas: 'Firmas', secretos: 'Secretos' };

/** «1 secreto», «2 secretos». */
function recuento(cuantos: number, uno: string, varios: string): string {
  return `${cuantos} ${cuantos === 1 ? uno : varios}`;
}

/**
 * La bóveda de la aplicación de Windows: el marco. Crearla, abrirla y, abierta, dos
 * opciones: «Firmas» y «Secretos». Sólo se enlaza en la aplicación; en la web la
 * ruta existe, pero dice que aquí no está.
 *
 * La sección va en el fragmento (`/boveda#secretos`), como en Ajustes: si se cierra
 * sola, al reabrirla se sigue donde se estaba. Lo de dentro sólo existe mientras
 * está abierta: al cerrarse muere el componente, y con él lo escrito y lo revelado.
 *
 * Desde las herramientas se abre con los mismos diálogos (`shared/boveda/`), sin
 * venir aquí: lo que se hace en esta página es ordenarla.
 */
@Component({
  selector: 'app-boveda',
  imports: [FirmasBovedaComponent, RouterLink, SecretosBovedaComponent],
  templateUrl: './boveda.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './boveda.component.css',
})
export class BovedaComponent implements OnInit {
  protected readonly boveda = inject(BovedaService);

  readonly minutosHastaCerrarse = CIERRE_TRAS_MS / 60_000;

  seccion: Seccion | null = null;

  constructor() {
    inject(ActivatedRoute).fragment.pipe(takeUntilDestroyed()).subscribe(fragmento => {
      this.seccion = fragmento === 'firmas' || fragmento === 'secretos' ? fragmento : null;
    });
  }

  ngOnInit(): void {
    void this.boveda.comprobar();
  }

  get tituloDeSeccion(): string | null {
    return this.seccion && TITULOS[this.seccion];
  }

  get recuentoDeFirmas(): string {
    const { certificados, firmas } = this.boveda.contenido;
    return `${recuento(certificados.length, 'certificado', 'certificados')} · ${recuento(firmas.length, 'firma', 'firmas')}`;
  }

  get recuentoDeSecretos(): string {
    return recuento(this.boveda.contenido.secretos.length, 'secreto', 'secretos');
  }

  async crear(): Promise<void> {
    await crearConDialogo(this.boveda);
  }

  async abrir(): Promise<void> {
    await abrirConDialogo(this.boveda);
  }

  async cambiarContrasena(): Promise<void> {
    if (await cambiarContrasenaConDialogo(this.boveda)) {
      avisoExito('Contraseña cambiada');
    }
  }

  async borrar(): Promise<void> {
    const seguro = await confirmar('¿Borrar la bóveda?',
      'Se borra todo lo guardado: certificados, firmas y secretos. Los archivos originales que tengas no se tocan.',
      'Borrarla');
    if (!seguro) {
      return;
    }
    try {
      await this.boveda.borrar();
    } catch (error) {
      avisoError((error as Error).message);
    }
  }
}
