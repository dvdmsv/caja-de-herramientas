import { inject } from '@angular/core';

import { ApiService, ArchivoServidor, Resultado, ResumenTamano, VistaPrevia } from '../core/api.service';
import { UsoService } from '../core/uso.service';
import { ArchivoEnCola } from './file-queue/file-queue.component';
import { buscarPorSlug } from '../core/tools';
import { sinAhorro } from './ahorro';
import { avisoError, avisoExito, avisoInfo, mensajeDeError } from './notify';
import { repartirSubida } from './subida';
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
   * arriba —"Editar metadatos" los inspecciona—. Se llama en toda subida que
   * acabe bien, también en los reintentos.
   */
  protected alTerminarSubida(): void {}

  /**
   * Gancho para quien necesite algo más de la respuesta que los archivos
   * —"Comparar PDF" saca de ahí su recuento—. Se llama sólo si ha ido bien.
   */
  protected alTerminar(_resultado: Resultado): void {}

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
        this.alTerminar(resultado);
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
        avisar(err, 'No se ha podido completar la operación.');
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
        // El servidor puede admitir unos y rechazar otros; quién se queda con
        // cada identificador lo decide `repartirSubida`, que está aparte y
        // probada: desalinear esto no da ningún error, da el documento
        // equivocado.
        const reparto = repartirSubida(items, estado.archivos, estado.rechazados);
        reparto.admitidos.forEach(({ item, id }) => {
          item.id = id;
          item.estado = 'subido';
        });

        if (reparto.descartados.length > 0) {
          // Fuera de la cola: dejarlos ahí en rojo invita a reintentar algo que
          // va a volver a fallar, porque el problema es el archivo.
          const fuera = reparto.descartados.map(descartado => descartado.item);
          this.archivos = this.archivos.filter(archivo => !fuera.includes(archivo));
          avisoInfo(reparto.descartados.map(descartado => descartado.error).join(' '));
        }
        this.progreso = -1;
        this.usoSesion.refrescar();
        this.alTerminarSubida();
        alTerminar?.();
      },
      error: err => {
        items.forEach(item => (item.estado = 'error'));
        this.progreso = -1;
        const codigo = (err as { status?: number })?.status;
        // Un archivo que no vale o que no cabe sale de la cola: reintentarlo
        // volvería a fallar igual.
        if (codigo === 400 || codigo === 413) {
          this.archivos = this.archivos.filter(archivo => !items.includes(archivo));
        }
        avisar(err, 'No se han podido subir los archivos.');
      },
    });
  }
}

/**
 * Cuenta un error como lo que es.
 *
 * La pregunta que decide el tono: **¿esto se arregla esperando?** Si el servidor
 * dice que hay cola (429) o que está saturado (503), no ha fallado nada: en un
 * minuto funciona, y parar al usuario con un diálogo que tiene que cerrar sobra.
 * Que el documento sea demasiado grande (413) o tarde demasiado (504) sí es algo
 * que hay que leer y decidir, y lo demás es un fallo de verdad.
 */
function avisar(err: unknown, respaldo: string): void {
  const codigo = (err as { status?: number })?.status;
  const texto = mensajeDeError(err, respaldo);
  if (codigo === 429 || codigo === 503) {
    avisoInfo(texto);
  } else {
    avisoError(texto);
  }
}
