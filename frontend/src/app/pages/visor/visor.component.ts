
import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener,
  NgZone, OnDestroy, ViewChild, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';

import { COMPACTA, cumple } from '../../core/pantalla';
import { TraspasoService } from '../../core/traspaso.service';
import { ApiService, ArchivoServidor, ZonasAnonimizado } from '../../core/api.service';
import { MemoriaDocumentoService } from '../../core/memoria-documento.service';
import { DocumentoPdf, PdfService } from '../../core/pdf.service';
import { VisorRenderService } from '../../core/visor-render.service';
import { avisoError, avisoExito, aviso, confirmar, mensajeDeError } from '../../shared/notify';
import { IDS_DE_DATO, nombreDeDato } from '../../shared/datos-personales';
import { copiarAlPortapapeles } from '../../shared/portapapeles';
import { Coincidencia, IndiceTexto, OpcionesBusqueda } from './buscador';
import { DestinoPdf } from './enlaces';
import { Propiedad, etiquetasUtiles, paginaDeEtiqueta, propiedades } from './documento-info';
import { GestoZoom } from './gesto-zoom';
import { mostrarAtajos } from './atajos';
import { VisorPresentacionComponent } from './presentacion.component';
import { imprimirImagenes, paginasParaImprimir } from './impresion';
import { Punto, anclar, factorPermitido } from './zoom';
import { Cambios, ColorSubrayado, ColorTachado, Marca, Texto } from './cambios';
import {
  Disposicion, MODOS_LECTURA, Medida, ModoLectura, PaginaColocada, calcularDisposicion,
  columnasDe, escalaParaAjustar, filasVisibles, paginaEnFoco, paginaVecina,
} from './disposicion';
import {
  AccionSeleccion, CambioDeColor, CampoRelleno, EstiloEscritura, Seleccion, TextoEditado,
  TextoMovido, TextoNuevo, VisorPaginaComponent,
} from './pagina.component';
import { EntradaIndice, Pestana, VisorPanelComponent } from './panel.component';
import {
  COLORES_TEXTO, ColorTexto, FUENTES, Fuente, TAMANO_MAXIMO, TAMANO_MINIMO, TAMANO_POR_DEFECTO,
  tamanoValido,
} from './tipografia';

type Herramienta = 'leer' | 'subrayar' | 'tachar' | 'texto';
type ModoZoom = 'ancho' | 'pagina' | 'libre';

/** Una página lista para colocarse en el lienzo de lectura. */
interface EnPantalla {
  colocada: PaginaColocada;
  top: number;
}

const SEPARACION = 16;
const ESCALA_MINIMA = 0.2;
const ESCALA_MAXIMA = 6;

/** Cada cuánto se le dice al servidor que seguimos aquí. */
const KEEPALIVE = 15 * 60 * 1000;

/** Cuánto se espera antes de guardar la posición y el borrador en el navegador. */
const ESPERA_MEMORIA = 800;

/** Compartido para que las páginas sin marcas no reciban un array nuevo cada vez. */
const SIN_MARCAS: Marca[] = [];
const SIN_COINCIDENCIAS: Coincidencia[] = [];

/**
 * A partir de cuántas coincidencias se avisa de que repasarlas no es realista.
 *
 * El visor existe para **revisar** antes de borrar; con miles de marcas eso ya
 * no lo hace nadie, y para eso está la herramienta suelta. No se impide —puede
 * que quien lo haga sepa lo que quiere—, se dice.
 */
const REVISABLES = 500;

