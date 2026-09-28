import { Component, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { RecuentoAnonimizado } from '../../../core/api.service';
import { MARCADOS_DE_SERIE, TIPOS_DE_DATO, nombreDeDato } from '../../../shared/datos-personales';
import { ConstructorRegexComponent } from '../../../shared/constructor-regex/constructor-regex.component';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { mensajeDeError } from '../../../shared/notify';

/** Espera antes de volver a contar mientras se escribe la expresión propia. */
const ESPERA = 350;

@Component({
  selector: 'app-anonimizar-pdf',
  imports: [
    FormsModule,
    ConstructorRegexComponent,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './anonimizar-pdf.component.html',
})
export class AnonimizarPdfComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'anonimizar-pdf';
  protected override get mensajeExito(): string {
    return 'Datos tachados';
  }

  readonly tiposDeDato = TIPOS_DE_DATO;
  marcados: Record<string, boolean> = { ...MARCADOS_DE_SERIE };
  patron = '';
  color = 'negro';

  /** Lo que se ha encontrado, o `null` si todavía no se ha mirado. */
  recuento: RecuentoAnonimizado[] | null = null;
  total = 0;
  contando = false;
  /** Por qué no se ha podido contar; se enseña aquí y no como aviso que pasa. */
  problema = '';

  /** Si está desplegado el constructor de expresiones. */
  armando = false;
  /** Algunos textos del documento que casan con la expresión propia. */
  ejemplos: string[] | null = null;

  private temporizador?: ReturnType<typeof setTimeout>;
  /** Cuál es la petición vigente: al escribir salen varias y no llegan en orden. */
  private peticion = 0;

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
  }

  get elegidos(): string[] {
    return TIPOS_DE_DATO.filter(tipo => this.marcados[tipo.id]).map(tipo => tipo.id);
  }

  nombreDe(tipo: string): string {
    return nombreDeDato(tipo);
  }

  get nadaQueBuscar(): boolean {
    return this.elegidos.length === 0 && this.patron.trim() === '';
  }

  override get listo(): boolean {
    return super.listo && !this.nadaQueBuscar;
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    return this.nadaQueBuscar ? 'Marca algún tipo de dato o escribe una expresión.' : null;
  }

  // --- constructor de expresiones ---------------------------------------
  //
  // Escribe en el mismo campo de siempre y lo deja editable: es un punto de
  // partida, no una jaula. Quien sepa escribir expresiones no lo abre.

  alternarConstructor(): void {
    this.armando = !this.armando;
  }

  /** Lo que ha armado el constructor pasa al campo, como si se hubiera escrito. */
  usarExpresion(expresion: string): void {
    this.patron = expresion;
    this.alCambiarAjuste();
  }

  /** Cuántas coincidencias tiene la expresión propia en el documento; `null` si no se sabe. */
  get coincidenciasPropias(): number | null {
    if (!this.recuento) {
      return null;
    }
    return this.recuento.find(fila => fila.tipo === 'propio')?.cuantas ?? 0;
  }

  protected override opciones(): Record<string, unknown> {
    return { tipos: this.elegidos, patron: this.patron.trim(), color: this.color };
  }

  /** En cuanto el documento está arriba se cuenta lo que hay dentro. */
  protected override alTerminarSubida(): void {
    this.contar();
  }

  cambiarTipo(id: string, evento: Event): void {
    this.marcados[id] = (evento.target as HTMLInputElement).checked;
    this.alCambiarAjuste();
  }

  elegirColor(valor: string): void {
    this.color = valor;
    this.alCambiarLista();
  }

  /** Cambiar qué se busca invalida el resultado y obliga a volver a contar. */
  alCambiarAjuste(): void {
    this.alCambiarLista();
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.contar(), ESPERA);
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.olvidarRecuento();
  }

  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (!this.documento) {
      this.olvidarRecuento();
    }
  }

  private get documento(): string | null {
    return this.archivos.find(archivo => archivo.estado === 'subido')?.id ?? null;
  }

  /**
   * Cuántos datos hay, sin tocar el archivo.
   *
   * Es lo que separa esta herramienta de un salto al vacío: tachar no tiene
   * vuelta atrás, así que se dice antes qué se va a llevar por delante.
   */
  private contar(): void {
    const id = this.documento;
    if (!id || this.nadaQueBuscar) {
      this.olvidarRecuento();
      return;
    }

    const mia = ++this.peticion;
    this.contando = true;
    this.api.inspeccionarAnonimizado(id, this.elegidos, this.patron.trim()).subscribe({
      next: zonas => {
        if (mia !== this.peticion) {
          return;
        }
        this.contando = false;
        this.problema = '';
        this.total = zonas.total;
        this.recuento = zonas.recuento;
        this.ejemplos = zonas.ejemplos ?? [];
      },
      error: err => {
        if (mia !== this.peticion) {
          return;
        }
        this.contando = false;
        this.recuento = null;
        // Un escaneado sin texto o una expresión rota no son fallos del
        // servidor: son cosas que quien lee puede arreglar, y se leen aquí.
        this.problema = mensajeDeError(err, 'No se ha podido mirar el documento.');
      },
    });
  }

  private olvidarRecuento(): void {
    clearTimeout(this.temporizador);
    this.peticion++;
    this.contando = false;
    this.recuento = null;
    this.ejemplos = null;
    this.total = 0;
    this.problema = '';
  }
}
