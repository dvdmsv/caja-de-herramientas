import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';

import { PesoPipe } from '../peso.pipe';
import { avisoInfo } from '../notify';
import { encaja, explicarRechazo } from '../tipos-archivo';

export type EstadoArchivo = 'local' | 'subiendo' | 'subido' | 'error';

/** Un archivo elegido por el usuario y su estado respecto al servidor. */
export interface ArchivoEnCola {
  file: File;
  estado: EstadoArchivo;
  /** Id que devuelve el servidor una vez subido. */
  id?: string;
}

export function aCola(archivos: File[]): ArchivoEnCola[] {
  return archivos.map(file => ({ file, estado: 'local' as const }));
}

/**
 * Selector de archivos reutilizable: arrastrar y soltar, lista con estado y,
 * opcionalmente, reordenación. Lo comparten todas las herramientas.
 *
 * El componente sólo gestiona la selección y el orden; subir los archivos es
 * responsabilidad de la herramienta que lo usa.
 */
@Component({
  selector: 'app-file-queue',
  imports: [DragDropModule, PesoPipe],
  templateUrl: './file-queue.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './file-queue.component.css',
})
export class FileQueueComponent {
  @ViewChild('entrada') entrada!: ElementRef<HTMLInputElement>;

  /** Lista de archivos. El componente la modifica en sitio y avisa por `itemsChange`. */
  @Input() items: ArchivoEnCola[] = [];
  /** Filtro del selector nativo, p. ej. `.pdf` o `image/*`. */
  @Input() accept = '';
  @Input() multiple = true;
  /** Permite arrastrar para cambiar el orden (relevante en "unir PDF"). */
  @Input() ordenable = false;
  @Input() deshabilitado = false;
  @Input() ayuda = 'Arrastra tus archivos aquí o haz clic para elegirlos';

  @Output() itemsChange = new EventEmitter<ArchivoEnCola[]>();
  /** Se emite sólo con los archivos recién añadidos. */
  @Output() agregados = new EventEmitter<ArchivoEnCola[]>();

  arrastrando = false;

  /**
   * Con archivos ya elegidos, la zona se encoge a una franja. Grande no aporta
   * nada, y en el móvil empujaba el botón principal fuera de la pantalla.
   */
  get compacta(): boolean {
    return this.items.length > 0;
  }

  /**
   * `accept` viene sin espacios (".pdf,.docx,…") y el navegador lo trata como
   * una sola palabra: con muchos formatos se sale de la caja en el móvil.
   */
  get formatosLegibles(): string {
    return this.accept.split(',').map(formato => formato.trim()).join(', ');
  }

  abrirSelector(): void {
    if (!this.deshabilitado) {
      this.entrada.nativeElement.click();
    }
  }

  alSeleccionar(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.incorporar(Array.from(input.files ?? []));
    // Permite volver a elegir el mismo archivo tras quitarlo de la lista.
    input.value = '';
  }

  alArrastrarEncima(evento: DragEvent): void {
    evento.preventDefault();
    if (!this.deshabilitado) {
      this.arrastrando = true;
    }
  }

  alSalirArrastre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando = false;
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando = false;
    if (!this.deshabilitado) {
      this.incorporar(Array.from(evento.dataTransfer?.files ?? []));
    }
  }

  quitar(indice: number): void {
    this.items.splice(indice, 1);
    this.itemsChange.emit(this.items);
  }

  reordenar(evento: CdkDragDrop<ArchivoEnCola[]>): void {
    moveItemInArray(this.items, evento.previousIndex, evento.currentIndex);
    this.itemsChange.emit(this.items);
  }

  /**
   * Añade sólo lo que encaja con `accept` y no estaba ya en la lista, y avisa
   * de lo que se queda fuera: descartarlo en silencio hacía creer que la
   * página no respondía.
   */
  private incorporar(archivos: File[]): void {
    const noAdmitidos = archivos.filter(file => !encaja(file, this.accept));
    const repetidos = archivos.filter(file => encaja(file, this.accept) && this.yaEsta(file));
    const admitidos = archivos.filter(file => encaja(file, this.accept) && !this.yaEsta(file));
    const conservados = this.multiple ? admitidos : admitidos.slice(0, 1);

    const aviso = explicarRechazo({
      noAdmitidos: noAdmitidos.map(file => file.name),
      repetidos: repetidos.map(file => file.name),
      conservado: admitidos.length > 1 && !this.multiple ? conservados[0].name : undefined,
    }, this.accept);
    if (aviso) {
      avisoInfo(aviso);
    }

    if (conservados.length === 0) {
      return;
    }
    const nuevos = aCola(conservados);
    if (!this.multiple) {
      this.items.length = 0;
    }
    this.items.push(...nuevos);
    this.itemsChange.emit(this.items);
    this.agregados.emit(nuevos);
  }

  private yaEsta(file: File): boolean {
    return this.items.some(item => item.file.name === file.name && item.file.size === file.size);
  }
}
