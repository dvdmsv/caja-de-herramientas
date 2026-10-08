import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FileQueueComponent } from '../../../shared/file-queue/file-queue.component';
import { PaginaConVista } from '../../../shared/pagina-con-vista';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { VistaPaginaComponent } from '../../../shared/vista-pagina/vista-pagina.component';
import { fechaConZona, fechaParaEntrada, ZonaFecha } from './fecha';

@Component({
  selector: 'app-marca-de-tiempo',
  imports: [FormsModule, FileQueueComponent, ResultListComponent, ToolControlsComponent,
            ToolPageComponent, VistaPaginaComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './marca-de-tiempo.component.html',
})
export class MarcaDeTiempoComponent extends PaginaConVista {
  protected readonly slug = 'marca-de-tiempo';
  modo: 'criptografico' | 'visible' = 'criptografico';
  origenFecha: 'actual' | 'manual' = 'actual';
  zona: ZonaFecha = 'local';
  readonly zonaLocal = Intl.DateTimeFormat().resolvedOptions().timeZone;
  fecha = fechaParaEntrada(new Date(), this.zona);
  borde = 'abajo';
  alineacion = 'derecha';
  fuente = 'sans';
  color = 'negro';
  tamano = 10;
  margen = 15;

  readonly posiciones = [{ id: 'arriba', nombre: 'Arriba' }, { id: 'abajo', nombre: 'Abajo' }];
  readonly alineaciones = [
    { id: 'izquierda', nombre: 'Izquierda' }, { id: 'centro', nombre: 'Centro' },
    { id: 'derecha', nombre: 'Derecha' },
  ];
  readonly fuentes = [
    { id: 'sans', nombre: 'Sans' }, { id: 'serif', nombre: 'Serif' }, { id: 'mono', nombre: 'Mono' },
  ];
  readonly colores = [
    { id: 'negro', nombre: 'Negro' }, { id: 'azul', nombre: 'Azul' }, { id: 'rojo', nombre: 'Rojo' },
  ];

  get fechaExplicita(): string { return fechaConZona(this.fecha, this.zona); }

  protected override get puedePrevisualizar(): boolean {
    return this.modo === 'visible' && !!this.fechaExplicita && super.puedePrevisualizar;
  }

  override get listo(): boolean {
    return super.listo && (this.modo === 'criptografico' || !!this.fechaExplicita);
  }

  override get motivoBloqueo(): string | null {
    return this.modo === 'visible' && !this.fechaExplicita
      ? 'Indica una fecha y hora válidas para la zona elegida.' : super.motivoBloqueo;
  }

  protected override get mensajeExito(): string { return 'Marca de tiempo añadida'; }

  protected override opciones(): Record<string, unknown> {
    if (this.modo === 'criptografico') { return { modo: this.modo }; }
    return {
      modo: this.modo, fecha: this.fechaExplicita, borde: this.borde,
      alineacion: this.alineacion, fuente: this.fuente, color: this.color,
      tamano: this.tamano, margen: this.margen,
    };
  }

  protected override alTerminarSubida(): void {
    if (this.origenFecha === 'actual') { this.fecha = fechaParaEntrada(new Date(), this.zona); }
    super.alTerminarSubida();
  }

  cambiarModo(modo: 'criptografico' | 'visible'): void {
    this.modo = modo;
    if (modo === 'visible' && this.origenFecha === 'actual') { this.ahora(); }
    this.alCambiarAjuste();
  }

  cambiarOrigen(origen: 'actual' | 'manual'): void {
    this.origenFecha = origen;
    if (origen === 'actual') { this.ahora(); }
    this.alCambiarAjuste();
  }

  ahora(): void {
    this.fecha = fechaParaEntrada(new Date(), this.zona);
    this.alCambiarAjuste();
  }

  cambiarZona(zona: ZonaFecha): void {
    const instante = this.fechaExplicita;
    this.zona = zona;
    if (instante) { this.fecha = fechaParaEntrada(new Date(instante), zona); }
    this.alCambiarAjuste();
  }
}
