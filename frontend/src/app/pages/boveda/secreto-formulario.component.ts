import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output,
  ViewChild, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

import { BovedaService } from '../../core/boveda.service';
import { alAzar } from '../../core/boveda/cifrado';
import { DatosSecreto, SecretoGuardado, fichaCompleta } from '../../core/boveda/contenido';
import {
  GENERADOR_DE_SERIE, LONGITUD_MAXIMA, LONGITUD_MINIMA, OpcionesGenerador, generarContrasena,
} from '../../core/boveda/generador';
import { avisoError, avisoExito, confirmar } from '../../shared/notify';

const FAMILIAS: { clave: keyof Omit<OpcionesGenerador, 'longitud'>; etiqueta: string }[] = [
  { clave: 'mayusculas', etiqueta: 'A-Z' },
  { clave: 'minusculas', etiqueta: 'a-z' },
  { clave: 'numeros', etiqueta: '0-9' },
  { clave: 'simbolos', etiqueta: '#$%' },
];

/**
 * La ventana para añadir o editar un secreto, sobre la lista.
 *
 * Pulsar fuera no la cierra, y si hay algo escrito pregunta antes de descartarlo: un
 * secreto a medias no se pierde por un clic de más. Los campos sensibles van sin
 * corrector, para que no mande nada fuera, y escribir aplaza el cierre de la bóveda.
 */
@Component({
  selector: 'app-secreto-formulario',
  imports: [FormsModule],
  templateUrl: './secreto-formulario.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './secreto-formulario.component.css',
})
export class SecretoFormularioComponent implements OnInit, AfterViewInit {
  /** La ficha que se edita, o `null` si se añade una. */
  @Input() secreto: SecretoGuardado | null = null;
  @Output() cerrar = new EventEmitter<void>();

  @ViewChild('primero') primero?: ElementRef<HTMLInputElement>;

  readonly familias = FAMILIAS;
  readonly longitudMinima = LONGITUD_MINIMA;
  readonly longitudMaxima = LONGITUD_MAXIMA;

  ficha: Required<DatosSecreto> = { nombre: '', secreto: '', usuario: '', web: '', notas: '' };
  verSecreto = false;
  generador: OpcionesGenerador | null = null;
  guardando = false;

  private original = '';
  private readonly boveda = inject(BovedaService);

  ngOnInit(): void {
    const { nombre = '', secreto = '', usuario = '', web = '', notas = '' } = this.secreto ?? {};
    this.ficha = { nombre, secreto, usuario, web, notas };
    this.original = JSON.stringify(this.ficha);
  }

  ngAfterViewInit(): void {
    this.primero?.nativeElement.focus();
  }

  get completa(): boolean {
    return fichaCompleta(this.ficha);
  }

  private get hayCambios(): boolean {
    return JSON.stringify(this.ficha) !== this.original;
  }

  alEscribir(): void {
    this.boveda.seguirUsando();
  }

  // --- el generador -----------------------------------------------------------

  generar(): void {
    this.generador ??= { ...GENERADOR_DE_SERIE };
    this.ficha.secreto = generarContrasena(this.generador, alAzar);
    // Lo que se acaba de inventar hay que poder verlo: nadie lo ha tecleado.
    this.verSecreto = true;
    this.boveda.seguirUsando();
  }

  /** La última familia marcada no se puede quitar: sin ninguna no hay qué generar. */
  esLaUltima(clave: keyof Omit<OpcionesGenerador, 'longitud'>): boolean {
    return !!this.generador?.[clave] && FAMILIAS.filter(f => this.generador?.[f.clave]).length === 1;
  }

  // --- guardar y cerrar -------------------------------------------------------

  async guardar(): Promise<void> {
    if (!this.completa || this.guardando) {
      return;
    }
    this.guardando = true;
    try {
      if (this.secreto) {
        await this.boveda.actualizarSecreto(this.secreto.id, this.ficha);
      } else {
        await this.boveda.guardarSecreto(this.ficha);
      }
      avisoExito('Secreto guardado');
      this.cerrar.emit();
    } catch (error) {
      avisoError((error as Error).message);
    } finally {
      this.guardando = false;
    }
  }

  /** Si Swal está a la vista, el Escape es suyo: cierra su pregunta, no esta ventana. */
  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    if (!Swal.isVisible()) {
      void this.pedirCierre();
    }
  }

  async pedirCierre(): Promise<void> {
    if (!this.hayCambios || await confirmar('¿Descartar lo escrito?', 'No se ha guardado.', 'Descartar')) {
      this.cerrar.emit();
    }
  }
}
