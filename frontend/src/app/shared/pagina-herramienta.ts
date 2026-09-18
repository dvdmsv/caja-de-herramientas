import { inject } from '@angular/core';

import { ApiService, ArchivoServidor, ResumenTamano, VistaPrevia } from '../core/api.service';
import { UsoService } from '../core/uso.service';
import { ArchivoEnCola } from './file-queue/file-queue.component';
import { buscarPorSlug } from '../core/tools';
import { sinAhorro } from './ahorro';
import { avisoError, avisoExito, avisoInfo, mensajeDeError } from './notify';
import { queElegir } from './tipos-archivo';

/**
 * Comportamiento común a todas las páginas de herramienta: subir en cuanto se
 * sueltan los archivos, ejecutar la herramienta, mostrar el resultado y limpiar.
 *
 * Cada herramienta sólo aporta lo suyo: su `slug`, sus `opciones` y su
 * plantilla. Todo lo demás vive aquí para que las páginas no se repitan.
 */
export abstract class PaginaHerramienta {
  protected readonly api = inject(ApiService);
  private readonly usoSesion = inject(UsoService);

  archivos: ArchivoEnCola[] = [];
  resultados: ArchivoServidor[] = [];
  resumen: ResumenTamano | null = null;
  /** Sólo la rellenan las herramientas que devuelven texto, como "a Markdown". */
  vistaPrevia: VistaPrevia | null = null;

  /** -1 cuando no hay ninguna subida en marcha. */
  progreso = -1;
  procesando = false;

  /** Identificador de la herramienta en el servidor y en el catálogo. */
  protected abstract readonly slug: string;

  /** Cuántos archivos hacen falta como mínimo para poder ejecutarla. */
  protected readonly minimoArchivos: number = 1;

  /** Opciones propias de la herramienta que se envían al servidor. */
  protected opciones(): Record<string, unknown> {
    return {};
  }

  /**
   * Gancho para quien necesite hacer algo con los archivos en cuanto están
   * arriba —"Limpiar metadatos" los inspecciona—. Se llama en toda subida que
   * acabe bien, también en los reintentos.
   */
  protected alTerminarSubida(): void {}

  /** Texto del aviso cuando termina bien. */
  protected get mensajeExito(): string {
    return 'Listo';
  }

  /** Para pasarse a `app-tool-controls` desde la plantilla. */
  get pagina(): PaginaHerramienta {
    return this;
  }

  get ocupado(): boolean {
    return this.progreso >= 0 || this.procesando;
  }

  get pendientes(): ArchivoEnCola[] {
    return this.archivos.filter(archivo => archivo.estado !== 'subido');
  }

  get listo(): boolean {
    return this.archivos.length >= this.minimoArchivos && this.pendientes.length === 0 && !this.ocupado;
  }

  /**
   * Por qué no se puede pulsar todavía el botón principal, dicho para quien lo
   * mira; `null` si se puede, o si no hay nada útil que decir.
   *
   * Un botón apagado sin explicación obliga a adivinar. Esta versión cubre lo
   * común a todas; las herramientas que redefinen `listo` con requisitos
   * propios redefinen también esto, empezando por `super.motivoBloqueo`.
   */
  get motivoBloqueo(): string | null {
    if (this.listo || this.procesando) {
      return null;
    }
    if (this.progreso >= 0) {
      return 'Espera a que termine la subida.';
    }
    if (this.archivos.some(archivo => archivo.estado === 'error')) {
      return 'Algún archivo no se ha podido subir: reintenta la subida o quítalo de la lista.';
    }
    if (this.minimoArchivos > 0 && this.archivos.length === 0) {
      return `Elige ${queElegir(buscarPorSlug(this.slug)?.acepta ?? '')} para empezar.`;
    }
    if (this.archivos.length < this.minimoArchivos) {
      return `Añade al menos ${this.minimoArchivos} archivos.`;
    }
    return null;
  }

  /** Los archivos se suben al soltarlos: al pulsar el botón ya están arriba. */
  alAgregar(nuevos: ArchivoEnCola[]): void {
    this.olvidarResultado();
    this.subir(nuevos);
  }

  /** Cambiar la lista invalida el resultado anterior, que ya no le corresponde. */
  alCambiarLista(): void {
    this.olvidarResultado();
  }

  reintentar(): void {
    const fallidos = this.archivos.filter(archivo => archivo.estado === 'error');
    if (fallidos.length > 0) {
      this.subir(fallidos);
    }
  }

  ejecutar(): void {
    if (!this.listo) {
      return;
    }
    this.procesando = true;
    // El orden de la lista es el orden con el que trabaja el servidor.
    const ids = this.archivos.map(archivo => archivo.id!).filter(Boolean);

    this.api.ejecutar(this.slug, { file_ids: ids, ...this.opciones() }).subscribe({
      next: resultado => {
        this.procesando = false;
        this.resultados = resultado.files;
        this.resumen = resultado.resumen ?? null;
        this.vistaPrevia = resultado.vista_previa ?? null;
        // Los resultados también ocupan sitio, y es justo lo que sorprende.
        this.usoSesion.refrescar();
        if (sinAhorro(this.resumen)) {
          avisoInfo('Ya estaba optimizado: te dejamos el original.');
        } else {
          avisoExito(this.mensajeExito);
        }
      },
      error: err => {
        this.procesando = false;
        avisoError(mensajeDeError(err, 'No se ha podido completar la operación.'));
      },
    });
  }

  empezarDeCero(): void {
    this.api.limpiarSesion().subscribe({
      next: () => {
        this.archivos = [];
        this.olvidarResultado();
        this.progreso = -1;
        this.usoSesion.olvidar();
      },
      error: err => avisoError(mensajeDeError(err, 'No se han podido borrar los archivos.')),
    });
  }

  private olvidarResultado(): void {
    this.resultados = [];
    this.resumen = null;
    this.vistaPrevia = null;
  }

  /**
   * Sube una tanda de archivos llevando su progreso y su estado.
   *
   * Es `protected` y admite un aviso final porque hay herramientas, como la de
   * firmar, que manejan dos colas distintas y necesitan reaccionar en cuanto
   * una de ellas termina.
   */
  protected subir(items: ArchivoEnCola[], alTerminar?: () => void): void {
    items.forEach(item => (item.estado = 'subiendo'));
    this.progreso = 0;

    this.api.subir(items.map(item => item.file)).subscribe({
      next: estado => {
        if (estado.tipo === 'progreso') {
          this.progreso = estado.porcentaje;
          return;
        }
        // El servidor conserva el orden de envío, así que casan por posición.
        estado.archivos.forEach((archivo, i) => {
          if (items[i]) {
            items[i].id = archivo.id;
            items[i].estado = 'subido';
          }
        });
        this.progreso = -1;
        this.usoSesion.refrescar();
        this.alTerminarSubida();
        alTerminar?.();
      },
      error: err => {
        items.forEach(item => (item.estado = 'error'));
        this.progreso = -1;
        avisoError(mensajeDeError(err, 'No se han podido subir los archivos.'));
      },
    });
  }
}
