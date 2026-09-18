
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CampoMetadato, MetadatosArchivo } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';

@Component({
  selector: 'app-limpiar-metadatos',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './limpiar-metadatos.component.html',
})
export class LimpiarMetadatosComponent extends PaginaHerramienta {
  protected readonly slug = 'limpiar-metadatos';
  protected override get mensajeExito(): string {
    return 'Metadatos actualizados';
  }

  /** Lo que se ha encontrado en cada archivo, antes de tocar nada. */
  informe: MetadatosArchivo[] = [];
  inspeccionando = false;

  /** Claves marcadas para borrar, como `<id del archivo>:<clave del campo>`. */
  marcadas = new Set<string>();

  /** Lo escrito a mano, con la misma clave. Sólo cuenta si difiere del original. */
  ediciones = new Map<string, string>();

  aFondo = false;

  /**
   * Hasta que no se sabe qué lleva cada archivo no hay nada que decidir, y sin
   * nada marcado ni nada escrito no hay nada que hacer.
   */
  override get listo(): boolean {
    return super.listo && !this.inspeccionando && (this.marcadas.size > 0 || this.hayCambios);
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (this.inspeccionando) {
      return 'Leyendo lo que cuenta el archivo…';
    }
    if (this.marcadas.size === 0 && !this.hayCambios) {
      return 'Marca un dato para borrarlo o escribe encima de otro.';
    }
    return null;
  }

  get algunaUbicacion(): boolean {
    return this.informe.some(archivo => archivo.ubicacion);
  }

  /** Si no se ha encontrado nada en ninguno: también es una respuesta. */
  get sinRastro(): boolean {
    return this.informe.length > 0 && this.informe.every(archivo => this.vacio(archivo));
  }

  /**
   * Un archivo sin nada dentro. De un PDF se enseñan siempre sus ocho campos,
   * con valor o sin él, así que "no lleva nada" no es "no trae campos".
   */
  vacio(archivo: MetadatosArchivo): boolean {
    return archivo.campos.every(campo => !this.borrable(campo));
  }

  get total(): number {
    return this.informe.reduce((suma, archivo) => suma + archivo.campos.length, 0);
  }

  get hayCambios(): boolean {
    return this.informe.some(archivo => archivo.campos.some(campo => this.cambiado(archivo, campo)));
  }

  // --- fase 1: mirar ----------------------------------------------------

  /** Los archivos se inspeccionan en cuanto están arriba. */
  protected override alTerminarSubida(): void {
    const nuevos = this.archivos
      .map(archivo => archivo.id)
      .filter((id): id is string => !!id && !this.informe.some(a => a.id === id));
    if (nuevos.length === 0) {
      return;
    }

    this.inspeccionando = true;
    this.api.inspeccionarMetadatos(nuevos).subscribe({
      next: encontrados => {
        this.inspeccionando = false;
        this.informe = [...this.informe, ...encontrados];
        // Se marca todo: esto es una herramienta de limpiar, y quien quiera
        // conservar algo lo desmarca.
        encontrados.forEach(archivo => this.marcarTodo(archivo));
      },
      error: err => {
        this.inspeccionando = false;
        avisoError(mensajeDeError(err, 'No se han podido leer los metadatos.'));
      },
    });
  }

  // --- fase 2: elegir ---------------------------------------------------

  clave(archivo: MetadatosArchivo, campo: CampoMetadato): string {
    return `${archivo.id}:${campo.clave}`;
  }

  esta(archivo: MetadatosArchivo, campo: CampoMetadato): boolean {
    return this.marcadas.has(this.clave(archivo, campo));
  }

  alternar(archivo: MetadatosArchivo, campo: CampoMetadato): void {
    const clave = this.clave(archivo, campo);
    if (this.marcadas.has(clave)) {
      this.marcadas.delete(clave);
    } else {
      this.marcadas.add(clave);
    }
  }

  /** Un campo vacío no se puede borrar: no hay nada dentro. */
  borrable(campo: CampoMetadato): boolean {
    return !campo.editable || campo.texto !== '';
  }

  marcarTodo(archivo: MetadatosArchivo): void {
    archivo.campos
      .filter(campo => this.borrable(campo))
      .forEach(campo => this.marcadas.add(this.clave(archivo, campo)));
  }

  marcarNada(archivo: MetadatosArchivo): void {
    archivo.campos.forEach(campo => this.marcadas.delete(this.clave(archivo, campo)));
  }

  cuantas(archivo: MetadatosArchivo): number {
    return archivo.campos.filter(campo => this.esta(archivo, campo)).length;
  }

  cuantasBorrables(archivo: MetadatosArchivo): number {
    return archivo.campos.filter(campo => this.borrable(campo)).length;
  }

  // --- fase 2 bis: corregir ---------------------------------------------

  /** Lo que enseña la caja de texto: lo escrito, o lo que traía el archivo. */
  valor(archivo: MetadatosArchivo, campo: CampoMetadato): string {
    return this.ediciones.get(this.clave(archivo, campo)) ?? campo.texto;
  }

  escribir(archivo: MetadatosArchivo, campo: CampoMetadato, evento: Event): void {
    this.ediciones.set(this.clave(archivo, campo), (evento.target as HTMLInputElement).value);
  }

  /**
   * Un valor cuenta como cambio si difiere del original y el campo no está
   * marcado para borrar: borrar y cambiar a la vez lo rechaza el servidor, y es
   * la interfaz la que tiene que evitar que llegue a pasar.
   */
  cambiado(archivo: MetadatosArchivo, campo: CampoMetadato): boolean {
    if (!campo.editable || this.esta(archivo, campo)) {
      return false;
    }
    const escrito = this.ediciones.get(this.clave(archivo, campo));
    return escrito !== undefined && escrito.trim() !== campo.texto;
  }

  // --- ciclo de vida ----------------------------------------------------

  protected override opciones(): Record<string, unknown> {
    const seleccion: Record<string, string[]> = {};
    this.informe.forEach(archivo => {
      seleccion[archivo.id] = archivo.campos
        .filter(campo => this.esta(archivo, campo))
        .map(campo => campo.clave);
    });
    const cambios: Record<string, Record<string, string>> = {};
    this.informe.forEach(archivo => {
      const suyos: Record<string, string> = {};
      archivo.campos
        .filter(campo => this.cambiado(archivo, campo))
        .forEach(campo => { suyos[campo.clave] = this.valor(archivo, campo).trim(); });
      if (Object.keys(suyos).length > 0) {
        cambios[archivo.id] = suyos;
      }
    });
    return { a_fondo: this.aFondo, seleccion, cambios };
  }

  /** Quitar archivos de la lista deja su informe sin sentido. */
  alQuitar(): void {
    this.alCambiarLista();
    const vivos = new Set(this.archivos.map(archivo => archivo.id));
    this.informe = this.informe.filter(archivo => vivos.has(archivo.id));
    this.marcadas.forEach(clave => {
      if (!vivos.has(clave.split(':')[0])) {
        this.marcadas.delete(clave);
      }
    });
    this.ediciones.forEach((_, clave) => {
      if (!vivos.has(clave.split(':')[0])) {
        this.ediciones.delete(clave);
      }
    });
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.informe = [];
    this.marcadas.clear();
    this.ediciones.clear();
  }
}
