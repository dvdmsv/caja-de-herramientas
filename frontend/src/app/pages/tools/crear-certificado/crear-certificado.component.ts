
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

/** Lo mínimo que protege de verdad una clave privada. */
const MINIMO_CONTRASENA = 8;

/**
 * Crear un certificado digital propio.
 *
 * Como "Generar QR", no recibe archivos: de ahí `minimoArchivos = 0`. Devuelve
 * dos, el `.p12` con la clave dentro y el `.crt` público.
 */
@Component({
  selector: 'app-crear-certificado',
  imports: [FormsModule, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './crear-certificado.component.html',
})
export class CrearCertificadoComponent extends PaginaHerramienta {
  protected readonly slug = 'crear-certificado';
  protected override readonly minimoArchivos = 0;
  protected override get mensajeExito(): string {
    return 'Certificado creado';
  }

  nombre = '';
  organizacion = '';
  correo = '';
  pais = 'ES';
  anos = 3;
  bits: '2048' | '4096' = '2048';
  contrasena = '';
  repetida = '';

  get contrasenaCorta(): boolean {
    return this.contrasena.length > 0 && this.contrasena.length < MINIMO_CONTRASENA;
  }

  get contrasenaDistinta(): boolean {
    return this.repetida.length > 0 && this.repetida !== this.contrasena;
  }

  override get listo(): boolean {
    return super.listo && this.nombre.trim().length > 0
      && this.contrasena.length >= MINIMO_CONTRASENA && this.repetida === this.contrasena;
  }

  override get motivoBloqueo(): string | null {
    if (!this.nombre.trim()) {
      return 'Escribe el nombre que irá en el certificado.';
    }
    if (this.contrasena.length < MINIMO_CONTRASENA) {
      return `La contraseña tiene que tener al menos ${MINIMO_CONTRASENA} caracteres.`;
    }
    if (this.repetida !== this.contrasena) {
      return 'Las dos contraseñas no coinciden.';
    }
    return super.motivoBloqueo;
  }

  protected override opciones(): Record<string, unknown> {
    return {
      nombre: this.nombre.trim(),
      organizacion: this.organizacion.trim(),
      correo: this.correo.trim(),
      pais: this.pais.trim(),
      anos: Number(this.anos),
      bits: this.bits,
      contrasena: this.contrasena,
    };
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.contrasena = '';
    this.repetida = '';
  }
}
