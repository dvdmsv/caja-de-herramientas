import { Directive, OnDestroy } from '@angular/core';

import { PaginaHerramienta } from './pagina-herramienta';
import { avisoError, mensajeDeError } from './notify';

/**
 * Una página de herramienta que enseña cómo va a quedar el resultado.
 *
 * La vista previa la dibuja el servidor con el mismo código que escribirá el
 * archivo, así que lo que se ve es lo que sale; el navegador sólo la pinta. La
 * comparten "Marca de agua" y "Numerar páginas", que se refrescan igual.
 */

/** Espera antes de pedir otra vista previa mientras se mueve un deslizador. */
const ESPERA = 350;

// El `@Directive()` sin selector es lo que pide Angular para una clase base que
// usa su ciclo de vida: aquí, para soltar el object URL y el temporizador.
@Directive()
export abstract class PaginaConVista extends PaginaHerramienta implements OnDestroy {
  /** La vista previa, como object URL para el `<img>`. */
  vista = '';
  paginas = 0;
  paginaVista = 1;
  previsualizando = false;

  private temporizador?: ReturnType<typeof setTimeout>;
  /**
   * Cuál es la petición vigente. Al mover un deslizador salen varias y no
   * llegan en orden: sin esto se quedaría pintada una intermedia.
   */
  private peticion = 0;

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
    this.olvidarVista();
  }

  /** El documento sobre el que se previsualiza: el primero de la cola. */
  protected get idDocumento(): string | null {
    return this.archivos.find(archivo => archivo.estado === 'subido')?.id ?? null;
  }

  /**
   * En un lote, de qué archivo es la vista previa, para decirlo; con uno solo no
   * hace falta. Los demás se hacen con los mismos ajustes.
   */
  get nombreDeLaVista(): string | null {
    if (this.archivos.length < 2) {
      return null;
    }
    return this.archivos.find(archivo => archivo.id === this.idDocumento)?.file.name ?? null;
  }

  /** De cuál son las páginas contadas: si se quita el primero, hay que volver a contar. */
  private documentoContado: string | null = null;

  /** Las herramientas que necesitan algo más lo añaden aquí. */
  protected get puedePrevisualizar(): boolean {
    return this.idDocumento !== null;
  }

  /** En cuanto el documento está arriba se cuentan sus páginas y se enseña. */
  protected override alTerminarSubida(): void {
    const id = this.idDocumento;
    if (!id) {
      return;
    }
    this.documentoContado = id;
    this.api.paginasDe(id).subscribe({
      next: paginas => {
        this.paginas = paginas;
        this.paginaVista = Math.min(this.paginaVista, paginas);
        this.refrescar();
      },
      // Si falla, se queda sin selector pero la herramienta sigue sirviendo.
      error: () => this.refrescar(),
    });
  }

  /** Todo cambio de ajuste invalida el resultado y repinta la vista previa. */
  alCambiarAjuste(): void {
    this.alCambiarLista();
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.refrescar(), ESPERA);
  }

  cambiarPagina(numero: number): void {
    this.paginaVista = numero;
    this.refrescar();
  }

  /**
   * Quitar el documento deja la vista previa sin sentido. En un lote, quitar el
   * primero la pasa al siguiente, que tiene sus propias páginas.
   */
  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (!this.idDocumento) {
      this.paginas = 0;
      this.paginaVista = 1;
      this.documentoContado = null;
      this.olvidarVista();
    } else if (this.idDocumento !== this.documentoContado) {
      this.paginaVista = 1;
      this.alTerminarSubida();
    }
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.paginas = 0;
    this.paginaVista = 1;
    this.documentoContado = null;
    this.olvidarVista();
  }

  protected refrescar(): void {
    const id = this.idDocumento;
    if (!id || !this.puedePrevisualizar) {
      this.olvidarVista();
      return;
    }

    const mia = ++this.peticion;
    this.previsualizando = true;
    this.api
      .previsualizar(this.slug, { file_ids: [id], pagina: this.paginaVista, ...this.opciones() })
      .subscribe({
        next: url => {
          // Llegó tarde: ya se ha pedido otra con ajustes más nuevos.
          if (mia !== this.peticion) {
            URL.revokeObjectURL(url);
            return;
          }
          this.previsualizando = false;
          // Se suelta la anterior cuando la nueva ya está, para que no parpadee.
          this.olvidarVista();
          this.vista = url;
        },
        error: err => {
          if (mia !== this.peticion) {
            return;
          }
          this.previsualizando = false;
          avisoError(mensajeDeError(err, 'No se ha podido preparar la vista previa.'));
        },
      });
  }

  private olvidarVista(): void {
    if (this.vista.startsWith('blob:')) {
      URL.revokeObjectURL(this.vista);
    }
    this.vista = '';
  }
}
