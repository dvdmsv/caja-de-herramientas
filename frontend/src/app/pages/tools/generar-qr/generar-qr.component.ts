
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

type Tipo = 'texto' | 'wifi' | 'contacto' | 'correo' | 'telefono';

interface Opcion { id: string; nombre: string; icono?: string; }

@Component({
  selector: 'app-generar-qr',
  imports: [FormsModule, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './generar-qr.component.html',
})
export class GenerarQrComponent extends PaginaHerramienta {
  protected readonly slug = 'generar-qr';
  /** La única herramienta que no necesita que subas nada. */
  protected override readonly minimoArchivos = 0;
  protected override get mensajeExito(): string {
    return 'Código QR generado';
  }

  readonly tipos: Opcion[] = [
    { id: 'texto', nombre: 'Texto o enlace', icono: 'bi-link-45deg' },
    { id: 'wifi', nombre: 'Wifi', icono: 'bi-wifi' },
    { id: 'contacto', nombre: 'Contacto', icono: 'bi-person-vcard' },
    { id: 'correo', nombre: 'Correo', icono: 'bi-envelope' },
    { id: 'telefono', nombre: 'Teléfono', icono: 'bi-telephone' },
  ];
  readonly seguridades: Opcion[] = [
    { id: 'WPA', nombre: 'WPA/WPA2' },
    { id: 'WEP', nombre: 'WEP' },
    { id: 'nopass', nombre: 'Sin contraseña' },
  ];
  readonly correcciones: Opcion[] = [
    { id: 'baja', nombre: 'Baja' },
    { id: 'media', nombre: 'Media' },
    { id: 'alta', nombre: 'Alta' },
    { id: 'maxima', nombre: 'Máxima' },
  ];

  tipo: Tipo = 'texto';
  formato = 'png';
  correccion = 'media';
  escala = 10;

  texto = '';
  red = '';
  clave = '';
  seguridad = 'WPA';
  oculta = false;
  nombre = '';
  organizacion = '';
  telefono = '';
  correo = '';
  web = '';
  asunto = '';
  mensaje = '';

  /** Sin archivos que subir, lo que habilita el botón es tener contenido. */
  override get listo(): boolean {
    return super.listo && this.completo;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.completo) {
      return super.motivoBloqueo;
    }
    switch (this.tipo) {
      case 'texto': return 'Escribe el texto o el enlace que llevará el código.';
      case 'wifi': return this.red.trim() ? 'Escribe la contraseña de la red.' : 'Escribe el nombre de la red.';
      case 'contacto': return 'Escribe el nombre del contacto.';
      case 'correo': return 'Escribe la dirección de correo.';
      default: return 'Escribe el número de teléfono.';
    }
  }

  get completo(): boolean {
    switch (this.tipo) {
      case 'texto': return this.texto.trim().length > 0;
      case 'wifi': return this.red.trim().length > 0
        && (this.seguridad === 'nopass' || this.clave.trim().length > 0);
      case 'contacto': return this.nombre.trim().length > 0;
      case 'correo': return this.correo.trim().length > 0;
      default: return this.telefono.trim().length > 0;
    }
  }

  protected override opciones(): Record<string, unknown> {
    const comunes = { tipo: this.tipo, formato: this.formato,
                      correccion: this.correccion, escala: this.escala };
    switch (this.tipo) {
      case 'texto':
        return { ...comunes, texto: this.texto.trim() };
      case 'wifi':
        return { ...comunes, red: this.red.trim(), clave: this.clave,
                 seguridad: this.seguridad, oculta: this.oculta };
      case 'contacto':
        return { ...comunes, nombre: this.nombre.trim(), organizacion: this.organizacion.trim(),
                 telefono: this.telefono.trim(), correo: this.correo.trim(), web: this.web.trim() };
      case 'correo':
        return { ...comunes, correo: this.correo.trim(), asunto: this.asunto.trim(),
                 mensaje: this.mensaje.trim() };
      default:
        return { ...comunes, telefono: this.telefono.trim() };
    }
  }

  elegirTipo(id: string): void {
    this.tipo = id as Tipo;
    this.alCambiarLista();
  }
}
