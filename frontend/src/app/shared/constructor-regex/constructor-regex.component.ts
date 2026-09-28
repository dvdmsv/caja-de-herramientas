import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService, PruebaExpresion } from '../../core/api.service';
import { mensajeDeError } from '../notify';
import { copiarAlPortapapeles } from '../portapapeles';
import {
  ANTES_DE_PALABRA, DESPUES_DE_PALABRA, EJEMPLOS, MAXIMO_VECES, MODOS, Pieza, TIPOS, TipoPieza, construir, describir,
  enPalabras, fragmentos, piezaNueva, recortar,
} from '../regex-guiada';

/** Espera tras la última tecla antes de preguntar al servidor. */
const ESPERA = 400;

/** Cuántos colores distintos rotan entre las piezas. */
const COLORES = 5;

let instancias = 0;

/**
 * El constructor de expresiones: piezas editables, la expresión que sale,
 * coloreada pieza a pieza, y un probador.
 *
 * Lo que se arma se vuelca en el campo de la página por `expresionChange`, y
 * ese campo sigue siendo editable. **Lo que se prueba es lo que hay en el
 * campo** (`expresion`), no lo que se ha armado aquí: si alguien la retoca a
 * mano, lo que va a tachar es eso.
 *
 * La prueba la hace el servidor, con el `re` de Python que luego tacha, por lo
 * que explica `shared/regex-guiada.ts`.
 */
@Component({
  selector: 'app-constructor-regex',
  imports: [FormsModule],
  templateUrl: './constructor-regex.component.html',
  styleUrl: './constructor-regex.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ConstructorRegexComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  @Input() desactivado = false;
  /** Lo que hay en el campo de la expresión, retocado a mano o no. */
  @Input() expresion = '';
  /** Algunos textos del documento subido que casan con `expresion`; `null` si no se ha mirado. */
  @Input() ejemplosDelDocumento: string[] | null = null;
  /** Cuántas coincidencias tiene en el documento; `null` si no se ha mirado. */
  @Input() coincidenciasDelDocumento: number | null = null;
  @Output() expresionChange = new EventEmitter<string>();

  readonly id = `regex-${++instancias}`;
  readonly tipos = TIPOS;
  readonly modos = MODOS;
  readonly ejemplos = EJEMPLOS;
  readonly maximoVeces = MAXIMO_VECES;
  readonly antes = ANTES_DE_PALABRA;
  readonly despues = DESPUES_DE_PALABRA;

  piezas: Pieza[] = [];
  palabraEntera = true;
  /** La pieza cuyo trozo se resalta en la expresión. */
  resaltada: number | null = null;
  copiada = false;

  /** Lo último que se ha volcado al campo, para saber si lo han retocado. */
  private generada = '';

  textoDePrueba = '';
  prueba: PruebaExpresion | null = null;
  errorDePrueba = '';
  probando = false;
  private temporizador?: ReturnType<typeof setTimeout>;
  /** Cuál es la petición vigente: al escribir salen varias y no llegan en orden. */
  private peticion = 0;

  ngOnChanges(cambios: SimpleChanges): void {
    if (cambios['expresion']) {
      this.programarPrueba();
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
  }

  // --- piezas -------------------------------------------------------------

  get trozos(): string[] {
    return fragmentos(this.piezas);
  }

  get frase(): string {
    return enPalabras(this.piezas, this.palabraEntera);
  }

  /** Han cambiado a mano la expresión que salió de aquí. */
  get retocada(): boolean {
    return this.piezas.length > 0 && this.expresion.trim() !== this.generada;
  }

  comoSeLee(pieza: Pieza): string {
    return describir(pieza);
  }

  color(indice: number): string {
    return `trozo-${indice % COLORES}`;
  }

  necesitaValor(tipo: TipoPieza): boolean {
    return tipo === 'texto' || tipo === 'caracteres' || tipo === 'palabras';
  }

  ayudaDe(tipo: TipoPieza): string {
    return TIPOS.find(t => t.id === tipo)?.ayuda ?? '';
  }

  usarEjemplo(indice: number): void {
    const ejemplo = EJEMPLOS[indice];
    this.piezas = ejemplo.piezas.map(pieza => ({ ...pieza, repeticion: recortar(pieza.repeticion) }));
    if (!this.textoDePrueba.trim()) {
      this.textoDePrueba = `${ejemplo.muestra}\nOtra cosa que no debería salir`;
    }
    this.cambiar();
  }

  anadir(): void {
    this.piezas = [...this.piezas, piezaNueva()];
    this.cambiar();
  }

  cambiarTipo(pieza: Pieza, tipo: TipoPieza): void {
    pieza.tipo = tipo;
    pieza.valor = this.necesitaValor(tipo) ? '' : undefined;
    this.cambiar();
  }

  mover(indice: number, hacia: -1 | 1): void {
    const destino = indice + hacia;
    if (destino < 0 || destino >= this.piezas.length) {
      return;
    }
    const piezas = [...this.piezas];
    [piezas[indice], piezas[destino]] = [piezas[destino], piezas[indice]];
    this.piezas = piezas;
    this.resaltada = destino;
    this.cambiar();
  }

  quitar(indice: number): void {
    this.piezas = this.piezas.filter((_, i) => i !== indice);
    this.resaltada = null;
    this.cambiar();
  }

  vaciar(): void {
    this.piezas = [];
    this.resaltada = null;
    this.cambiar();
  }

  /** Cualquier cambio en las piezas reescribe el campo de la página. */
  cambiar(): void {
    this.generada = construir(this.piezas, this.palabraEntera);
    this.expresionChange.emit(this.generada);
  }

  async copiar(): Promise<void> {
    await copiarAlPortapapeles(this.expresion.trim());
    this.copiada = true;
    setTimeout(() => (this.copiada = false), 1500);
  }

  // --- prueba -------------------------------------------------------------

  programarPrueba(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.probar(), ESPERA);
  }

  private probar(): void {
    const patron = this.expresion.trim();
    const texto = this.textoDePrueba;
    const mia = ++this.peticion;
    if (!patron || !texto.trim()) {
      this.prueba = null;
      this.errorDePrueba = '';
      this.probando = false;
      return;
    }
    this.probando = true;
    this.api.probarExpresion(patron, texto).subscribe({
      next: prueba => {
        if (mia !== this.peticion) {
          return;
        }
        this.probando = false;
        this.prueba = prueba;
        this.errorDePrueba = '';
      },
      error: err => {
        if (mia !== this.peticion) {
          return;
        }
        this.probando = false;
        this.prueba = null;
        this.errorDePrueba = mensajeDeError(err, 'No se ha podido probar la expresión.');
      },
    });
  }
}
