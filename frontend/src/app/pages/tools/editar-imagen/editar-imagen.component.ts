import { Component, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ArchivoEnCola, FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { RecuadroComponent } from '../../../shared/recuadro/recuadro.component';
import { Recorte, RECORTE_COMPLETO, centradoCon, enFracciones,
         enPixeles } from '../../../shared/recuadro/recorte';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

interface Proporcion {
  id: string;
  nombre: string;
  /** Ancho entre alto en píxeles, o `null` para recorte libre. */
  valor: number | null;
}

const PROPORCIONES: Proporcion[] = [
  { id: 'libre', nombre: 'Libre', valor: null },
  { id: 'cuadrada', nombre: '1:1', valor: 1 },
  { id: '43', nombre: '4:3', valor: 4 / 3 },
  { id: '169', nombre: '16:9', valor: 16 / 9 },
  { id: 'a4', nombre: 'A4', valor: 210 / 297 },
];

@Component({
  selector: 'app-editar-imagen',
  imports: [
    FormsModule,
    FileQueueComponent,
    RecuadroComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './editar-imagen.component.html',
  styleUrl: './editar-imagen.component.css',
})
export class EditarImagenComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'editar-imagen';
  protected override get mensajeExito(): string {
    return 'Imagen editada';
  }

  readonly proporciones = PROPORCIONES;

  /**
   * La foto tal cual, leída del navegador y no del servidor.
   *
   * Aquí no hay nada que el servidor tenga que dibujar —se enseña la imagen y un
   * rectángulo encima—, y pedirle una vista previa por cada píxel de arrastre no
   * tendría sentido. Quien la crea la revoca: ver `ngOnDestroy`.
   */
  vista = '';
  /** Medidas de la foto ya con la orientación de la cámara aplicada. */
  anchoReal = 0;
  altoReal = 0;

  recorte: Recorte = { ...RECORTE_COMPLETO };
  proporcion = 'libre';
  giro = 0;
  espejo = false;
  ladoMaximo = 0;
  calidad = 90;

  ngOnDestroy(): void {
    this.olvidarVista();
  }

  /** La proporción elegida, pasada a fracciones de la imagen. */
  get objetivo(): number | null {
    const elegida = PROPORCIONES.find(p => p.id === this.proporcion)?.valor ?? null;
    if (elegida === null || !this.anchoReal || !this.altoReal) {
      return null;
    }
    return enFracciones(elegida, this.anchoReal / this.altoReal);
  }

  /** Si la foto se está viendo de canto, con el ancho y el alto cambiados. */
  get girada(): boolean {
    return this.giro === 90 || this.giro === 270;
  }

  /**
   * El hueco que ocupa la foto ya girada.
   *
   * Girar con CSS no cambia el hueco que el elemento reserva en la página, así
   * que hay que reservarlo aquí: con 90° una foto apaisada pasa a ser vertical y
   * sin esto se saldría por encima de lo que venga debajo.
   */
  get estiloDelMarco(): Record<string, string> {
    if (!this.anchoReal || !this.altoReal) {
      return {};
    }
    const proporcion = this.anchoReal / this.altoReal;
    return { 'aspect-ratio': String(this.girada ? 1 / proporcion : proporcion) };
  }

  /**
   * La foto dentro del marco, girada y volteada.
   *
   * Cuando está de canto, el contenido conserva su proporción original y se
   * dimensiona **cruzado** respecto al marco: su ancho es el alto del marco y su
   * alto, el ancho. Así, una vez girado, encaja justo.
   */
  get estiloDelContenido(): Record<string, string> {
    const proporcion = this.anchoReal && this.altoReal ? this.anchoReal / this.altoReal : 1;
    const medidas = this.girada
      ? { width: `${proporcion * 100}%`, height: `${100 / proporcion}%` }
      : { width: '100%', height: '100%' };
    return {
      ...medidas,
      transform: `translate(-50%, -50%) rotate(${this.giro}deg)`
        + ` scaleX(${this.espejo ? -1 : 1})`,
    };
  }

  get medidasDelRecorte(): string {
    if (!this.anchoReal) {
      return '';
    }
    const [ancho, alto] = enPixeles(this.recorte, this.anchoReal, this.altoReal);
    const girado = this.giro === 90 || this.giro === 270;
    return `${girado ? alto : ancho} × ${girado ? ancho : alto} píxeles`;
  }

  get hayFoto(): boolean {
    return this.vista !== '';
  }

  override alAgregar(nuevos: ArchivoEnCola[]): void {
    super.alAgregar(nuevos);
    this.cargarVista();
  }

  alCambiarLaLista(): void {
    this.alCambiarLista();
    if (this.archivos.length === 0) {
      this.olvidarVista();
    } else {
      this.cargarVista();
    }
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.olvidarVista();
    this.recorte = { ...RECORTE_COMPLETO };
    this.giro = 0;
    this.espejo = false;
    this.proporcion = 'libre';
  }

  elegirProporcion(id: string): void {
    this.proporcion = id;
    const objetivo = this.objetivo;
    if (objetivo !== null) {
      this.recorte = centradoCon(objetivo);
    }
    this.alCambiarLista();
  }

  alRecortar(recorte: Recorte): void {
    this.recorte = recorte;
    this.alCambiarLista();
  }

  girar(grados: number): void {
    this.giro = (this.giro + grados + 360) % 360;
    this.alCambiarLista();
  }

  alternarEspejo(): void {
    this.espejo = !this.espejo;
    this.alCambiarLista();
  }

  quitarRecorte(): void {
    this.recorte = { ...RECORTE_COMPLETO };
    this.proporcion = 'libre';
    this.alCambiarLista();
  }

  protected override opciones(): Record<string, unknown> {
    return {
      recorte: this.recorte,
      giro: this.giro,
      espejo: this.espejo,
      lado_maximo: this.ladoMaximo,
      calidad: this.calidad,
    };
  }

  /** Lee la foto del navegador para poder marcar el recorte encima. */
  private cargarVista(): void {
    const archivo = this.archivos[0]?.file;
    if (!archivo) {
      this.olvidarVista();
      return;
    }
    this.olvidarVista();
    this.vista = URL.createObjectURL(archivo);
    this.recorte = { ...RECORTE_COMPLETO };

    // Las medidas se leen del propio navegador, que aplica la orientación EXIF
    // igual que `imaging.abrir` en el servidor: así las dos partes están
    // midiendo sobre la misma imagen.
    const medidor = new Image();
    medidor.onload = () => {
      this.anchoReal = medidor.naturalWidth;
      this.altoReal = medidor.naturalHeight;
    };
    medidor.src = this.vista;
  }

  private olvidarVista(): void {
    if (this.vista.startsWith('blob:')) {
      URL.revokeObjectURL(this.vista);
    }
    this.vista = '';
    this.anchoReal = 0;
    this.altoReal = 0;
  }
}
