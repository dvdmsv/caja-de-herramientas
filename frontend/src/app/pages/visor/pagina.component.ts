
import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  HostListener, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject,
} from '@angular/core';

import { CampoPdf, DocumentoPdf } from '../../core/pdf.service';
import { VisorRenderService, densidadDePantalla, esCancelacion } from '../../core/visor-render.service';
import { Coincidencia } from './buscador';
import { ColorSubrayado, ColorTachado, Marca, Texto } from './cambios';
import {
  Rect, aPorcentajes, aProporciones, contiene, fusionarRects, girar, puntoAPorcentajes,
  puntoAProporciones,
} from './coordenadas';
import { Rect as Trozo, cubre, escalaDelLienzo, parteVisible, trozoDeDetalle } from './detalle';
import { PaginaColocada } from './disposicion';
import {
  COLORES_CSS, COLORES_TEXTO, ColorTexto, FUENTES, Fuente, INTERLINEADO, altoDeCaja, anchoDeTexto,
  desplazamientoBase, otroTamano, pilaCss,
} from './tipografia';

/** Una marca ya colocada en pantalla. */
interface MarcaPintada {
  clave: string;
  id: string;
  tipo: Marca['tipo'];
  color: string;
  estilo: Record<string, string>;
}

/**
 * El menú flotante de la página, con tres formas: el de una marca ya puesta
 * —colores y quitar—, el que sale al terminar de seleccionar texto y el de la
 * letra, mientras se escribe.
 *
 * Es uno solo y no tres a propósito: así no pueden quedarse dos abiertos, y
 * comparten colocación, estilos y cierre. El de la letra no lleva de quién es,
 * porque sólo existe mientras hay una caja abierta y eso ya lo dice `edicion`.
 */
type MenuFlotante =
  | { menu: 'marca'; id: string; tipo: Marca['tipo']; color: string; estilo: Record<string, string> }
  | { menu: 'seleccion'; rects: Rect[]; texto: string; estilo: Record<string, string> }
  | { menu: 'texto'; estilo: Record<string, string> };

export interface CambioDeColor {
  id: string;
  color: ColorSubrayado | ColorTachado;
}

/** Lo que se pide hacer con un texto recién seleccionado. */
export interface AccionSeleccion {
  accion: 'subrayar' | 'tachar' | 'copiar' | 'buscar';
  pagina: number;
  rects: Rect[];
  texto: string;
  color?: ColorSubrayado;
}

const COLORES_SUBRAYADO: ColorSubrayado[] = ['amarillo', 'verde', 'azul', 'rosa'];
const COLORES_TACHADO: ColorTachado[] = ['negro', 'blanco'];

/** Hasta aquí el puntero se ha movido demasiado poco: fue un clic, no un arrastre. */
const UMBRAL_ARRASTRE = 5;

/** El estilo con el que sale un texto nuevo, que fija la barra de herramientas. */
export interface EstiloEscritura {
  fuente: Fuente;
  tamano: number;
  color: ColorTexto;
  negrita: boolean;
  cursiva: boolean;
}

/** Un texto escrito, ya colocado sobre la página. */
interface TextoPintado {
  id: string;
  contenido: string;
  estilo: Record<string, string>;
}

/** Un campo del formulario, ya colocado y con lo que hay escrito en él. */
interface CampoPintado {
  campo: CampoPdf;
  valor: string;
  estilo: Record<string, string>;
}

/** Lo que se escribe en un campo del formulario. */
export interface CampoRelleno {
  nombre: string;
  valor: string;
  /** El que traía el archivo, para saber si se ha vuelto a dejar como estaba. */
  original: string;
}

/** Un texto nuevo todavía no existe en el documento: se apunta con esta clave. */
const NUEVO = 'nuevo';

/**
 * Lo que mide de ancho el menú de la letra, para no dejarlo salirse de la hoja.
 *
 * Se arranca con una medida realista y se corrige con la de verdad en cuanto se
 * pinta por primera vez: así sigue valiendo si algún día lleva un botón más.
 */
let anchoMenuLetra = 336;

/** Lo que se está escribiendo ahora mismo, si algo. */
interface Edicion {
  /** `null` mientras la caja es nueva y aún no se ha escrito nada en ella. */
  id: string | null;
  valor: string;
  /** Sólo para la caja nueva, que no está en el documento. */
  x: number;
  y: number;
}

/** Lo que se pide crear o cambiar de un texto. */
export interface TextoNuevo {
  x: number;
  y: number;
  rotacion: number;
  texto: string;
}

export interface TextoEditado {
  id: string;
  texto: string;
}

export interface TextoMovido {
  id: string;
  x: number;
  y: number;
}

/** Lo que emite la página cuando el usuario termina de seleccionar texto. */
export interface Seleccion {
  pagina: number;
  rects: Rect[];
  texto: string;
}

