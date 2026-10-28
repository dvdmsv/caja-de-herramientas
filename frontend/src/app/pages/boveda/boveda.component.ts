import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { BovedaService, CIERRE_TRAS_MS } from '../../core/boveda.service';
import { CertificadoGuardado } from '../../core/boveda/contenido';
import {
  abrirConDialogo, cambiarContrasenaConDialogo, crearConDialogo, pedirNombre,
} from '../../shared/boveda/dialogos';
import { PizarraComponent } from '../../shared/firma/pizarra.component';
import { avisoError, avisoExito, confirmar, mensajeDeError } from '../../shared/notify';

/**
 * La bóveda de la aplicación de Windows: crearla, abrirla y ver, añadir,
 * renombrar o quitar certificados y firmas. Sólo se enlaza en la aplicación;
 * en la web la ruta existe, pero dice que aquí no está.
 *
 * Desde las herramientas se abre con los mismos diálogos (`shared/boveda/`),
 * sin venir aquí: lo que se hace en esta página es ordenarla.
 */
@Component({
  selector: 'app-boveda',
  imports: [FormsModule, PizarraComponent, RouterLink],
  templateUrl: './boveda.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './boveda.component.css',
})
export class BovedaComponent implements OnInit {
  protected readonly boveda = inject(BovedaService);
  private readonly api = inject(ApiService);

  readonly minutosHastaCerrarse = CIERRE_TRAS_MS / 60_000;

  // --- añadir un certificado ---------------------------------------------
  anadiendoCertificado = false;
  p12 = '';
  contrasena = '';
  recordarContrasena = true;
  comprobando = false;

  // --- añadir una firma --------------------------------------------------
  anadiendoFirma: 'dibujar' | 'subir' | null = null;

  ngOnInit(): void {
    void this.boveda.comprobar();
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
      'Se borran todos los certificados y firmas guardados. Los archivos originales que tengas no se tocan.',
      'Borrarla');
    if (seguro) {
      await this.intentar(() => this.boveda.borrar());
    }
  }

  // --- certificados -------------------------------------------------------

  /** Se lee aquí, como en «Firmar con certificado»: no se sube por `/api/files`. */
  alElegirP12(evento: Event): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    this.p12 = '';
    if (!archivo) {
      return;
    }
    const lector = new FileReader();
    lector.onload = () => (this.p12 = String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => avisoError('No se ha podido leer el archivo del certificado.');
    lector.readAsDataURL(archivo);
  }

  /** Se comprueba con el servidor antes de guardarlo: así no se guarda uno que no abre. */
  async guardarCertificado(): Promise<void> {
    this.comprobando = true;
    try {
      const datos = await firstValueFrom(
        this.api.inspeccionarCertificado({ certificado: this.p12, contrasena: this.contrasena }));
      const nombre = await pedirNombre('Guardar el certificado', datos.nombre);
      if (!nombre) {
        return;
      }
      await this.boveda.guardarCertificado({
        nombre, titular: datos.nombre, emisor: datos.emisor, hasta: datos.hasta, p12: this.p12,
        ...(this.recordarContrasena ? { contrasena: this.contrasena } : {}),
      });
      this.cancelarCertificado();
      avisoExito('Certificado guardado');
    } catch (error) {
      avisoError(mensajeDeError(error, 'No se ha podido abrir el certificado.'));
    } finally {
      this.comprobando = false;
    }
  }

  cancelarCertificado(): void {
    this.anadiendoCertificado = false;
    this.p12 = '';
    this.contrasena = '';
    this.recordarContrasena = true;
  }

  caducado(certificado: CertificadoGuardado): boolean {
    return !!certificado.hasta && new Date(certificado.hasta).getTime() < Date.now();
  }

  fecha(iso: string): string {
    return iso ? new Date(iso).toLocaleDateString('es-ES') : '';
  }

  // --- firmas ---------------------------------------------------------------

  alSubirFirma(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];
    entrada.value = '';
    if (archivo) {
      void this.guardarFirma(archivo);
    }
  }

  async guardarFirma(archivo: File): Promise<void> {
    const nombre = await pedirNombre('Guardar la firma', `Firma ${this.boveda.contenido.firmas.length + 1}`);
    if (nombre && await this.intentar(() => this.boveda.guardarFirma(archivo, nombre))) {
      this.anadiendoFirma = null;
      avisoExito('Firma guardada');
    }
  }

  // --- lo común -------------------------------------------------------------

  async renombrar(id: string, actual: string): Promise<void> {
    const nombre = await pedirNombre('Cambiar el nombre', actual);
    if (nombre) {
      await this.intentar(() => this.boveda.renombrar(id, nombre));
    }
  }

  async quitar(id: string, nombre: string): Promise<void> {
    if (await confirmar(`¿Quitar «${nombre}»?`, 'Se quita de la bóveda. No hay forma de deshacerlo.', 'Quitar')) {
      await this.intentar(() => this.boveda.quitar(id));
    }
  }

  private async intentar(accion: () => Promise<void>): Promise<boolean> {
    try {
      await accion();
      return true;
    } catch (error) {
      avisoError((error as Error).message);
      return false;
    }
  }
}
