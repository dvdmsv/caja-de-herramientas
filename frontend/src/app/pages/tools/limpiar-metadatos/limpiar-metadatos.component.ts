
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
    return 'Metadatos borrados';
  }

  /** Lo que se ha encontrado en cada archivo, antes de tocar nada. */
  informe: MetadatosArchivo[] = [];
  inspeccionando = false;

  /** Claves marcadas para borrar, como `<id del archivo>:<clave del campo>`. */
  marcadas = new Set<string>();

  aFondo = false;

  /**
   * Hasta que no se sabe qué lleva cada archivo no hay nada que decidir, y sin
   * nada marcado no hay nada que borrar.
   */
  override get listo(): boolean {
    return super.listo && !this.inspeccionando && this.marcadas.size > 0;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (this.inspeccionando) {
      return 'Leyendo lo que cuenta el archivo…';
    }
    return this.marcadas.size === 0 ? 'Marca al menos un dato para borrarlo.' : null;
  }

  get algunaUbicacion(): boolean {
    return this.informe.some(archivo => archivo.ubicacion);
  }

  /** Si no se ha encontrado nada en ninguno: también es una respuesta. */
  get sinRastro(): boolean {
    return this.informe.length > 0 && this.informe.every(a => a.campos.length === 0);
  }

  get total(): number {
    return this.informe.reduce((suma, archivo) => suma + archivo.campos.length, 0);
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

  marcarTodo(archivo: MetadatosArchivo): void {
    archivo.campos.forEach(campo => this.marcadas.add(this.clave(archivo, campo)));
  }

  marcarNada(archivo: MetadatosArchivo): void {
    archivo.campos.forEach(campo => this.marcadas.delete(this.clave(archivo, campo)));
  }

  cuantas(archivo: MetadatosArchivo): number {
    return archivo.campos.filter(campo => this.esta(archivo, campo)).length;
  }

  // --- ciclo de vida ----------------------------------------------------

  protected override opciones(): Record<string, unknown> {
    const seleccion: Record<string, string[]> = {};
    this.informe.forEach(archivo => {
      seleccion[archivo.id] = archivo.campos
        .filter(campo => this.esta(archivo, campo))
        .map(campo => campo.clave);
    });
    return { a_fondo: this.aFondo, seleccion };
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
  }

  override empezarDeCero(): void {
    super.empezarDeCero();
    this.informe = [];
    this.marcadas.clear();
  }
}