@Component({
  selector: 'app-visor-pagina',
  imports: [],
  templateUrl: './pagina.component.html',
  styleUrls: ['./pagina.component.css', './capa-texto.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisorPaginaComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('lienzo', { static: true }) lienzoRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('detalle', { static: true }) detalleRef!: ElementRef<HTMLElement>;
  @ViewChild('capaTexto', { static: true }) capaTextoRef!: ElementRef<HTMLElement>;
  @ViewChild('caja', { static: true }) cajaRef!: ElementRef<HTMLElement>;
  @ViewChild('campo') campoRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('menuFlotante') menuRef?: ElementRef<HTMLElement>;

  @Input({ required: true }) documento!: DocumentoPdf;
  @Input({ required: true }) colocada!: PaginaColocada;
  @Input({ required: true }) escala!: number;
  @Input() marcas: Marca[] = [];
  @Input() coincidencias: Coincidencia[] = [];
  @Input() resaltadaActual = -1;
  /**
   * Si hay una herramienta de marcado activa. Leyendo, la selección es del
   * usuario —para copiar— y no se toca.
   */
  @Input() marcando = false;
  /** Si al soltar una selección leyendo se ofrece el menú de acciones. */
  @Input() menuAlSeleccionar = true;
  /** Textos escritos encima del documento; se filtran los de esta página. */
  @Input() textos: Texto[] = [];
  /** Si la herramienta de escribir está activa: un clic en hueco abre una caja. */
  @Input() escribiendo = false;
  /** Cuál está seleccionado, para saber a quién aplica lo que se toque en la barra. */
  @Input() textoActivo: string | null = null;
  /** Con qué sale el próximo texto que se escriba. */
  @Input() estiloEscritura: EstiloEscritura = {
    fuente: 'sans', tamano: 12, color: 'negro', negrita: false, cursiva: false,
  };
  /** Lo escrito en los campos del formulario, por nombre. */
  @Input() valoresDeCampos = new Map<string, string>();
  /** Si se enseñan los campos rellenables que trae el documento. */
  @Input() conFormulario = true;

  @Output() seleccionado = new EventEmitter<Seleccion>();
  /** Quitar esta marca. */
  @Output() marcaPulsada = new EventEmitter<string>();
  @Output() colorCambiado = new EventEmitter<CambioDeColor>();
  @Output() accionSeleccion = new EventEmitter<AccionSeleccion>();
  @Output() textoCreado = new EventEmitter<TextoNuevo>();
  @Output() textoEditado = new EventEmitter<TextoEditado>();
  @Output() textoMovido = new EventEmitter<TextoMovido>();
  @Output() textoQuitado = new EventEmitter<string>();
  /** Cuál se ha pulsado, o `null` al pulsar fuera de todos. */
  @Output() textoPulsado = new EventEmitter<string | null>();
  /** Lo que se ha cambiado de la letra desde el menú flotante. */
  @Output() estiloPedido = new EventEmitter<Partial<EstiloEscritura>>();
  /** Lo que se acaba de escribir en un campo del formulario. */
  @Output() campoRelleno = new EventEmitter<CampoRelleno>();
  /** Cuántos campos rellenables tiene esta página, para que el visor lo sepa. */
  @Output() camposEncontrados = new EventEmitter<number>();

  dibujada = false;
  pintadas: MarcaPintada[] = [];
  resaltados: Record<string, string>[] = [];
  /** Menú abierto sobre la página, si lo hay. */
  menu: MenuFlotante | null = null;
  /** Los textos de esta página, listos para pintar. */
  textosPintados: TextoPintado[] = [];
  /** Los campos rellenables de esta página. */
  camposPintados: CampoPintado[] = [];
  /** Lo que se está escribiendo ahora mismo, si algo. */
  edicion: Edicion | null = null;

  readonly porClave = (_: number, pintada: MarcaPintada) => pintada.clave;
  readonly porIdTexto = (_: number, pintado: TextoPintado) => pintado.id;
  readonly claveNueva = NUEVO;
  readonly fuentes = FUENTES;
  readonly tintas = COLORES_TEXTO;
  readonly porNombre = (_: number, pintado: CampoPintado) => pintado.campo.nombre;
  readonly pilaCss = pilaCss;

  private readonly render = inject(VisorRenderService);
  private readonly cd = inject(ChangeDetectorRef);
  private fragmentos: HTMLElement[] = [];
  private campos: CampoPdf[] = [];
  private origenPuntero: { x: number; y: number } | null = null;
  private clave = '';
  private textoMontado = '';
  /** El texto que se está arrastrando, con su posición mientras dura el gesto. */
  private arrastre: { id: string; x: number; y: number; movido: boolean;
                      agarre: { x: number; y: number } } | null = null;

  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly zone = inject(NgZone);
  /** A qué escala se ha dibujado la página entera (menos que `escala` si no cabía). */
  private escalaPagina = 0;
  /** El trozo nítido que hay pintado encima, o el que se está pintando. */
  private trozo: Trozo | null = null;
  private claveDetalle = '';
  private lectura: HTMLElement | null = null;
  private esperaDetalle = 0;
  /** Desplazarse no pasa por Angular: el repaso nítido se pide al pararse. */
  private readonly alDesplazar = (): void => {
    clearTimeout(this.esperaDetalle);
    this.esperaDetalle = window.setTimeout(() => this.repasarDetalle(), 120);
  };

  /**
   * Un clic en cualquier otro sitio —la barra, otra página, el panel— cierra el
   * menú. Sin esto sólo se cerraba pulsando dentro de la propia página, y en el
   * hueco gris de alrededor se quedaba abierto.
   */
  @HostListener('document:pointerdown', ['$event'])
  alPulsarEnOtroSitio(evento: PointerEvent): void {
    if (this.menu && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.menu = null;
      this.cd.markForCheck();
    }
  }

  async ngOnChanges(cambios: SimpleChanges): Promise<void> {
    // Cambiar de herramienta o apagar el menú deja sin sentido el que hubiera
    // abierto.
    if (cambios['marcando'] || cambios['menuAlSeleccionar'] || cambios['escribiendo']) {
      this.menu = null;
    }
    if (cambios['marcas'] || cambios['colocada']) {
      this.colocarMarcas();
    }
    if (cambios['valoresDeCampos'] || cambios['colocada']) {
      this.colocarCampos();
    }
    if (cambios['textos'] || cambios['colocada'] || cambios['escala']
        || cambios['estiloEscritura']) {
      this.pintarTextos();
      if (this.menu?.menu === 'texto') {
        this.abrirMenuDeLetra();
      }
    }
    if (cambios['escribiendo'] && !this.escribiendo) {
      this.cerrarEdicion();
    }
    if (cambios['coincidencias'] || cambios['resaltadaActual']) {
      this.colocarCoincidencias();
    }
    if (cambios['documento']
        || (cambios['colocada'] && this.cambioDeVerdad(cambios['colocada']))) {
      await this.cargarCampos();
    }
    if (this.hayQueRedibujar(cambios)) {
      await this.dibujar();
    }
  }

  ngAfterViewInit(): void {
    this.lectura = this.elemento.nativeElement.closest('.lectura');
    this.zone.runOutsideAngular(() => {
      this.lectura?.addEventListener('scroll', this.alDesplazar, { passive: true });
      window.addEventListener('resize', this.alDesplazar, { passive: true });
    });
  }

  ngOnDestroy(): void {
    // La página se desmonta al salir de pantalla: lo que se estuviera
    // escribiendo se da por escrito antes de perderlo.
    this.cerrarEdicion();
    this.render.cancelar(this.clave);
    this.render.liberar(this.lienzoRef.nativeElement);
    this.lectura?.removeEventListener('scroll', this.alDesplazar);
    window.removeEventListener('resize', this.alDesplazar);
    clearTimeout(this.esperaDetalle);
    this.quitarDetalle();
  }

  // --- dibujo -----------------------------------------------------------

  private hayQueRedibujar(cambios: SimpleChanges): boolean {
    return !!(cambios['documento'] || cambios['escala']
      || (cambios['colocada'] && this.cambioDeVerdad(cambios['colocada'])));
  }

  private cambioDeVerdad(cambio: { previousValue?: PaginaColocada; currentValue: PaginaColocada }): boolean {
    const antes = cambio.previousValue;
    return !antes || antes.numero !== cambio.currentValue.numero
      || antes.rotacion !== cambio.currentValue.rotacion;
  }

  private async dibujar(): Promise<void> {
    const { numero, rotacion, ancho, alto } = this.colocada;
    // La clave es la de la escala pedida, que es la que usa `priorizar`; el
    // lienzo puede ir a menos, pero eso no cambia qué página es.
    this.clave = `${numero}:${rotacion}:${this.escala}`;
    this.escalaPagina = escalaDelLienzo(ancho / this.escala, alto / this.escala, this.escala,
                                        densidadDePantalla());
    this.dibujada = false;
    this.quitarDetalle();

    try {
      await this.render.dibujar(this.documento, numero, rotacion, this.escalaPagina,
                                this.lienzoRef.nativeElement, this.clave);
      this.dibujada = true;
      this.cd.markForCheck();
      // La capa de texto va siempre a la escala de verdad, aunque el lienzo no:
      // es la que tiene que caer encima de lo que se ve.
      await this.montarTexto(this.escala);
      this.repasarDetalle();
    } catch (err) {
      // Que se cancele es lo normal al desplazarse deprisa, no un problema.
      if (!esCancelacion(err)) {
        console.error(`No se ha podido dibujar la página ${numero}:`, err);
      }
    }
  }

  private async montarTexto(escala: number): Promise<void> {
    const contenedor = this.capaTextoRef.nativeElement;
    if (this.textoMontado === this.clave) {
      return;
    }

    const pagina = await this.documento.pagina(this.colocada.numero);
    // Ojo: en píxeles CSS, no en píxeles reales. El lienzo se dibuja a más
    // resolución para que se vea nítido, pero el texto tiene que caer justo
    // encima de lo que se ve.
    const viewport = pagina.getViewport({
      scale: escala,
      rotation: (pagina.rotate + this.colocada.rotacion) % 360,
    });
    contenedor.style.setProperty('--total-scale-factor', String(escala));
    this.fragmentos = await this.documento.capaTexto(this.colocada.numero, viewport, contenedor);
    this.textoMontado = this.clave;
    this.colocarCoincidencias();
    this.cd.markForCheck();
  }

  // --- repaso nítido a zoom alto ----------------------------------------

  /**
   * Si la página no cabe en un lienzo a su escala, dibuja encima el trozo que
   * se ve a resolución completa (`detalle.ts`). Sin caché, como el resto: el
   * trozo muere al cambiar de zoom o al salir la página de pantalla.
   */
  private async repasarDetalle(): Promise<void> {
    if (!this.dibujada || !this.lectura) {
      return;
    }
    const visible = parteVisible(this.elemento.nativeElement.getBoundingClientRect(),
                                 this.lectura.getBoundingClientRect());
    if (cubre(this.trozo, visible)) {
      return;
    }
    const trozo = trozoDeDetalle(visible, this.colocada, this.escalaPagina, this.escala);
    if (!trozo) {
      return;
    }
    const { numero, rotacion } = this.colocada;
    this.render.cancelar(this.claveDetalle);
    const clave = `${this.clave}:detalle:${trozo.x},${trozo.y},${trozo.ancho},${trozo.alto}`;
    this.claveDetalle = clave;
    this.trozo = trozo;
    // En un lienzo nuevo, y se cambia al terminar: pintando sobre el que está a
    // la vista, se vería la página blanda mientras dura.
    const lienzo = document.createElement('canvas');
    try {
      await this.render.dibujar(this.documento, numero, rotacion, this.escala, lienzo, clave, trozo);
    } catch (err) {
      this.render.liberar(lienzo);
      if (this.claveDetalle === clave) {
        this.trozo = null;
      }
      if (!esCancelacion(err)) {
        console.error(`No se ha podido repasar la página ${numero}:`, err);
      }
      return;
    }
    if (this.claveDetalle !== clave) {
      this.render.liberar(lienzo);
      return;
    }
    // A mano: un lienzo creado aquí no lleva el atributo del encapsulado, y
    // las reglas del CSS del componente no lo alcanzarían.
    Object.assign(lienzo.style, {
      position: 'absolute', left: `${trozo.x}px`, top: `${trozo.y}px`,
      width: `${trozo.ancho}px`, height: `${trozo.alto}px`,
    });
    const contenedor = this.detalleRef.nativeElement;
    contenedor.querySelectorAll('canvas').forEach(viejo => this.render.liberar(viejo));
    contenedor.replaceChildren(lienzo);
  }

  private quitarDetalle(): void {
    this.render.cancelar(this.claveDetalle);
    this.claveDetalle = '';
    this.trozo = null;
    const contenedor = this.detalleRef?.nativeElement;
    contenedor?.querySelectorAll('canvas').forEach(viejo => this.render.liberar(viejo));
    contenedor?.replaceChildren();
  }

  // --- marcas y coincidencias -------------------------------------------

  private colocarMarcas(): void {
    this.pintadas = this.marcas
      .filter(marca => marca.pagina === this.colocada.numero)
      .flatMap(marca => marca.rects.map((rect, i) => ({
        clave: `${marca.id}:${i}:${marca.color}`,
        id: marca.id,
        tipo: marca.tipo,
        color: marca.color,
        estilo: aPorcentajes(rect, this.colocada.rotacion),
      })));
    // Si la marca del menú ha desaparecido, el menú sobra.
    const abierto = this.menu;
    if (abierto?.menu === 'marca' && !this.marcas.some(marca => marca.id === abierto.id)) {
      this.menu = null;
    }
  }

  // --- menú de una marca ------------------------------------------------

  get coloresDelMenu(): string[] {
    return this.menu?.menu === 'marca' && this.menu.tipo === 'tachado'
      ? COLORES_TACHADO
      : COLORES_SUBRAYADO;
  }

  /** Un color: cambia el de la marca, o subraya lo seleccionado. */
  elegirColor(color: string): void {
    const abierto = this.menu;
    if (!abierto) {
      return;
    }
    if (abierto.menu === 'marca') {
      this.colorCambiado.emit({ id: abierto.id, color: color as ColorSubrayado | ColorTachado });
    } else if (abierto.menu === 'seleccion') {
      this.emitirAccion(abierto, 'subrayar', color as ColorSubrayado);
    } else {
      // El de la letra tiene sus propias tintas, en `elegirTinta`.
      return;
    }
    this.menu = null;
  }

  /** Marca el color que ya tiene la marca abierta, si el menú es de una marca. */
  esElColorPuesto(color: string): boolean {
    return this.menu?.menu === 'marca' && this.menu.color === color;
  }

  /**
   * La selección se da por gastada al elegir algo del menú.
   *
   * Además de que ya no pinta nada, dejarla viva daba problemas: al arrastrar
   * empezando dentro de una selección que sigue ahí, el navegador entiende que
   * se quiere mover el texto y no crea una selección nueva.
   */
  private soltarSeleccion(): void {
    window.getSelection()?.removeAllRanges();
  }

  quitarDelMenu(): void {
    if (this.menu?.menu === 'marca') {
      this.marcaPulsada.emit(this.menu.id);
      this.menu = null;
    }
  }

  /** Tachar, copiar o buscar lo que se acaba de seleccionar. */
  accionar(accion: AccionSeleccion['accion']): void {
    if (this.menu?.menu === 'seleccion') {
      this.emitirAccion(this.menu, accion);
      this.menu = null;
    }
  }

  private emitirAccion(abierto: Extract<MenuFlotante, { menu: 'seleccion' }>,
                       accion: AccionSeleccion['accion'], color?: ColorSubrayado): void {
    this.soltarSeleccion();
    this.accionSeleccion.emit({
      accion,
      color,
      pagina: this.colocada.numero,
      rects: abierto.rects,
      texto: abierto.texto,
    });
  }

  cerrarMenu(): void {
    this.menu = null;
  }

  /** Centrado bajo la zona indicada, dentro de la caja de la página. */
  private colocarBajo(rect: Rect): Record<string, string> {
    const { left, top, width } = aPorcentajes(rect, this.colocada.rotacion);
    return { left: `calc(${left} + ${width} / 2)`, top: `calc(${top} + 1.4rem)` };
  }

  /**
   * El menú de la letra, junto a la caja que se está escribiendo.
   *
   * Va **encima** y no debajo como los otros: el punto guardado es la línea
   * base de la primera línea, así que debajo taparía el resto. Encima despeja
   * el texto haya las líneas que haya, y sólo si la caja está tan arriba que no
   * cabría se pasa debajo del todo.
   *
   * Se trabaja en el espacio de lo que se ve, no en el de la página sin girar:
   * el menú es interfaz, y arriba y abajo son los de la pantalla.
   */
  private colocarJuntoAlTexto(x: number, y: number, lineas: number,
                              tamanoPx: number): Record<string, string> {
    const anchoPx = this.colocada.ancho || 1;
    const altoPx = this.colocada.alto || 1;
    const base = desplazamientoBase(this.estiloEscritura.fuente, this.estiloEscritura.negrita,
                                    this.estiloEscritura.cursiva, tamanoPx);
    const [centrado, encima] = girar([x, y, x, y], this.colocada.rotacion);

    const arriba = encima - base / altoPx;
    const abajo = encima + ((lineas - 1) * INTERLINEADO * tamanoPx) / altoPx;
    const cabeEncima = arriba > 0.06;

    // Y que no se salga de la hoja por los lados: es ancho, y junto a un hueco
    // pegado al margen se quedaba media fuera.
    const mitad = anchoMenuLetra / 2 / anchoPx;
    const izquierda = mitad * 2 >= 1 ? 0.5 : Math.min(Math.max(centrado, mitad), 1 - mitad);

    return {
      left: `${(izquierda * 100).toFixed(3)}%`,
      top: cabeEncima
        ? `calc(${(arriba * 100).toFixed(3)}% - 2.5rem)`
        : `calc(${(abajo * 100).toFixed(3)}% + 1.6rem)`,
    };
  }

  /** Abre o recoloca el menú de la letra sobre la caja que se esté escribiendo. */
  private abrirMenuDeLetra(): void {
    const edicion = this.edicion;
    if (!edicion) {
      return;
    }
    const texto = edicion.id ? this.textos.find(t => t.id === edicion.id) : null;
    const x = texto?.x ?? edicion.x;
    const y = texto?.y ?? edicion.y;
    const tamanoPx = this.estiloEscritura.tamano * this.escala;
    this.menu = {
      menu: 'texto',
      estilo: this.colocarJuntoAlTexto(x, y, edicion.valor.split('\n').length, tamanoPx),
    };
    this.medirMenu();
  }

  /** Se mide una vez pintado; si no era lo que se creía, se recoloca. */
  private medirMenu(): void {
    setTimeout(() => {
      const ancho = this.menuRef?.nativeElement.offsetWidth;
      if (ancho && Math.abs(ancho - anchoMenuLetra) > 2) {
        anchoMenuLetra = ancho;
        this.abrirMenuDeLetra();
        this.cd.markForCheck();
      }
    });
  }

  // --- lo que se pulsa en el menú de la letra ---------------------------

  elegirFuente(fuente: Fuente): void {
    this.estiloPedido.emit({ fuente });
  }

  cambiarCuerpo(direccion: 1 | -1): void {
    this.estiloPedido.emit({ tamano: otroTamano(this.estiloEscritura.tamano, direccion) });
  }

  alternarNegrita(): void {
    this.estiloPedido.emit({ negrita: !this.estiloEscritura.negrita });
  }

  alternarCursiva(): void {
    this.estiloPedido.emit({ cursiva: !this.estiloEscritura.cursiva });
  }

  elegirTinta(color: ColorTexto): void {
    this.estiloPedido.emit({ color });
  }

  /** La papelera del menú de la letra. */
  quitarTextoDelMenu(): void {
    const edicion = this.edicion;
    this.edicion = null;
    this.menu = null;
    if (edicion?.id) {
      this.textoQuitado.emit(edicion.id);
    }
    // Una caja nueva y vacía se descarta sin más: no llegó a existir.
    this.pintarTextos();
  }

  /**
   * Que pulsar en el menú no le quite el foco al texto.
   *
   * Sin esto, el `blur` del campo daría por escrita la caja en cuanto se toca
   * cualquier botón: se elige el cuerpo y desaparece el cursor a media palabra.
   * Cancelar el `mousedown` evita el cambio de foco sin impedir el clic; por eso
   * el menú son botones y no un desplegable, que sí se llevaría el foco.
   */
  sinRobarElFoco(evento: Event): void {
    evento.preventDefault();
  }

  /**
   * Abre el menú de la marca que haya bajo el punto pulsado.
   *
   * La búsqueda se hace a mano porque las marcas no capturan el ratón: si lo
   * hicieran, no se podría seleccionar el texto que hay debajo, que es
   * justamente lo que hace falta para volver a subrayarlo.
   */
  private abrirMenuEn(x: number, y: number): boolean {
    const caja = this.cajaRef.nativeElement.getBoundingClientRect();
    const [px, py] = puntoAProporciones(x, y, caja, this.colocada.rotacion);

    // De la última a la primera: se atiende a la de encima.
    const encontrada = [...this.marcas]
      .filter(marca => marca.pagina === this.colocada.numero)
      .reverse()
      .find(marca => marca.rects.some(rect => contiene(rect, px, py)));
    if (!encontrada) {
      return false;
    }

    const rect = encontrada.rects.find(r => contiene(r, px, py))!;
    const { left, top, width } = aPorcentajes(rect, this.colocada.rotacion);
    this.menu = {
      menu: 'marca',
      id: encontrada.id,
      tipo: encontrada.tipo,
      color: encontrada.color,
      estilo: this.colocarBajo(rect),
    };
    return true;
  }

  /**
   * Coloca lo que ha encontrado el buscador.
   *
   * Se hace aquí porque los rectángulos salen de los fragmentos de la capa de
   * texto, que sólo existen en las páginas que están en pantalla.
   */
  private colocarCoincidencias(): void {
    if (!this.fragmentos.length) {
      this.resaltados = [];
      return;
    }
    const caja = this.cajaRef.nativeElement.getBoundingClientRect();
    this.resaltados = this.coincidencias
      .filter(c => c.pagina === this.colocada.numero)
      .flatMap(c => c.fragmentos
        .map(indice => this.fragmentos[indice])
        .filter(Boolean)
        .map(fragmento => {
          const rect = fragmento.getBoundingClientRect();
          const proporcion = aProporciones(rect, caja, this.colocada.rotacion);
          return { ...aPorcentajes(proporcion, this.colocada.rotacion), clave: `${c.pagina}:${c.inicio}` };
        }));
  }

  // --- campos rellenables del propio PDF ---------------------------------

  /**
   * Pide los campos de esta página y los coloca.
   *
   * Se piden una sola vez por página: son del archivo y no cambian. Si el
   * documento no es un formulario, la lista viene vacía y no cuesta nada.
   */
  private async cargarCampos(): Promise<void> {
    const numero = this.colocada.numero;
    try {
      this.campos = await this.documento.campos(numero);
    } catch {
      this.campos = [];   // un formulario roto no debe impedir leer el documento
    }
    if (this.colocada.numero !== numero) {
      return;             // la página se reutilizó para otra mientras tanto
    }
    this.camposEncontrados.emit(this.campos.length);
    this.colocarCampos();
    this.cd.markForCheck();
  }

  private colocarCampos(): void {
    this.camposPintados = this.campos.map(campo => ({
      campo,
      valor: this.valoresDeCampos.get(campo.nombre) ?? campo.valor,
      estilo: aPorcentajes(campo.rect, this.colocada.rotacion),
    }));
  }

  /** ¿Está marcada esta casilla o esta opción? */
  estaMarcado(pintado: CampoPintado): boolean {
    return pintado.valor === pintado.campo.marcado;
  }

  alEscribirCampo(pintado: CampoPintado, evento: Event): void {
    const destino = evento.target as HTMLInputElement | HTMLSelectElement;
    const valor = pintado.campo.tipo === 'casilla' || pintado.campo.tipo === 'opcion'
      ? ((destino as HTMLInputElement).checked ? pintado.campo.marcado : '')
      : destino.value;
    this.campoRelleno.emit({ nombre: pintado.campo.nombre, valor, original: pintado.campo.valor });
  }

  // --- textos escritos encima -------------------------------------------

  /**
   * Coloca los textos de esta página.
   *
   * El punto guardado es el **inicio de la línea base**, así que la caja se
   * sube lo que mide el ascendente: es la única referencia que el navegador y
   * PyMuPDF sitúan igual. El giro es la diferencia entre cómo está la página
   * ahora y cómo estaba al escribir, para que el texto gire con ella.
   */
  private pintarTextos(): void {
    const propios = this.textos.filter(texto => texto.pagina === this.colocada.numero);
    this.textosPintados = propios.map(texto => {
      const enEdicion = this.edicion?.id === texto.id;
      const contenido = enEdicion ? this.edicion!.valor : texto.texto;
      const movido = this.arrastre?.id === texto.id ? this.arrastre : null;
      return this.pintar(texto.id, contenido, movido?.x ?? texto.x, movido?.y ?? texto.y,
                        texto.rotacion, texto);
    });

    // La caja recién abierta todavía no está en el documento, pero se pinta igual.
    if (this.edicion && this.edicion.id === null) {
      this.textosPintados.push(this.pintar(NUEVO, this.edicion.valor, this.edicion.x,
                                           this.edicion.y, this.colocada.rotacion,
                                           this.estiloEscritura));
    }
  }

  private pintar(id: string, contenido: string, x: number, y: number, rotacion: number,
                 estilo: EstiloEscritura): TextoPintado {
    // En pdf.js la escala 1 es un píxel por punto, así que el cuerpo en puntos
    // se convierte multiplicando y el zoom no lo descuadra.
    const tamanoPx = estilo.tamano * this.escala;
    const lineas = contenido.split('\n');
    const base = desplazamientoBase(estilo.fuente, estilo.negrita, estilo.cursiva, tamanoPx);
    const giro = (((this.colocada.rotacion - rotacion) % 360) + 360) % 360;
    const { left, top } = puntoAPorcentajes(x, y, this.colocada.rotacion);

    return {
      id,
      contenido,
      estilo: {
        left,
        top,
        // Un pelo de más para el cursor y para el vuelo de la cursiva.
        width: `${Math.ceil(anchoDeTexto(contenido, estilo.fuente, estilo.negrita,
                                         estilo.cursiva, tamanoPx) + tamanoPx * 0.25) + 2}px`,
        height: `${altoDeCaja(lineas.length, tamanoPx)}px`,
        // Se gira alrededor del punto guardado y después se sube hasta la
        // línea base: el orden importa, porque el desplazamiento es en el
        // sentido propio del texto, no en el de la pantalla.
        transform: `rotate(${giro}deg) translateY(${-base}px)`,
        'transform-origin': '0 0',
        'font-family': pilaCss(estilo.fuente),
        'font-size': `${tamanoPx}px`,
        'font-weight': estilo.negrita ? 'bold' : 'normal',
        'font-style': estilo.cursiva ? 'italic' : 'normal',
        'line-height': `${INTERLINEADO * tamanoPx}px`,
        color: COLORES_CSS[estilo.color],
      },
    };
  }

  /** ¿Es ésta la caja en la que se está escribiendo? */
  seEstaEscribiendo(pintado: TextoPintado): boolean {
    return !!this.edicion
      && (this.edicion.id === pintado.id || (this.edicion.id === null && pintado.id === NUEVO));
  }

  /** Abre una caja donde se ha pulsado. El punto es la línea base: se escribe *sobre* la raya. */
  private abrirCajaNueva(x: number, y: number): void {
    this.cerrarEdicion();
    this.edicion = { id: null, valor: '', x, y };
    this.textoPulsado.emit(null);
    this.abrirMenuDeLetra();
    this.pintarTextos();
    this.enfocarCampo();
  }

  private editarTexto(texto: Texto): void {
    if (this.edicion?.id === texto.id) {
      return;
    }
    this.cerrarEdicion();
    this.edicion = { id: texto.id, valor: texto.texto, x: texto.x, y: texto.y };
    this.abrirMenuDeLetra();
    this.pintarTextos();
    this.enfocarCampo();
  }

  /** El campo aparece en el ciclo siguiente; hasta entonces no hay dónde poner el cursor. */
  private enfocarCampo(): void {
    setTimeout(() => {
      const campo = this.campoRef?.nativeElement;
      if (campo) {
        campo.focus();
        campo.setSelectionRange(campo.value.length, campo.value.length);
      }
    });
  }

  alEscribir(evento: Event): void {
    if (this.edicion) {
      this.edicion.valor = (evento.target as HTMLTextAreaElement).value;
      // Repintar para que la caja crezca con lo escrito, y que el menú la siga
      // si se añaden líneas.
      this.abrirMenuDeLetra();
      this.pintarTextos();
      this.cd.markForCheck();
    }
  }

  alTeclearEnTexto(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      this.cerrarEdicion();
      this.cd.markForCheck();
    }
  }

  /**
   * Da por escrito lo que hubiera en la caja.
   *
   * Una caja que se queda vacía no deja rastro: ni un texto en blanco en el
   * documento ni un paso de deshacer que no se vería.
   */
  cerrarEdicion(): void {
    const edicion = this.edicion;
    if (!edicion) {
      return;
    }
    this.edicion = null;
    if (this.menu?.menu === 'texto') {
      this.menu = null;
    }
    const valor = edicion.valor.replace(/\s+$/, '');

    if (edicion.id === null) {
      if (valor.trim()) {
        this.textoCreado.emit({ x: edicion.x, y: edicion.y,
                                rotacion: this.colocada.rotacion, texto: valor });
      }
    } else if (!valor.trim()) {
      this.textoQuitado.emit(edicion.id);
    } else {
      this.textoEditado.emit({ id: edicion.id, texto: valor });
    }
    this.pintarTextos();
  }

  /**
   * Un texto se arrastra para moverlo y se pulsa para escribir en él.
   *
   * Se decide por el gesto, igual que con las marcas: si el puntero apenas se
   * ha movido fue un clic.
   */
  alPulsarTexto(evento: PointerEvent, pintado: TextoPintado): void {
    // En la caja que se está escribiendo manda el cursor, no el arrastre.
    if (pintado.id === NUEVO || this.edicion?.id === pintado.id) {
      evento.stopPropagation();
      return;
    }
    const texto = this.textos.find(t => t.id === pintado.id);
    if (!texto) {
      return;
    }

    evento.preventDefault();
    evento.stopPropagation();
    if (this.menu?.menu === 'texto') {
      this.menu = null;
    }
    (evento.target as HTMLElement).setPointerCapture?.(evento.pointerId);

    const caja = this.cajaRef.nativeElement.getBoundingClientRect();
    const [gx, gy] = girar([texto.x, texto.y, texto.x, texto.y], this.colocada.rotacion);
    this.arrastre = {
      id: texto.id,
      x: texto.x,
      y: texto.y,
      movido: false,
      // Lo que separa al puntero del punto de anclaje, para que no dé un salto.
      agarre: {
        x: evento.clientX - (caja.left + gx * caja.width),
        y: evento.clientY - (caja.top + gy * caja.height),
      },
    };
    this.textoPulsado.emit(texto.id);
  }

  alMoverTexto(evento: PointerEvent): void {
    const arrastre = this.arrastre;
    if (!arrastre) {
      return;
    }
    const caja = this.cajaRef.nativeElement.getBoundingClientRect();
    const [x, y] = puntoAProporciones(evento.clientX - arrastre.agarre.x,
                                      evento.clientY - arrastre.agarre.y,
                                      caja, this.colocada.rotacion);
    // Movido de verdad, no un temblor de la mano al pulsar.
    arrastre.movido = arrastre.movido
      || Math.abs(x - arrastre.x) > 0.002 || Math.abs(y - arrastre.y) > 0.002;
    arrastre.x = x;
    arrastre.y = y;
    this.pintarTextos();
    this.cd.markForCheck();
  }

  alSoltarTexto(evento: PointerEvent, pintado: TextoPintado): void {
    const arrastre = this.arrastre;
    this.arrastre = null;
    if (!arrastre || arrastre.id !== pintado.id) {
      return;
    }
    (evento.target as HTMLElement).releasePointerCapture?.(evento.pointerId);

    if (arrastre.movido) {
      this.textoMovido.emit({ id: arrastre.id, x: arrastre.x, y: arrastre.y });
    } else {
      const texto = this.textos.find(t => t.id === arrastre.id);
      if (texto) {
        this.editarTexto(texto);
      }
    }
    this.pintarTextos();
    this.cd.markForCheck();
  }

  // --- selección --------------------------------------------------------

  alPulsar(evento: PointerEvent): void {
    this.origenPuntero = { x: evento.clientX, y: evento.clientY };

    // Aquí no se toca la selección: comprobado que limpiarla en el `pointerdown`
    // se lleva por delante el ancla que el navegador acaba de colocar, y
    // entonces el arrastre no selecciona nada. Se suelta al consumirla, en
    // `emitirAccion`.

  }

  /**
   * Qué hacer al soltar el puntero.
   *
   * Se decide por el gesto —clic o arrastre— y no por si hay texto
   * seleccionado: al pulsar dentro de una selección que ya existía, el
   * navegador la mantiene hasta soltar, y mirando sólo la selección el primer
   * clic sobre una marca no hacía nada.
   */
  alSoltar(evento: PointerEvent): void {
    const origen = this.origenPuntero;
    this.origenPuntero = null;

    // Lo que se pulse dentro del menú o de un texto es asunto suyo.
    const destino = evento.target as HTMLElement;
    if (destino?.closest?.('.menu-flotante') || destino?.closest?.('.texto')) {
      return;
    }

    const movido = origen
      ? Math.hypot(evento.clientX - origen.x, evento.clientY - origen.y)
      : Infinity;

    // 1. Escribiendo, un clic en un hueco abre una caja donde se ha pulsado.
    if (this.escribiendo && movido < UMBRAL_ARRASTRE) {
      const caja = this.cajaRef.nativeElement.getBoundingClientRect();
      const [x, y] = puntoAProporciones(evento.clientX, evento.clientY, caja,
                                        this.colocada.rotacion);
      this.abrirCajaNueva(x, y);
      this.cd.markForCheck();
      return;
    }

    // 2. Un clic sobre una marca abre su menú, haya o no selección de por medio.
    if (movido < UMBRAL_ARRASTRE && this.abrirMenuEn(evento.clientX, evento.clientY)) {
      this.cd.markForCheck();
      return;
    }

    const seleccion = window.getSelection();
    const haySeleccion = !!seleccion && !seleccion.isCollapsed && seleccion.rangeCount > 0;

    // 2. Con herramienta de marcado y algo seleccionado, se marca. Vale tanto
    //    para el arrastre de siempre como para el doble clic sobre una palabra.
    // 2. Leyendo, si el menú está encendido, se ofrece qué hacer con lo que se
    //    acaba de seleccionar. La selección no se toca: tiene que seguir
    //    viéndose mientras se decide.
    if (haySeleccion && !this.marcando && !this.escribiendo && this.menuAlSeleccionar
        && movido >= UMBRAL_ARRASTRE) {
      this.abrirMenuDeSeleccion(seleccion!);
      this.cd.markForCheck();
      return;
    }

    if (!haySeleccion || !this.marcando) {
      // Sin nada que marcar, un clic al aire cierra el menú; y leyendo, la
      // selección se queda donde está: es del usuario, que estará copiando.
      if (movido < UMBRAL_ARRASTRE) {
        this.menu = null;
        this.textoPulsado.emit(null);
        this.cd.markForCheck();
      }
      return;
    }
    const medida = this.medirSeleccion(seleccion!);
    if (medida) {
      this.seleccionado.emit({ pagina: this.colocada.numero, ...medida });
      seleccion!.removeAllRanges();
    }
  }

  /** Abre el menú de acciones sobre lo que se acaba de seleccionar. */
  private abrirMenuDeSeleccion(seleccion: Selection): void {
    const medida = this.medirSeleccion(seleccion);
    if (!medida) {
      this.menu = null;
      return;
    }
    this.menu = {
      menu: 'seleccion',
      rects: medida.rects,
      texto: medida.texto,
      // Bajo la última línea, que es donde acaba de soltarse el ratón.
      estilo: this.colocarBajo(medida.rects[medida.rects.length - 1]),
    };
  }

  /**
   * Rectángulos y texto de una selección, en proporciones de la página.
   *
   * Lo usan por igual el subrayado directo y el menú, así que comprobar que la
   * selección es de esta página y fusionar los rectángulos vive en un solo
   * sitio.
   */
  private medirSeleccion(seleccion: Selection): { rects: Rect[]; texto: string } | null {
    const rango = seleccion.getRangeAt(0);
    const capa = this.capaTextoRef.nativeElement;
    // `commonAncestorContainer` puede ser un nodo de texto, de ahí el parentNode.
    const dentro = capa.contains(rango.commonAncestorContainer)
      || capa.contains(rango.commonAncestorContainer.parentNode);
    if (!dentro) {
      return null;
    }

    const caja = this.cajaRef.nativeElement.getBoundingClientRect();
    // `DOMRectList` no es iterable con la configuración de TypeScript del
    // proyecto, de ahí `Array.from`. Y se fusionan porque el navegador devuelve
    // la misma zona repetida cuando la selección abarca elementos enteros: sin
    // eso la marca sale más oscura cuanto más texto se haya cogido.
    const rects = fusionarRects(Array.from(rango.getClientRects())
      .filter(rect => rect.width > 1 && rect.height > 1)
      .map(rect => aProporciones(rect, caja, this.colocada.rotacion)));

    return rects.length ? { rects, texto: seleccion.toString().trim() } : null;
  }
}
