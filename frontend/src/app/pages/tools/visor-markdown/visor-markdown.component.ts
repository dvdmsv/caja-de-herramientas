import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { avisoError, mensajeDeError } from '../../../shared/notify';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

type Modo = 'archivo' | 'texto';

/** Espera antes de pedir otro render mientras se teclea o se cambia un ajuste. */
const ESPERA = 350;

/**
 * Lee un Markdown en pantalla, maquetado y sin crear ningún archivo.
 *
 * Lo dibuja el servidor con el mismo motor que «Markdown a PDF», así que lo
 * que se ve es lo que saldría impreso; aquí sólo se pinta. No es una
 * `PaginaConVista` porque esa clase pide una imagen por página, y esto devuelve
 * un documento HTML. Sí es una `PaginaHerramienta`, por la cola de subida.
 *
 * **El HTML va a un iframe con `sandbox`.** El Markdown puede traer HTML crudo,
 * y Angular lo saneaba quitándole los estilos, así que se le pasa saltándose
 * ese saneado. Es aceptable sólo por lo que lo rodea: el iframe no tiene
 * `allow-scripts` ni `allow-same-origin`, y el servidor le pone una CSP que
 * corta la red (ver `api/tools/visor_markdown.py`).
 */
@Component({
  selector: 'app-visor-markdown',
  imports: [FormsModule, FileQueueComponent, ToolPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './visor-markdown.component.html',
  styleUrl: './visor-markdown.component.css',
})
export class VisorMarkdownComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'visor-markdown';
  /** Se puede leer un texto pegado sin subir nada. */
  protected override readonly minimoArchivos = 0;

  private readonly sanitizer = inject(DomSanitizer);

  readonly modos: { id: Modo; nombre: string; icono: string }[] = [
    { id: 'archivo', nombre: 'Subir un archivo', icono: 'bi-upload' },
    { id: 'texto', nombre: 'Pegar texto', icono: 'bi-clipboard' },
  ];

  readonly familias = [
    { id: 'sans', nombre: 'Sin remates' },
    { id: 'serif', nombre: 'Con remates' },
  ];

  /** Los mismos valores que `COLORES_ACENTO` en el backend: aquí sólo se enseña la muestra. */
  readonly acentos = [
    { id: 'azul', nombre: 'Azul', color: '#1a56a8' },
    { id: 'rojo', nombre: 'Rojo', color: '#b3122c' },
    { id: 'verde', nombre: 'Verde', color: '#186b4c' },
    { id: 'grafito', nombre: 'Grafito', color: '#3a4148' },
  ];

  modo: Modo = 'archivo';
  texto = '';
  familia = 'sans';
  acento = 'azul';
  /** Marcado por defecto, como en «Markdown a PDF»: lo que se pega suele traer una línea por renglón. */
  saltos = true;

  documento: SafeHtml | null = null;
  palabras = 0;
  cargando = false;

  private temporizador?: ReturnType<typeof setTimeout>;
  /** Cuál es la petición vigente: si llegan desordenadas, no debe quedar pintada una vieja. */
  private peticion = 0;
  /** Vigila el tema de la aplicación, que se marca en `<html>`, para repintar al cambiarlo. */
  private readonly vigilante = new MutationObserver(() => this.alCambiarAjuste());

  constructor() {
    super();
    this.vigilante.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
  }

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
    this.vigilante.disconnect();
  }

  /** El archivo que se lee: el primero de la cola que ya está arriba. */
  private get idDocumento(): string | null {
    return this.archivos.find(archivo => archivo.estado === 'subido')?.id ?? null;
  }

  private get tema(): 'claro' | 'oscuro' {
    return document.documentElement.dataset['bsTheme'] === 'dark' ? 'oscuro' : 'claro';
  }

  elegirModo(modo: Modo): void {
    this.modo = modo;
    this.refrescar();
  }

  elegirAcento(id: string): void {
    this.acento = id;
    this.alCambiarAjuste();
  }

  elegirFamilia(id: string): void {
    this.familia = id;
    this.alCambiarAjuste();
  }

  /** Cualquier cambio de texto o de ajuste repinta, sin pedir uno por tecla. */
  alCambiarAjuste(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.refrescar(), ESPERA);
  }

  /** Al quitar el archivo de la cola se deja de mostrar; al cambiarlo, la subida lo repinta. */
  override alCambiarLista(): void {
    super.alCambiarLista();
    if (this.modo === 'archivo' && this.archivos.length === 0) {
      this.refrescar();
    }
  }

  protected override alTerminarSubida(): void {
    if (this.modo === 'archivo') {
      this.refrescar();
    }
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.texto = '';
    this.olvidar();
  }

  private refrescar(): void {
    clearTimeout(this.temporizador);
    const fuente = this.modo === 'archivo'
      ? (this.idDocumento ? { file_ids: [this.idDocumento] } : null)
      : (this.texto.trim() ? { texto: this.texto } : null);
    if (!fuente) {
      this.olvidar();
      return;
    }

    const mia = ++this.peticion;
    this.cargando = true;
    this.api.verMarkdown({
      ...fuente, acento: this.acento, familia: this.familia, saltos: this.saltos, tema: this.tema,
    }).subscribe({
      next: respuesta => {
        if (mia !== this.peticion) {
          return;
        }
        this.cargando = false;
        this.palabras = respuesta.palabras;
        this.documento = this.sanitizer.bypassSecurityTrustHtml(respuesta.html);
      },
      error: err => {
        if (mia !== this.peticion) {
          return;
        }
        this.cargando = false;
        avisoError(mensajeDeError(err, 'No se ha podido preparar la vista.'));
      },
    });
  }

  private olvidar(): void {
    this.peticion++;
    this.cargando = false;
    this.documento = null;
    this.palabras = 0;
  }
}