@Component({
  selector: 'app-visor',
  imports: [FormsModule, RouterLink, VisorPaginaComponent, VisorPanelComponent,
            VisorPresentacionComponent],
  templateUrl: './visor.component.html',
  styleUrl: './visor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('lectura') lecturaRef?: ElementRef<HTMLElement>;
  @ViewChild('lienzo') lienzoRef?: ElementRef<HTMLElement>;

  // --- documento --------------------------------------------------------
  archivo: File | null = null;
  documento: DocumentoPdf | null = null;
  /** Si está desplegada la pregunta de dónde abrir el siguiente documento. */
  preguntandoDonde = false;
  medidas: Medida[] = [];
  indice: EntradaIndice[] = [];
  /** Las etiquetas de página del documento («iv», «A-3»), si aportan algo. */
  etiquetas: string[] | null = null;
  propiedades: Propiedad[] = [];
  cargando = false;
  arrastrando = false;

  // --- vista ------------------------------------------------------------
  escala = 1;
  /**
   * Cómo encaja la página al abrir un documento.
   *
   * En pantalla ancha se enseña la página entera: ajustar al ancho hace que una
   * A4 salga al 190 % y sólo se vea el tercio de arriba, que no es forma de
   * empezar a leer. En una pantalla compacta manda el ancho, porque la página
   * completa dejaría el texto ilegible (y en un móvil apaisado, diminuta).
   */
  modoZoom: ModoZoom = cumple(COMPACTA) ? 'ancho' : 'pagina';
  modoLectura: ModoLectura = 'continuo';
  /** Si está desplegada la elección del modo de lectura en la barra. */
  eligiendoModo = false;
  readonly modosLectura = MODOS_LECTURA;
  readonly nombresModo: Record<ModoLectura, { titulo: string; icono: string }> = {
    continuo: { titulo: 'Todas seguidas', icono: 'bi-view-stacked' },
    pagina: { titulo: 'Página a página', icono: 'bi-file-earmark' },
    dos: { titulo: 'Dos páginas', icono: 'bi-layout-split' },
    libro: { titulo: 'Libro: la portada sola y luego de dos en dos', icono: 'bi-book' },
  };
  oscuro = false;
  /** Si se está en el modo presentación. */
  presentando = false;
  paginaActual = 1;
  visibles: EnPantalla[] = [];
  disposicion: Disposicion = { filas: [], altoTotal: 0, anchoTotal: 0 };

  // --- edición ----------------------------------------------------------
  cambios = new Cambios();
  herramienta: Herramienta = 'leer';
  /** Si al soltar una selección leyendo se ofrece qué hacer con ella. */
  menuAlSeleccionar = true;
  colorSubrayado: ColorSubrayado = 'amarillo';
  colorTachado: ColorTachado = 'negro';
  /** Con qué sale el próximo texto que se escriba. */
  estiloEscritura: EstiloEscritura = {
    fuente: 'sans', tamano: TAMANO_POR_DEFECTO, color: 'negro', negrita: false, cursiva: false,
  };
  /** El texto seleccionado, al que aplica lo que se toque en la barra. */
  textoActivo: string | null = null;
  /** Si el documento trae campos rellenables; hasta saberlo, no se anuncia nada. */
  hayCampos = false;
  /** Si se enseñan esos campos como controles. */
  conFormulario = true;
  /** Si se está buscando datos personales; el botón se apaga mientras tanto. */
  buscandoDatos = false;

  private readonly resultadosPorPagina = new Map<number, Coincidencia[]>();
  private resultadosIndexados: Coincidencia[] | null = null;
  /** Marcas por página, para no filtrar la lista entera en cada repintado. */
  private readonly marcasPorPagina = new Map<number, Marca[]>();
  /** Sobre qué lista se armó el índice; si cambia la identidad, se rehace. */
  private marcasIndexadas: Marca[] | null = null;

  readonly fuentes = FUENTES;
  readonly coloresTexto = COLORES_TEXTO;
  readonly tamanoMinimo = TAMANO_MINIMO;
  readonly tamanoMaximo = TAMANO_MAXIMO;
  guardando = false;
  resultado: ArchivoServidor | null = null;
  /** Mientras se preparan las páginas para imprimir: cuántas van. */
  imprimiendo: { hechas: number; total: number; preparando: boolean } | null = null;
  private cancelarImpresion?: AbortController;

  // --- panel y búsqueda -------------------------------------------------
  /**
   * En pantallas compactas el documento manda: el panel se abre a mano. Cuenta
   * también el móvil apaisado, que por ancho parecería un escritorio.
   */
  panelAbierto = !cumple(COMPACTA);
  pestana: Pestana = 'paginas';
  consulta = '';
  resultados: Coincidencia[] = [];
  resultadoActual = -1;
  opcionesBusqueda: OpcionesBusqueda = { palabraEntera: false, mayusculas: false };
  indexadas = 0;
  indexando = false;

  private readonly traspaso = inject(TraspasoService);
  private readonly api = inject(ApiService);
  private readonly pdf = inject(PdfService);
  private readonly render = inject(VisorRenderService);
  private readonly memoria = inject(MemoriaDocumentoService);
  private readonly zone = inject(NgZone);
  private readonly cd = inject(ChangeDetectorRef);

  private readonly buscador = new IndiceTexto();
  private huella = '';
  private fileId: string | null = null;
  private temporizadorMemoria?: ReturnType<typeof setTimeout>;
  private temporizadorKeepalive?: ReturnType<typeof setInterval>;
  private pendienteDeCuadro = false;
  private pendienteDeTamano = false;
  private observadorTamano?: ResizeObserver;
  private ultimaVentana = '';
  private gesto?: GestoZoom;
  /** El punto fijo del gesto en curso, en coordenadas del lienzo de lectura. */
  private origenGesto: Punto | null = null;

  // --- ciclo de vida ----------------------------------------------------

  constructor() {
    const preferencias = this.memoria.preferencias();
    if (typeof preferencias['menuAlSeleccionar'] === 'boolean') {
      this.menuAlSeleccionar = preferencias['menuAlSeleccionar'] as boolean;
    }
    if (preferencias['modoZoom'] === 'ancho' || preferencias['modoZoom'] === 'pagina') {
      this.modoZoom = preferencias['modoZoom'];
    }
  }

  ngAfterViewInit(): void {
    // El visor es de la familia de los PDF: sus botones, en ese color (estilos/tema.css).
    document.documentElement.dataset['categoria'] = 'pdf';
    // Un PDF que llega de otra herramienta ("Usar en…" o soltado en el inicio).
    const [llegado] = this.traspaso.tomar();
    if (llegado) {
      setTimeout(() => this.abrir(llegado));
    }
    // El desplazamiento no pasa por Angular: se dispara decenas de veces por
    // segundo y sólo interesa cuando cambia lo que hay que enseñar.
    this.zone.runOutsideAngular(() => {
      this.lecturaRef?.nativeElement.addEventListener('scroll', this.alDesplazar, { passive: true });
    });
    this.temporizadorKeepalive = setInterval(() => this.mantenerSesion(), KEEPALIVE);

    // Se vigila el tamaño real del área de lectura en vez de adivinar cuándo
    // cambia. Cubre de una vez el panel que se abre o se cierra, la ventana que
    // se redimensiona y —lo que fallaba— el primer cálculo, que se hacía antes
    // de que el panel existiera en el DOM y dejaba la página descentrada.
    this.zone.runOutsideAngular(() => {
      const lectura = this.lecturaRef?.nativeElement;
      if (lectura) {
        this.observadorTamano = new ResizeObserver(() => this.alCambiarTamano());
        this.observadorTamano.observe(lectura);
        this.gesto = new GestoZoom(lectura,
          factor => factorPermitido(this.escala, factor, ESCALA_MINIMA, ESCALA_MAXIMA),
          (factor, origen) => this.ampliarProvisional(factor, origen),
          (factor, origen) => this.zone.run(() => this.ampliarEn(factor, origen)));
      }
    });
  }

  private readonly alCambiarTamano = (): void => {
    if (!this.documento || this.pendienteDeTamano) {
      return;
    }
    this.pendienteDeTamano = true;
    requestAnimationFrame(() => {
      this.pendienteDeTamano = false;
      this.recalcular();
      this.zone.run(() => this.cd.detectChanges());
    });
  };

  ngOnDestroy(): void {
    if (document.documentElement.dataset['categoria'] === 'pdf') {
      delete document.documentElement.dataset['categoria'];
    }
    this.lecturaRef?.nativeElement.removeEventListener('scroll', this.alDesplazar);
    this.observadorTamano?.disconnect();
    this.gesto?.destruir();
    clearInterval(this.temporizadorKeepalive);
    clearTimeout(this.temporizadorMemoria);
    this.guardarEnMemoria();
    this.documento?.cerrar();
  }

  @HostListener('window:beforeunload', ['$event'])
  alSalir(evento: BeforeUnloadEvent): void {
    this.guardarEnMemoria();
    if (this.cambios.hayAlgo && !this.resultado) {
      evento.preventDefault();
    }
  }

  // --- abrir ------------------------------------------------------------

  alSoltarArchivo(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando = false;
    const archivo = evento.dataTransfer?.files?.[0];
    if (archivo) {
      this.abrir(archivo);
    }
  }

  alElegirArchivo(evento: Event): void {
    const selector = evento.target as HTMLInputElement;
    const archivo = selector.files?.[0];
    // Se vacía para que volver a elegir el mismo archivo cuente como un cambio:
    // si no, el navegador no avisa y parecería que el botón no hace nada.
    selector.value = '';
    if (archivo) {
      this.preguntandoDonde = false;
      this.abrir(archivo);
    }
  }

  // --- abrir otro documento ---------------------------------------------

  alternarDondeAbrir(): void {
    this.preguntandoDonde = !this.preguntandoDonde;
  }

  /**
   * Recoge la pregunta, pero no ahora mismo.
   *
   * El enlace de la ventana nueva se quita del DOM al recogerla, y quitarlo
   * dentro de su propio clic cancela la navegación: la pestaña no se abría.
   * Se deja para el ciclo siguiente, cuando el navegador ya la ha lanzado.
   */
  cerrarPreguntaDespues(): void {
    setTimeout(() => {
      this.preguntandoDonde = false;
      this.cd.markForCheck();
    });
  }

  /**
   * Cierra la pregunta al pulsar en cualquier otro sitio.
   *
   * Va por `click` y no por `pointerdown`: con `pointerdown` se cerraría antes
   * de que llegara el clic al propio botón de la pregunta.
   */
  @HostListener('document:click', ['$event'])
  alPulsarFueraDeLaPregunta(evento: Event): void {
    if (this.preguntandoDonde
        && !(evento.target as HTMLElement)?.closest?.('.abrir-otro')) {
      this.preguntandoDonde = false;
      this.cd.markForCheck();
    }
  }

  /**
   * Abre otro documento aquí mismo.
   *
   * Lo que estuviera a medias no se pierde —al cerrar se guarda en el
   * navegador y vuelve al abrir otra vez ese archivo—, pero conviene decirlo:
   * lo que no hay es un PDF con los cambios dentro hasta que se guarda.
   */
  async abrirEnEstaVentana(selector: HTMLInputElement): Promise<void> {
    if (this.hayCambios) {
      const seguir = await confirmar(
        'Tienes cambios sin guardar',
        'Se quedan apuntados en este navegador y vuelven al abrir de nuevo este archivo, '
        + 'pero todavía no están dentro del PDF. ¿Abres otro documento?',
        'Abrir otro');
      if (!seguir) {
        return;
      }
    }
    selector.click();
  }

  /**
   * Soltar un PDF encima del que está abierto lo abre aquí, con la misma
   * pregunta que «Abrir otro» si hay cambios sin guardar.
   */
  alArrastrarSobreDocumento(evento: DragEvent): void {
    if (this.documento && evento.dataTransfer?.types.includes('Files')) {
      evento.preventDefault();
      this.arrastrando = true;
    }
  }

  async alSoltarSobreDocumento(evento: DragEvent): Promise<void> {
    if (!this.documento) {
      return;
    }
    evento.preventDefault();
    this.arrastrando = false;
    const archivo = evento.dataTransfer?.files?.[0];
    if (!archivo) {
      return;
    }
    if (this.hayCambios && !await confirmar(
      'Tienes cambios sin guardar',
      'Se quedan apuntados en este navegador y vuelven al abrir de nuevo este archivo, '
      + 'pero todavía no están dentro del PDF. ¿Abres el que has soltado?',
      'Abrir')) {
      return;
    }
    this.abrir(archivo);
  }

  ayuda(): void {
    mostrarAtajos();
  }

  async abrir(archivo: File): Promise<void> {
    // Por la extensión o por el tipo: lo que llega de otro programa al
    // arrastrar a veces no trae «.pdf» en el nombre.
    if (!archivo.name.toLowerCase().endsWith('.pdf') && archivo.type !== 'application/pdf') {
      avisoError('El visor sólo abre archivos PDF.');
      return;
    }

    this.cerrar();
    this.archivo = archivo;
    this.cargando = true;
    this.cd.markForCheck();

    try {
      this.documento = await this.pdf.abrir(archivo);
      this.medidas = await this.documento.medidas();
      this.indice = await this.documento.indice();
      this.etiquetas = etiquetasUtiles(await this.documento.etiquetas());
      // No hace esperar: sólo se ve en una pestaña del panel.
      const abierto = this.documento;
      abierto.datos(archivo.size).then(datos => {
        if (abierto === this.documento) {
          this.propiedades = propiedades(datos);
          this.cd.markForCheck();
        }
      }, err => console.warn('No se han podido leer las propiedades del documento:', err));
      this.huella = await this.memoria.huella(archivo);
      // La página recordada se guarda aparte: al recolocar, el visor recalcula
      // cuál se está mirando a partir del desplazamiento, que todavía es cero.
      const recordada = this.recuperar();
      this.refrescarMarcas();
      this.recalcular();
      this.cargando = false;
      this.cd.markForCheck();

      // Lo demás no hace esperar a la lectura: el documento ya está en pantalla.
      this.irAPagina(recordada, false);
      this.subirAlServidor();
      this.indexarEnSegundoPlano();
    } catch (err) {
      this.cargando = false;
      console.error('No se ha podido abrir el PDF:', err);
      avisoError(this.porQueNoAbre(err));
      this.cerrar();
      this.cd.markForCheck();
    }
  }

  private porQueNoAbre(err: unknown): string {
    const fallo = err as { name?: string; message?: string };
    if (fallo?.name === 'PasswordException') {
      return 'El PDF está protegido con contraseña. Quítasela con "Proteger PDF" y vuelve.';
    }
    if (fallo?.name === 'InvalidPDFException') {
      return 'El archivo no es un PDF válido o está dañado.';
    }
    return `No se ha podido abrir el documento${fallo?.message ? ` (${fallo.message})` : ''}.`;
  }

  cerrar(): void {
    this.guardarEnMemoria();
    this.render.cancelar('');
    this.documento?.cerrar();
    this.documento = null;
    this.archivo = null;
    this.medidas = [];
    this.indice = [];
    this.etiquetas = null;
    this.propiedades = [];
    this.visibles = [];
    this.disposicion = { filas: [], altoTotal: 0, anchoTotal: 0 };
    this.cambios = new Cambios();
    this.textoActivo = null;
    this.hayCampos = false;
    this.buscador.limpiar();
    this.resultados = [];
    this.consulta = '';
    this.indexadas = 0;
    this.paginaActual = 1;
    this.fileId = null;
    this.huella = '';
    this.resultado = null;
  }

  // --- disposición y desplazamiento -------------------------------------

  private recalcular(conservarPagina = true): void {
    const lectura = this.lecturaRef?.nativeElement;
    if (!lectura || !this.medidas.length) {
      return;
    }

    if (this.modoZoom !== 'libre') {
      const primera = this.medidas.find(m => !this.cambios.eliminadas.has(m.numero)) ?? this.medidas[0];
      const disponible = (lectura.clientWidth - SEPARACION * (this.columnas - 1)) / this.columnas;
      this.escala = escalaParaAjustar(primera, this.cambios.rotacionDe(primera.numero), disponible,
                                      lectura.clientHeight, this.modoZoom, SEPARACION);
    }

    // La página que se está leyendo, antes de que cambie la disposición: con
    // otra escala u otro ancho, el mismo desplazamiento en píxeles cae en un
    // sitio distinto del documento y se perdería el sitio.
    const enCurso = this.paginaActual;

    this.disposicion = calcularDisposicion(this.medidas, {
      escala: this.escala,
      columnas: this.columnas,
      anchoDisponible: lectura.clientWidth,
      separacion: SEPARACION,
      rotaciones: this.cambios.rotaciones,
      eliminadas: this.cambios.eliminadas,
      portada: this.modoLectura === 'libro',
      solo: this.modoLectura === 'pagina' ? enCurso : undefined,
    });
    this.actualizarVisibles();

    if (conservarPagina && this.paginaActual !== enCurso) {
      this.irAPagina(enCurso, false);
      this.actualizarVisibles();
    }
  }

  private readonly alDesplazar = (): void => {
    if (this.pendienteDeCuadro) {
      return;
    }
    this.pendienteDeCuadro = true;
    requestAnimationFrame(() => {
      this.pendienteDeCuadro = false;
      const antes = this.ultimaVentana;
      const pagina = this.paginaActual;
      this.actualizarVisibles();
      // Sólo se molesta a Angular si de verdad ha cambiado algo de lo que se ve.
      if (antes !== this.ultimaVentana || pagina !== this.paginaActual) {
        this.zone.run(() => this.cd.detectChanges());
        this.recordarMasTarde();
      }
    });
  };

  private actualizarVisibles(): void {
    const lectura = this.lecturaRef?.nativeElement;
    if (!lectura) {
      return;
    }
    const [desde, hasta] = filasVisibles(this.disposicion, lectura.scrollTop, lectura.clientHeight);
    this.ultimaVentana = `${desde}-${hasta}:${this.escala}:${this.modoLectura}`;

    const enPantalla: EnPantalla[] = [];
    for (let i = desde; i <= hasta; i++) {
      const fila = this.disposicion.filas[i];
      fila?.paginas.forEach(colocada => enPantalla.push({ colocada, top: fila.top }));
    }
    this.visibles = enPantalla;
    this.paginaActual = paginaEnFoco(this.disposicion, lectura.scrollTop, lectura.clientHeight);

    // Lo que se está mirando se dibuja antes que lo que sólo está de reserva.
    this.render.priorizar(new Set(enPantalla.map(
      ({ colocada }) => `${colocada.numero}:${colocada.rotacion}:${this.escala}`)));
  }

  /**
   * Lo escrito en el cuadro de página cuando el documento tiene etiquetas: la
   * etiqueta («iv») o el número. Si no es ninguna, el cuadro vuelve a la actual.
   */
  irAEtiqueta(campo: HTMLInputElement): void {
    const pagina = paginaDeEtiqueta(campo.value, this.etiquetas, this.medidas.length);
    if (pagina) {
      this.irAPagina(pagina);
    }
    campo.value = this.etiquetas?.[this.paginaActual - 1] ?? String(this.paginaActual);
  }

  /** Ir a una página desde el panel: en móvil, además, lo cierra. */
  irAPaginaDesdePanel(numero: number): void {
    this.irADestinoDesdePanel({ pagina: numero, y: null });
  }

  irADestinoDesdePanel(destino: DestinoPdf): void {
    this.irADestino(destino);
    if (cumple(COMPACTA)) {
      this.panelAbierto = false;
    }
  }

  /** Un enlace o una entrada del índice: a su página, y a su altura si la da. */
  irADestino({ pagina, y }: DestinoPdf): void {
    this.irAPagina(pagina, true, y);
  }

  irAPagina(numero: number, suave = true, y: number | null = null): void {
    // Página a página sólo está colocada la que se ve: para ir a otra, se
    // coloca ésa en su lugar.
    if (this.modoLectura === 'pagina' && numero !== this.paginaActual
        && this.medidas.some(medida => medida.numero === numero)) {
      this.paginaActual = numero;
      this.recalcular(false);
      this.cd.detectChanges();
      this.lecturaRef?.nativeElement.scrollTo({ top: 0 });
      suave = false;
    }
    const fila = this.disposicion.filas.find(f => f.paginas.some(p => p.numero === numero));
    const lectura = this.lecturaRef?.nativeElement;
    if (!fila || !lectura) {
      return;
    }
    // La altura viene sobre la página del archivo; si se ha girado a mano, ya
    // no es la de la pantalla y se va al principio de la página.
    const colocada = fila.paginas.find(p => p.numero === numero)!;
    const dentro = y !== null && colocada.rotacion === 0 ? y * colocada.alto : 0;
    const destino = Math.max(0, fila.top + dentro - SEPARACION);
    // Un desplazamiento suave está bien para ir a la página de al lado; para
    // cruzar doscientas es un viaje de varios segundos con la pantalla medio
    // vacía. A partir de un par de pantallas, se salta y ya está.
    const lejos = Math.abs(destino - lectura.scrollTop) > lectura.clientHeight * 2;
    lectura.scrollTo({ top: destino, behavior: suave && !lejos ? 'smooth' : 'auto' });
    this.paginaActual = numero;
  }

  // --- zoom y vista -----------------------------------------------------

  ajustar(modo: ModoZoom): void {
    this.modoZoom = modo;
    // Se recuerda para los documentos siguientes: quien prefiere leer a lo
    // ancho no debería tener que decirlo en cada archivo que abre.
    this.memoria.guardarPreferencia('modoZoom', modo);
    this.recalcular();
  }

  /** Los botones y el teclado amplían sobre el centro de lo que se ve. */
  aplicarZoom(factor: number): void {
    const lectura = this.lecturaRef?.nativeElement;
    if (!lectura) {
      return;
    }
    const caja = lectura.getBoundingClientRect();
    this.ampliarEn(factor, { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 });
  }

  /**
   * Durante el gesto, sólo se escala con CSS alrededor del punto: es inmediato
   * y no hace dibujar nada. Lo de verdad lo hace `ampliarEn` al soltar.
   */
  private ampliarProvisional(factor: number, origen: Punto): void {
    const lienzo = this.lienzoRef?.nativeElement;
    if (!lienzo) {
      return;
    }
    if (!this.origenGesto) {
      const caja = lienzo.getBoundingClientRect();
      this.origenGesto = { x: origen.x - caja.left, y: origen.y - caja.top };
      lienzo.style.transformOrigin = `${this.origenGesto.x}px ${this.origenGesto.y}px`;
    }
    lienzo.style.transform = `scale(${factor})`;
  }

  /**
   * Amplía dejando quieto lo que hay bajo `origen` (en coordenadas de la
   * ventana): se recoloca, se aplica antes de tocar el desplazamiento —si no, el
   * navegador lo recortaría al alto viejo— y se desplaza lo que haya movido
   * `anclar`.
   */
  private ampliarEn(factor: number, origen: Punto): void {
    const lectura = this.lecturaRef?.nativeElement;
    const lienzo = this.lienzoRef?.nativeElement;
    if (!lectura || !lienzo || !this.documento) {
      return;
    }
    let punto = this.origenGesto;
    if (!punto) {
      const caja = lienzo.getBoundingClientRect();
      punto = { x: origen.x - caja.left, y: origen.y - caja.top };
    }
    this.origenGesto = null;
    lienzo.style.transform = '';

    const antes = this.disposicion;
    this.modoZoom = 'libre';
    this.escala = Math.min(ESCALA_MAXIMA, Math.max(ESCALA_MINIMA, this.escala * factor));
    this.recalcular(false);
    this.cd.detectChanges();

    const despues = anclar(antes, this.disposicion, punto);
    lectura.scrollLeft += despues.x - punto.x;
    lectura.scrollTop += despues.y - punto.y;
    this.actualizarVisibles();
    this.cd.detectChanges();
    this.recordarMasTarde();
  }

  get columnas(): number {
    return columnasDe(this.modoLectura);
  }

  elegirModo(modo: ModoLectura): void {
    this.modoLectura = modo;
    this.eligiendoModo = false;
    this.recalcular();
    this.recordarMasTarde();
  }

  /** «Siguiente» o «anterior», según el modo: de fila en fila. */
  pasarPagina(paso: number): void {
    this.irAPagina(paginaVecina(this.medidas.map(medida => medida.numero), this.cambios.eliminadas,
                                this.paginaActual, paso, this.modoLectura));
  }

  presentar(): void {
    this.presentando = true;
  }

  /** Las páginas que se presentan: las que no se han quitado. */
  get paginasVivas(): number[] {
    return this.medidas.map(medida => medida.numero)
      .filter(numero => !this.cambios.eliminadas.has(numero));
  }

  /** Al salir se sigue por la página en la que se estaba presentando. */
  alSalirDePresentacion(pagina: number): void {
    this.presentando = false;
    this.cd.detectChanges();
    this.irAPagina(pagina, false);
    this.lecturaRef?.nativeElement.focus();
  }

  alternarOscuro(): void {
    this.oscuro = !this.oscuro;
    this.recordarMasTarde();
  }

  alternarPanel(): void {
    // Recolocar lo hace el observador de tamaño en cuanto el panel entra o sale.
    this.panelAbierto = !this.panelAbierto;
  }

  abrirPestana(pestana: Pestana): void {
    this.pestana = pestana;
    this.panelAbierto = true;
  }

  // --- edición ----------------------------------------------------------

  alSeleccionar(seleccion: Seleccion): void {
    if (this.herramienta === 'leer') {
      return;
    }
    this.marcarSeleccion(seleccion, this.herramienta === 'subrayar' ? 'subrayado' : 'tachado',
                         this.herramienta === 'subrayar' ? this.colorSubrayado : this.colorTachado);
  }

  /**
   * Lo que se pide desde el menú que sale al terminar de seleccionar.
   *
   * Subrayar y tachar pasan por el mismo sitio que las herramientas de la
   * barra, para no perderse la regla de que repasar algo ya marcado sustituye
   * la marca en vez de apilar otra encima.
   */
  async alPedirAccion(peticion: AccionSeleccion): Promise<void> {
    const { accion, pagina, rects, texto, color } = peticion;
    const seleccion: Seleccion = { pagina, rects, texto };

    if (accion === 'subrayar') {
      this.marcarSeleccion(seleccion, 'subrayado', color ?? this.colorSubrayado);
      return;
    }
    if (accion === 'tachar') {
      this.marcarSeleccion(seleccion, 'tachado', this.colorTachado);
      return;
    }
    if (accion === 'buscar') {
      this.abrirPestana('buscar');
      this.buscar(texto);
      this.siguienteResultado();
      this.cd.markForCheck();
      return;
    }

    try {
      await copiarAlPortapapeles(texto);
      avisoExito('Texto copiado');
    } catch {
      avisoError('El navegador no ha dejado copiar. Selecciona el texto y usa Ctrl+C.');
    }
  }

  alternarMenuAlSeleccionar(): void {
    this.menuAlSeleccionar = !this.menuAlSeleccionar;
    this.memoria.guardarPreferencia('menuAlSeleccionar', this.menuAlSeleccionar);
  }

  private marcarSeleccion(seleccion: Seleccion, tipo: 'subrayado' | 'tachado',
                          color: ColorSubrayado | ColorTachado): void {
    // Repasar algo ya marcado sustituye la marca anterior en vez de apilar otra
    // encima: es lo que uno espera al cambiarle el color.
    const sustituye = this.cambios.solapadas(seleccion.pagina, tipo, seleccion.rects);

    this.cambios.marcar({
      tipo,
      pagina: seleccion.pagina,
      color,
      rects: seleccion.rects,
      texto: seleccion.texto,
    }, sustituye);
    this.resultado = null;
    this.refrescarMarcas();
  }

  /**
   * Busca DNI, teléfonos, correos y cuentas, y los deja **marcados para
   * revisar**, no tachados.
   *
   * Ésa es toda la diferencia con la herramienta «Anonimizar PDF», que los
   * tacha de una y devuelve el archivo: aquí se ven, se quitan los que sobren y
   * se añaden a mano los que el patrón no puede conocer —un nombre, una
   * dirección— antes de guardar. Por eso es un solo paso al deshacer.
   *
   * Quien busca es el servidor. Rehacer aquí las expresiones y sus
   * comprobaciones —la letra del DNI, el dígito de la cuenta— sería garantizar
   * que las dos versiones dejan de coincidir a la primera corrección.
   */
  async tacharDatosPersonales(): Promise<void> {
    if (!this.documento || this.buscandoDatos) {
      return;
    }
    this.buscandoDatos = true;
    try {
      const zonas = await this.buscarDatosPersonales();
      if (zonas.total === 0) {
        aviso('No se ha encontrado ningún DNI, NIE, teléfono, correo ni cuenta bancaria.');
        return;
      }

      const desglose = zonas.recuento
        .map(fila => `${fila.cuantas} · ${nombreDeDato(fila.tipo)}`)
        .join('\n');
      // Por encima de esto, repasarlas una a una deja de ser algo que nadie
      // vaya a hacer, y la herramienta suelta las aplica de una vez.
      const demasiadas = zonas.total > REVISABLES
        ? `\n\nSon muchas para repasarlas una a una. Si no las vas a revisar, ` +
          '«Anonimizar PDF» las tacha todas de una vez y te devuelve el archivo.'
        : '';
      const seguir = await confirmar(
        `Se han encontrado ${zonas.total}`,
        `${desglose}\n\nSe marcan para que los revises: podrás quitar los que sobren y ` +
        'añadir a mano lo que no tiene forma fija, como un nombre. No se borra nada ' +
        `hasta que guardes.${demasiadas}`,
        'Marcarlos');
      if (!seguir) {
        return;
      }

      const nuevas = zonas.paginas.flatMap(pagina => pagina.marcas.map(marca => ({
        tipo: 'tachado' as const,
        pagina: pagina.pagina,
        color: this.colorTachado,
        rects: [marca.rect as Marca['rects'][number]],
        texto: nombreDeDato(marca.tipo),
      })));
      this.cambios.marcarVarias(nuevas);
      this.resultado = null;
      this.elegirHerramienta('tachar');
      this.refrescarMarcas();
    } catch (err) {
      avisoError(mensajeDeError(err, 'No se han podido buscar los datos personales.'));
    } finally {
      this.buscandoDatos = false;
      this.cd.markForCheck();
    }
  }

  /** Como `enviarCambios`: si el archivo ya no está en el servidor, se resube. */
  private async buscarDatosPersonales(): Promise<ZonasAnonimizado> {
    const peticion = () =>
      this.api.inspeccionarAnonimizado(this.fileId!, IDS_DE_DATO, '').toPromise() as
        Promise<ZonasAnonimizado>;

    if (!this.fileId) {
      await this.subirAlServidor(true);
    }
    try {
      return await peticion();
    } catch (err) {
      if ((err as { status?: number })?.status !== 404) {
        throw err;
      }
      await this.subirAlServidor(true);
      return peticion();
    }
  }

  elegirHerramienta(herramienta: Herramienta): void {
    this.herramienta = herramienta;
    if (herramienta !== 'texto') {
      this.textoActivo = null;
    }
  }

  /** Si hay que marcar sobre la selección de texto (subrayar o tachar). */
  get marcando(): boolean {
    return this.herramienta === 'subrayar' || this.herramienta === 'tachar';
  }

  // --- campos del formulario --------------------------------------------

  alEncontrarCampos(cuantos: number): void {
    if (cuantos > 0 && !this.hayCampos) {
      this.hayCampos = true;
      this.cd.markForCheck();
    }
  }

  alRellenarCampo({ nombre, valor, original }: CampoRelleno): void {
    if (!this.cambios.rellenar(nombre, valor, original)) {
      return;
    }
    // Copia nueva para que las páginas, que van en OnPush, se enteren.
    this.cambios.campos = new Map(this.cambios.campos);
    this.resultado = null;
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  alternarFormulario(): void {
    this.conFormulario = !this.conFormulario;
  }

  // --- textos escritos encima -------------------------------------------

  alCrearTexto(nuevo: TextoNuevo, pagina: number): void {
    const escrito = this.cambios.escribir({ pagina, ...nuevo, ...this.estiloEscritura });
    this.textoActivo = escrito.id;
    this.tocado();
  }

  alEditarTexto({ id, texto }: TextoEditado): void {
    if (this.cambios.editarTexto(id, { texto })) {
      this.tocado();
    }
  }

  alMoverTexto({ id, x, y }: TextoMovido): void {
    if (this.cambios.moverTexto(id, x, y)) {
      this.tocado();
    }
  }

  alQuitarTexto(id: string): void {
    this.cambios.quitarTexto(id);
    if (this.textoActivo === id) {
      this.textoActivo = null;
    }
    this.tocado();
  }

  alPulsarTexto(id: string | null): void {
    if (this.textoActivo === id) {
      return;
    }
    this.textoActivo = id;
    // Con un texto seleccionado, la barra enseña y toca su estilo.
    const texto = id ? this.cambios.textos.find(t => t.id === id) : null;
    if (texto) {
      const { fuente, tamano, color, negrita, cursiva } = texto;
      this.estiloEscritura = { fuente, tamano, color, negrita, cursiva };
    }
    this.cd.markForCheck();
  }

  /**
   * Lo que se toca en la barra.
   *
   * Con un texto seleccionado le cambia a él; sin nada seleccionado, fija cómo
   * saldrá el siguiente. En los dos casos queda como estilo por defecto, que es
   * lo que uno espera después de haberlo elegido una vez.
   */
  cambiarEstilo(cambio: Partial<EstiloEscritura>): void {
    this.estiloEscritura = { ...this.estiloEscritura, ...cambio };
    if (this.textoActivo && this.cambios.editarTexto(this.textoActivo, cambio)) {
      this.tocado();
      return;
    }
    this.cd.markForCheck();
  }

  cambiarTamano(valor: number | string): void {
    this.cambiarEstilo({ tamano: tamanoValido(Number(valor)) });
  }

  textosDe(numero: number): Texto[] {
    return this.cambios.textos.filter(texto => texto.pagina === numero);
  }

  /** Un cambio en los textos: copia nueva para las páginas, que van en OnPush. */
  private tocado(): void {
    this.cambios.textos = [...this.cambios.textos];
    this.resultado = null;
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  cambiarColorMarca({ id, color }: CambioDeColor): void {
    this.cambios.cambiarColor(id, color);
    this.resultado = null;
    this.refrescarMarcas();
  }

  quitarMarca(id: string): void {
    this.cambios.quitarMarca(id);
    this.resultado = null;
    this.refrescarMarcas();
  }

  girarPagina(numero: number): void {
    this.cambios.girar(numero);
    this.resultado = null;
    this.recalcular();
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  eliminarPagina(numero: number): void {
    this.cambios.eliminar(numero);
    this.resultado = null;
    this.recalcular();
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  restaurarPagina(numero: number): void {
    this.cambios.restaurar(numero);
    this.recalcular();
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  deshacer(): void {
    this.cambios.deshacer();
    this.cambios.textos = [...this.cambios.textos];
    this.cambios.campos = new Map(this.cambios.campos);
    this.resultado = null;
    this.recalcular();
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  private refrescarMarcas(): void {
    // Copia nueva para que las páginas, que van en OnPush, se enteren.
    this.cambios.marcas = [...this.cambios.marcas];
    this.recordarMasTarde();
    this.cd.markForCheck();
  }

  /** Sin esto, Angular rehace la página entera en cada desplazamiento. */
  porNumero = (_: number, visible: EnPantalla) => visible.colocada.numero;

  /**
   * Las marcas de una página, desde un índice y no filtrando la lista entera.
   *
   * Esto lo llama la plantilla **por cada página visible en cada ciclo de
   * detección de cambios**, o sea en cada movimiento del ratón. Con un `filter`
   * eso era recorrer todas las marcas del documento tantas veces como páginas
   * hubiera en pantalla, y además devolver un array nuevo cada vez, lo que
   * obliga a repintar aunque nada haya cambiado. Con unas pocas marcas daba
   * igual; con las miles que puede dejar «buscar y tachar todo» en un documento
   * largo, no.
   *
   * El índice se rehace cuando cambia la **identidad** del array, que es
   * justamente lo que hace `refrescarMarcas()` en cada cambio.
   */
  marcasDe(numero: number): Marca[] {
    if (this.marcasIndexadas !== this.cambios.marcas) {
      this.marcasPorPagina.clear();
      for (const marca of this.cambios.marcas) {
        const suyas = this.marcasPorPagina.get(marca.pagina);
        if (suyas) {
          suyas.push(marca);
        } else {
          this.marcasPorPagina.set(marca.pagina, [marca]);
        }
      }
      this.marcasIndexadas = this.cambios.marcas;
    }
    return this.marcasPorPagina.get(numero) ?? SIN_MARCAS;
  }

  // --- guardar ----------------------------------------------------------

  get hayCambios(): boolean {
    return this.cambios.hayAlgo;
  }

  async guardar(): Promise<void> {
    if (!this.documento || !this.hayCambios || this.guardando) {
      return;
    }
    this.guardando = true;
    this.cd.markForCheck();

    try {
      const respuesta = await this.enviarCambios();
      this.resultado = respuesta.files[0];
      // Lo guardado ya no es un borrador que haya que recuperar.
      this.memoria.guardar(this.huella, this.recuerdoActual(false));
      avisoExito('Documento guardado');
    } catch (err) {
      avisoError(mensajeDeError(err, 'No se han podido guardar los cambios.'));
    } finally {
      this.guardando = false;
      this.cd.markForCheck();
    }
  }

  /**
   * Manda los cambios, y si el archivo ya no está en el servidor lo vuelve a
   * subir y reintenta.
   *
   * La sesión se borra por inactividad y una lectura larga no toca el servidor:
   * sin este reintento, tres horas de trabajo se perderían al guardar.
   */
  private async enviarCambios(): Promise<{ files: ArchivoServidor[] }> {
    const peticion = () => {
      const cuerpo = { file_ids: [this.fileId], ...this.cambios.aPeticion(this.medidas.length) };
      return this.api.ejecutar('visor/guardar', cuerpo).toPromise() as Promise<{ files: ArchivoServidor[] }>;
    };

    if (!this.fileId) {
      await this.subirAlServidor(true);
    }
    try {
      return await peticion();
    } catch (err) {
      if ((err as { status?: number })?.status !== 404) {
        throw err;
      }
      await this.subirAlServidor(true);
      return peticion();
    }
  }

  /**
   * Imprimir lo que se ve. Con cambios sin guardar, el servidor prepara antes
   * el PDF editado —sin guardarlo en ningún sitio— y se imprime ése: es la
   * única forma de que lo impreso sea exactamente lo que se guardaría.
   */
  async imprimir(): Promise<void> {
    if (!this.documento || !this.archivo || this.imprimiendo) {
      return;
    }
    const cancelar = new AbortController();
    this.cancelarImpresion = cancelar;
    this.imprimiendo = { hechas: 0, total: this.documento.paginas, preparando: this.hayCambios };
    this.cd.markForCheck();

    let editado: { documento: DocumentoPdf; archivo: ArchivoServidor } | null = null;
    try {
      let documento = this.documento;
      if (this.hayCambios) {
        const { files: [archivo] } = await this.enviarCambios();
        const blob = await firstValueFrom(this.api.contenido(archivo));
        editado = { documento: await this.pdf.abrir(new File([blob], archivo.name)), archivo };
        documento = editado.documento;
        this.imprimiendo = { hechas: 0, total: documento.paginas, preparando: false };
        this.cd.markForCheck();
      }
      const urls = await paginasParaImprimir(documento, hechas => {
        this.imprimiendo = { ...this.imprimiendo!, hechas };
        this.cd.markForCheck();
      }, cancelar.signal);
      this.imprimiendo = null;
      this.cd.markForCheck();
      await imprimirImagenes(urls, this.archivo.name.replace(/\.pdf$/i, ''));
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        avisoError(mensajeDeError(err, 'No se ha podido preparar la impresión.'));
      }
    } finally {
      this.imprimiendo = null;
      this.cancelarImpresion = undefined;
      if (editado) {
        editado.documento.cerrar();
        // Era sólo para imprimir: que no ocupe la cuota de la sesión.
        this.api.eliminar(editado.archivo.id).subscribe({ error: () => undefined });
      }
      this.cd.markForCheck();
    }
  }

  cancelarLaImpresion(): void {
    this.cancelarImpresion?.abort();
  }

  descargar(): void {
    if (this.resultado) {
      this.api.descargar(this.resultado).subscribe({
        error: err => avisoError(mensajeDeError(err, 'No se ha podido descargar el archivo.')),
      });
    }
  }

  private async subirAlServidor(obligatorio = false): Promise<void> {
    if (!this.archivo || (this.fileId && !obligatorio)) {
      return;
    }
    try {
      const estado = await new Promise<{ tipo: string; archivos?: ArchivoServidor[] }>((ok, mal) => {
        this.api.subir([this.archivo!]).subscribe({
          next: e => e.tipo === 'hecho' && ok(e as never),
          error: mal,
        });
      });
      this.fileId = estado.archivos?.[0]?.id ?? null;
    } catch (err) {
      if (obligatorio) {
        throw err;
      }
      // Si falla al abrir no se molesta al usuario: se reintenta al guardar.
      console.warn('No se ha podido preparar el documento en el servidor:', err);
    }
  }

  private mantenerSesion(): void {
    if (this.fileId && document.visibilityState === 'visible') {
      this.api.mantenerSesion().subscribe({ error: () => undefined });
    }
  }

  // --- búsqueda ---------------------------------------------------------

  /**
   * Lee el texto de todo el documento sin estorbar.
   *
   * Se hace en los ratos muertos del navegador: en un documento largo esto
   * tarda, y no puede hacer esperar a quien sólo quiere leer.
   */
  private indexarEnSegundoPlano(): void {
    const documento = this.documento;
    if (!documento) {
      return;
    }
    this.indexando = true;
    let numero = 1;

    const siguiente = async () => {
      if (documento !== this.documento || numero > documento.paginas) {
        this.indexando = false;
        this.cd.markForCheck();
        return;
      }
      try {
        const pagina = await documento.pagina(numero);
        const { items } = await pagina.getTextContent();
        this.buscador.anadir(numero, items);
      } catch {
        /* una página ilegible no debe cortar el resto */
      }
      this.indexadas = numero++;
      if (this.consulta.length > 1) {
        this.resultados = this.buscador.buscar(this.consulta, this.opcionesBusqueda);
      }
      this.cd.markForCheck();
      programar(siguiente);
    };
    programar(siguiente);
  }

  /**
   * Actualiza los resultados según se escribe, **sin moverse del sitio**.
   *
   * Saltar en cada tecla es desconcertante: al teclear "petición" el documento
   * daría siete saltos. Se va a un resultado cuando se pulsa Intro o se elige
   * uno de la lista.
   */
  buscar(consulta: string): void {
    this.consulta = consulta;
    this.resultados = consulta.trim().length > 1
      ? this.buscador.buscar(consulta, this.opcionesBusqueda)
      : [];
    this.resultadoActual = -1;
    this.cd.markForCheck();
  }

  irAResultado(indice: number): void {
    if (!this.resultados.length) {
      return;
    }
    this.resultadoActual = (indice + this.resultados.length) % this.resultados.length;
    this.irAPagina(this.resultados[this.resultadoActual].pagina);
  }

  /** Intro en el buscador: al primer resultado, y luego al siguiente. */
  siguienteResultado(atras = false): void {
    this.irAResultado(this.resultadoActual + (atras ? -1 : 1));
  }

  cambiarOpcionesBusqueda(cambio: OpcionesBusqueda): void {
    this.opcionesBusqueda = { ...this.opcionesBusqueda, ...cambio };
    this.buscar(this.consulta);
  }

  /** Como `marcasDe`: por un índice que se rehace cuando cambia la lista. */
  coincidenciasDe(numero: number): Coincidencia[] {
    if (this.resultadosIndexados !== this.resultados) {
      this.resultadosPorPagina.clear();
      for (const resultado of this.resultados) {
        const suyos = this.resultadosPorPagina.get(resultado.pagina);
        if (suyos) {
          suyos.push(resultado);
        } else {
          this.resultadosPorPagina.set(resultado.pagina, [resultado]);
        }
      }
      this.resultadosIndexados = this.resultados;
    }
    return this.resultadosPorPagina.get(numero) ?? SIN_COINCIDENCIAS;
  }

  /** El resultado en el que se está, si cae en esta página. */
  actualDe(numero: number): Coincidencia | null {
    const actual = this.resultados[this.resultadoActual];
    return actual?.pagina === numero ? actual : null;
  }

  // --- memoria entre visitas --------------------------------------------

  /** Devuelve la página por la que se iba, que es lo único que no se aplica solo. */
  private recuperar(): number {
    const recuerdo = this.memoria.recordar(this.huella);
    if (!recuerdo) {
      return 1;
    }
    this.paginaActual = Math.min(recuerdo.pagina || 1, this.medidas.length);
    this.escala = recuerdo.escala || 1;
    this.modoZoom = (recuerdo.modoZoom as ModoZoom) || this.modoZoom;
    this.modoLectura = (MODOS_LECTURA as string[]).includes(recuerdo.modoLectura ?? '')
      ? recuerdo.modoLectura as ModoLectura
      : recuerdo.columnas === 2 ? 'dos' : 'continuo';
    this.oscuro = !!recuerdo.oscuro;
    if (recuerdo.borrador) {
      this.cambios = Cambios.desdeBorrador(recuerdo.borrador);
    }
    return this.paginaActual;
  }

  private recordarMasTarde(): void {
    clearTimeout(this.temporizadorMemoria);
    this.temporizadorMemoria = setTimeout(() => this.guardarEnMemoria(), ESPERA_MEMORIA);
  }

  private guardarEnMemoria(): void {
    if (this.huella) {
      this.memoria.guardar(this.huella, this.recuerdoActual(true));
    }
  }

  private recuerdoActual(conBorrador: boolean) {
    return {
      pagina: this.paginaActual,
      escala: this.escala,
      modoZoom: this.modoZoom,
      columnas: this.columnas,
      modoLectura: this.modoLectura,
      oscuro: this.oscuro,
      borrador: conBorrador && this.cambios.hayAlgo ? this.cambios.aBorrador() : undefined,
    };
  }

  // --- teclado ----------------------------------------------------------

  @HostListener('window:keydown', ['$event'])
  alPulsarTecla(evento: KeyboardEvent): void {
    const destino = evento.target as HTMLElement;
    const escribiendo = destino?.matches?.('input, textarea, select');
    // En un campo de texto, `Ctrl+Z` es el deshacer del navegador y no se toca.
    // En una casilla, una opción o un desplegable no hay tal cosa, así que ahí
    // el atajo sí tiene que llegar al visor.
    const escribiendoTexto = destino?.matches?.(
      'textarea, input:not([type=checkbox]):not([type=radio])');
    // La presentación atiende sus propias teclas.
    if (!this.documento || this.presentando) {
      return;
    }
    if (evento.key === '?') {
      evento.preventDefault();
      mostrarAtajos();
      return;
    }
    if (evento.key === 'F5') {
      evento.preventDefault();
      this.presentar();
      this.cd.markForCheck();
      return;
    }
    if (evento.ctrlKey && evento.key.toLowerCase() === 'z' && !escribiendoTexto) {
      evento.preventDefault();
      this.deshacer();
      return;
    }
    // Intro dentro del buscador salta al siguiente resultado; el resto de
    // atajos no se cuelan mientras se escribe.
    if (escribiendo) {
      if (evento.key === 'Enter' && (evento.target as HTMLElement).matches('input[type=search]')) {
        evento.preventDefault();
        this.siguienteResultado(evento.shiftKey);
        this.cd.markForCheck();
      }
      return;
    }

    const atajos: Record<string, () => void> = {
      ArrowRight: () => this.pasarPagina(1),
      ArrowLeft: () => this.pasarPagina(-1),
      PageDown: () => this.pasarPagina(1),
      PageUp: () => this.pasarPagina(-1),
      Home: () => this.irAPagina(1),
      End: () => this.irAPagina(this.medidas.length),
      '+': () => this.aplicarZoom(1.25),
      '-': () => this.aplicarZoom(0.8),
      g: () => this.abrirPestana('paginas'),
      Escape: () => (this.panelAbierto = false),
    };

    // Ctrl + y Ctrl − amplían el documento y no la interfaz, como en cualquier
    // lector de PDF; Ctrl 0 vuelve a la página entera.
    if (evento.ctrlKey && ['+', '=', '-', '0'].includes(evento.key)) {
      evento.preventDefault();
      if (evento.key === '0') {
        this.ajustar('pagina');
      } else {
        this.aplicarZoom(evento.key === '-' ? 0.8 : 1.25);
      }
      this.cd.markForCheck();
      return;
    }
    if (evento.ctrlKey && evento.key.toLowerCase() === 'p') {
      evento.preventDefault();
      this.imprimir();
      return;
    }
    if (evento.ctrlKey && evento.key.toLowerCase() === 'f') {
      evento.preventDefault();
      this.abrirPestana('buscar');
      setTimeout(() => document.querySelector<HTMLInputElement>('input[type=search]')?.focus());
      this.cd.markForCheck();
      return;
    }
    if (evento.ctrlKey && evento.key.toLowerCase() === 'z') {
      evento.preventDefault();
      this.deshacer();
      return;
    }
    if ((evento.key === 'Delete' || evento.key === 'Backspace') && this.textoActivo) {
      evento.preventDefault();
      this.alQuitarTexto(this.textoActivo);
      return;
    }
    if (evento.key === 'F3' || (evento.key === 'Enter' && this.pestana === 'buscar')) {
      evento.preventDefault();
      this.siguienteResultado(evento.shiftKey);
      this.cd.markForCheck();
      return;
    }

    // Página a página, las flechas verticales desplazan dentro de la página y,
    // al llegar al borde, pasan a la de al lado.
    if (this.modoLectura === 'pagina' && (evento.key === 'ArrowDown' || evento.key === 'ArrowUp')) {
      const lectura = this.lecturaRef!.nativeElement;
      const abajo = evento.key === 'ArrowDown';
      const enElBorde = abajo
        ? lectura.scrollTop + lectura.clientHeight >= lectura.scrollHeight - 1
        : lectura.scrollTop <= 0;
      if (enElBorde) {
        evento.preventDefault();
        this.pasarPagina(abajo ? 1 : -1);
        this.cd.markForCheck();
        return;
      }
    }

    const accion = atajos[evento.key];
    if (accion) {
      evento.preventDefault();
      accion();
      this.cd.markForCheck();
    }
  }
}

/** Trabajo de fondo, en los ratos libres del navegador si los hay. */
function programar(tarea: () => void): void {
  const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) {
    idle(tarea);
  } else {
    setTimeout(tarea, 16);
  }
}
