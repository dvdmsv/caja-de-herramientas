import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ObjetivoTamano, Resultado } from '../../../core/api.service';
import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { PesoPipe } from '../../../shared/peso.pipe';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';

type Modo = 'calidad' | 'tamano';

/** Lo que suelen pedir los formularios para una foto, en KB. */
const TAMANOS_HABITUALES = [100, 200, 500, 1000];

@Component({
  selector: 'app-comprimir-imagen',
  imports: [
    FormsModule,
    FileQueueComponent,
    PesoPipe,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent
],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './comprimir-imagen.component.html',
})
export class ComprimirImagenComponent extends PaginaHerramienta {
  protected readonly slug = 'comprimir-imagen';
  protected override get mensajeExito(): string {
    return 'Imágenes comprimidas';
  }

  /** 0 significa conservar el tamaño original. */
  readonly tamanos = [
    { valor: 0, nombre: 'Sin cambiar el tamaño' },
    { valor: 3840, nombre: '4K — 3840 px' },
    { valor: 2560, nombre: '2K — 2560 px' },
    { valor: 1920, nombre: 'Full HD — 1920 px' },
    { valor: 1280, nombre: 'HD — 1280 px' },
    { valor: 800, nombre: 'Web — 800 px' },
  ];

  readonly tamanosHabituales = TAMANOS_HABITUALES;

  modo: Modo = 'calidad';
  calidad = 75;
  ladoMaximo = 0;
  /** En KB: en fotos, los límites habituales son de cientos de KB. */
  objetivoKb = 200;

  /** Si se pidió un tamaño y alguna no llegó: se avisa junto al resultado. */
  noAlcanzado: ObjetivoTamano | null = null;

  override get listo(): boolean {
    return super.listo && (this.modo === 'calidad' || this.objetivoKb > 0);
  }

  protected override opciones(): Record<string, unknown> {
    return this.modo === 'tamano'
      ? { objetivo_kb: this.objetivoKb }
      : { calidad: this.calidad, lado_maximo: this.ladoMaximo };
  }

  protected override alTerminar(resultado: Resultado): void {
    this.noAlcanzado = resultado.objetivo && !resultado.objetivo.logrado ? resultado.objetivo : null;
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.noAlcanzado = null;
  }

  elegirModo(modo: Modo): void {
    this.modo = modo;
    this.alCambiarLista();
  }

  elegirTamano(kb: number): void {
    this.objetivoKb = kb;
    this.alCambiarLista();
  }

  get descripcionCalidad(): string {
    if (this.calidad >= 85) {
      return 'Casi idéntica al original';
    }
    return this.calidad >= 60 ? 'Buen equilibrio' : 'Muy ligera, con pérdida visible';
  }
}
