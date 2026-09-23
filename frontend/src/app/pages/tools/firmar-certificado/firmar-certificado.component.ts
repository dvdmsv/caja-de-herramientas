
import { Component, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ArchivoServidor, DatosCertificado, PaqueteAutofirma } from '../../../core/api.service';
import { AutofirmaService, DESCARGA_AUTOFIRMA, FirmaCancelada } from '../../../core/autofirma.service';
import { DocumentoPdf, PdfService } from '../../../core/pdf.service';
import { ArchivoEnCola, FileQueueComponent, aCola } from '../../../shared/file-queue/file-queue.component';
import { PaginaHerramienta } from '../../../shared/pagina-herramienta';
import { ResultListComponent } from '../../../shared/result-list/result-list.component';
import { ToolControlsComponent } from '../../../shared/tool-controls/tool-controls.component';
import { ToolPageComponent } from '../../../shared/tool-page/tool-page.component';
import { avisoError, avisoExito, mensajeDeError } from '../../../shared/notify';
import { COLOCACION_INICIAL, Colocacion } from '../../../shared/firma/colocacion';
import { LienzoFirmaComponent } from '../../../shared/firma/lienzo-firma.component';
import { PizarraComponent } from '../../../shared/firma/pizarra.component';

/** Espera antes de volver a pedir la apariencia mientras se escribe el motivo. */
const ESPERA = 350;

/** Dónde se pone el sello si no se toca nada: abajo, que es donde se firma. */
const COLOCACION_SELLO: Colocacion = { ...COLOCACION_INICIAL, ancho: 0.35, rotacion: 0 };

/**
 * A partir de aquí no se intenta firmar con AutoFirma.
 *
 * El PDF entero viaja en base64 por el canal local hasta la aplicación, y ahí hay
 * un límite que no está documentado. AutoFirma admite un servidor intermedio
 * para los documentos grandes, que aquí no se despliega, así que más vale avisar
 * antes de intentarlo que dejar al usuario delante de un error opaco.
 */
const MAXIMO_AUTOFIRMA = 5 * 1024 * 1024;

/**
 * Firmar un PDF con un certificado digital.
 *
 * La diferencia con "Firmar documento" no es de matiz: allí se estampa el dibujo
 * de una firma, aquí se firma de verdad.
 *
 * Hay **dos vías**, y la diferencia entre ellas es dónde está la clave privada:
 *
 * - **Un certificado instalado en el equipo**, a través de AutoFirma. El
 *   selector lo abre la aplicación de escritorio y la firma se hace allí: ni la
 *   clave ni el documento salen de la máquina. Es la única que puede usar el
 *   DNIe o una tarjeta criptográfica, porque esas claves no son exportables.
 * - **Un archivo `.p12`**, que sí pasa por el servidor. Aquí sí hay una
 *   responsabilidad que no perder de vista, y dos decisiones que no hay que
 *   deshacer sin pensarlo: el `.p12` **no se sube** con `api.subir` —que lo
 *   dejaría escrito en la carpeta de la sesión durante dos horas—, sino que se
 *   lee en el navegador y viaja en base64 dentro del cuerpo de cada petición; y
 *   si la página no va por HTTPS, **se avisa**.
 *
 * Todo lo demás —el sello, la colocación, el trazo a mano— es común: sólo
 * depende del certificado, y el público lo tenemos en las dos vías.
 */
@Component({
  selector: 'app-firmar-certificado',
  imports: [
    FormsModule,
    FileQueueComponent,
    ResultListComponent,
    ToolControlsComponent,
    ToolPageComponent,
    LienzoFirmaComponent,
    PizarraComponent
],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './firmar-certificado.component.html',
})
export class FirmarCertificadoComponent extends PaginaHerramienta implements OnDestroy {
  protected readonly slug = 'firmar-certificado';
  protected override get mensajeExito(): string {
    return 'Documento firmado';
  }

  // --- el certificado ---------------------------------------------------
  /** De dónde sale la clave con la que se firma. */
  origen: 'autofirma' | 'archivo' = 'autofirma';

  /** El `.p12` en base64. Nunca se sube como archivo. */
  certificado = '';
  nombreCertificado = '';
  contrasena = '';
  /** El certificado elegido en el equipo: sólo la parte pública, sin clave. */
  certificadoPublico = '';
  datosCertificado: DatosCertificado | null = null;
  comprobando = false;
  eligiendo = false;

  readonly descargaAutofirma = DESCARGA_AUTOFIRMA;

  // --- cómo se firma ----------------------------------------------------
  visible = true;
  motivo = '';
  lugar = '';
  selloTiempo = false;

  /** Cola propia para el trazo manuscrito, opcional, que va de fondo del sello. */
  trazos: ArchivoEnCola[] = [];
  modoTrazo: 'subir' | 'dibujar' = 'subir';

  colocacion: Colocacion = { ...COLOCACION_SELLO };
  paginas = 0;
  paginaActual = 1;
  numerosDePagina: number[] = [];

  /** Página del documento y recuadro del sello, como URL para los `<img>`. */
  fondo = '';
  apariencia = '';
  dibujandoSello = false;

  private documento: DocumentoPdf | null = null;
  private temporizador?: ReturnType<typeof setTimeout>;
  /** Cuál es la petición de apariencia vigente: no llegan en orden. */
  private peticion = 0;
  private readonly pdf = inject(PdfService);
  private readonly autofirma = inject(AutofirmaService);

  ngOnDestroy(): void {
    this.olvidarFondo();
    this.olvidarApariencia();
    this.cerrarPdf();
    clearTimeout(this.temporizador);
  }

  /** La fecha de caducidad, en el formato de aquí y no en ISO. */
  get validoHasta(): string {
    const hasta = this.datosCertificado?.hasta;
    return hasta ? new Date(hasta).toLocaleDateString('es-ES') : '';
  }

  /**
   * Si la clave privada va a viajar en claro.
   *
   * Sólo tiene sentido en la vía del `.p12`: por la de AutoFirma no viaja ni la
   * clave ni la contraseña, así que enseñar el aviso ahí sería alarmismo.
   */
  get inseguro(): boolean {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return this.origen === 'archivo' && location.protocol !== 'https:' && !local;
  }

  /** El sello de tiempo lo pone quien firma, y por esa vía no firmamos nosotros. */
  get selloDisponible(): boolean {
    return this.origen === 'archivo';
  }

  // --- documento --------------------------------------------------------

  alAgregarDocumento(nuevos: ArchivoEnCola[]): void {
    this.alAgregar(nuevos);
    const archivo = nuevos[0]?.file;
    if (archivo) {
      this.abrirDocumento(archivo);
    }
  }

  alQuitarDocumento(): void {
    this.alCambiarLista();
    if (this.archivos.length === 0) {
      this.olvidarFondo();
      this.cerrarPdf();
      this.contarPaginas(0);
    }
  }

  private async abrirDocumento(archivo: File): Promise<void> {
    this.olvidarFondo();
    this.cerrarPdf();
    this.colocacion = { ...COLOCACION_SELLO };

    try {
      this.documento = await this.pdf.abrir(archivo);
      this.contarPaginas(this.documento.paginas);
      await this.renderizar();
    } catch (err) {
      console.error('pdf.js no ha podido abrir el documento:', err);
      avisoError(this.porQueNoAbre(err));
    }
  }

  private contarPaginas(total: number): void {
    this.paginas = total;
    this.paginaActual = Math.max(1, total);
    this.numerosDePagina = Array.from({ length: total }, (_, i) => i + 1);
  }

  private porQueNoAbre(err: unknown): string {
    const fallo = err as { name?: string; message?: string };
    if (fallo?.name === 'PasswordException') {
      return 'El PDF está protegido con contraseña. Quítasela antes de firmarlo.';
    }
    if (fallo?.name === 'InvalidPDFException') {
      return 'El archivo no es un PDF válido o está dañado.';
    }
    return 'No se ha podido preparar la vista previa del PDF. Mira la consola del navegador.';
  }

  async cambiarPagina(numero: number): Promise<void> {
    this.paginaActual = Number(numero);
    this.alCambiarLista();
    await this.renderizar();
  }

  private async renderizar(): Promise<void> {
    if (this.documento) {
      this.fondo = await this.documento.imagen(this.paginaActual);
    }
  }

  // --- certificado ------------------------------------------------------

  /** Se lee aquí, en el navegador: no pasa por `/api/files` a propósito. */
  alElegirCertificado(evento: Event): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    this.olvidarCertificado();
    if (!archivo) {
      return;
    }
    this.nombreCertificado = archivo.name;

    const lector = new FileReader();
    lector.onload = () => {
      // `readAsDataURL` da "data:...;base64,XXXX"; al servidor sólo le interesa
      // lo de después de la coma.
      this.certificado = String(lector.result).split(',')[1] ?? '';
      this.comprobarCertificado();
    };
    lector.onerror = () => avisoError('No se ha podido leer el archivo del certificado.');
    lector.readAsDataURL(archivo);
  }

  /** Cambiar de vía descarta lo elegido en la otra: no se mezclan. */
  cambiarOrigen(origen: 'autofirma' | 'archivo'): void {
    if (this.origen === origen) {
      return;
    }
    this.origen = origen;
    this.olvidarCertificado();
    this.alCambiarLista();
  }

  /**
   * Abre el selector de certificados del equipo.
   *
   * Lo abre AutoFirma, no el navegador: ninguna página web puede llegar al
   * almacén del sistema. Lo que vuelve es sólo el certificado público, con el
   * que ya se puede enseñar el titular y componer el sello.
   */
  async elegirDelEquipo(): Promise<void> {
    this.eligiendo = true;
    try {
      this.certificadoPublico = await this.autofirma.elegirCertificado();
      this.comprobarCertificado();
    } catch (err) {
      // Cerrar el selector no es un fallo: no se le grita a nadie por eso.
      if (!(err instanceof FirmaCancelada)) {
        avisoError((err as Error).message);
      }
    } finally {
      this.eligiendo = false;
    }
  }

  /** Lo que identifica al certificado en cada vía, para mandarlo al servidor. */
  private cuerpoDelCertificado(): Record<string, unknown> {
    return this.origen === 'autofirma'
      ? { certificado_publico: this.certificadoPublico }
      : { certificado: this.certificado, contrasena: this.contrasena };
  }

  /** Si ya hay con qué preguntarle al servidor por el certificado. */
  private get hayCertificado(): boolean {
    return this.origen === 'autofirma'
      ? !!this.certificadoPublico
      : !!this.certificado && !!this.contrasena;
  }

  /** La contraseña se comprueba al salir del campo, no en cada tecla. */
  comprobarCertificado(): void {
    this.alCambiarLista();
    this.datosCertificado = null;
    if (!this.hayCertificado) {
      return;
    }
    this.comprobando = true;
    this.api.inspeccionarCertificado(this.cuerpoDelCertificado()).subscribe({
      next: datos => {
        this.comprobando = false;
        this.datosCertificado = datos;
        this.refrescarApariencia();
      },
      error: err => {
        this.comprobando = false;
        avisoError(mensajeDeError(err, 'No se ha podido abrir el certificado.'));
      },
    });
  }

  // --- el sello ---------------------------------------------------------

  /** Todo lo que cambia lo que pone el sello obliga a redibujarlo. */
  alCambiarSello(): void {
    this.alCambiarLista();
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.refrescarApariencia(), ESPERA);
  }

  alAgregarTrazo(nuevos: ArchivoEnCola[]): void {
    this.alCambiarLista();
    this.subir(nuevos, () => this.refrescarApariencia());
  }

  alQuitarTrazo(): void {
    this.alCambiarLista();
    this.refrescarApariencia();
  }

  alDibujar(archivo: File): void {
    this.trazos.length = 0;
    const nuevos = aCola([archivo]);
    this.trazos.push(...nuevos);
    this.alAgregarTrazo(nuevos);
  }

  private refrescarApariencia(): void {
    if (!this.visible || !this.datosCertificado) {
      this.olvidarApariencia();
      return;
    }
    const mia = ++this.peticion;
    this.dibujandoSello = true;
    this.api.aparienciaDeFirma(this.cuerpoDelSello()).subscribe({
      next: url => {
        // Llegó tarde: ya se ha pedido otra con el texto más nuevo.
        if (mia !== this.peticion) {
          URL.revokeObjectURL(url);
          return;
        }
        this.dibujandoSello = false;
        // La anterior se suelta cuando la nueva ya está, para que no parpadee.
        this.olvidarApariencia();
        this.apariencia = url;
      },
      error: err => {
        if (mia !== this.peticion) {
          return;
        }
        this.dibujandoSello = false;
        avisoError(mensajeDeError(err, 'No se ha podido dibujar el sello.'));
      },
    });
  }

  private cuerpoDelSello(): Record<string, unknown> {
    return {
      ...this.cuerpoDelCertificado(),
      visible: this.visible,
      motivo: this.motivo,
      lugar: this.lugar,
      trazo_id: this.trazos[0]?.id ?? '',
    };
  }

  // --- ejecución --------------------------------------------------------

  override get listo(): boolean {
    return super.listo && !!this.datosCertificado && (!this.visible || !!this.apariencia);
  }

  override get motivoBloqueo(): string | null {
    if (super.motivoBloqueo || this.archivos.length === 0) {
      return super.motivoBloqueo;
    }
    if (!this.datosCertificado) {
      if (this.comprobando) {
        return 'Comprobando el certificado…';
      }
      return this.origen === 'autofirma'
        ? 'Elige tu certificado con AutoFirma.'
        : 'Sube tu certificado (.p12 o .pfx) y escribe su contraseña.';
    }
    return this.visible && !this.apariencia ? 'Preparando el sello visible…' : null;
  }

  protected override opciones(): Record<string, unknown> {
    return {
      ...this.cuerpoDelSello(),
      x: this.colocacion.x,
      y: this.colocacion.y,
      ancho: this.colocacion.ancho,
      pagina: this.paginaActual,
      sello_tiempo: this.selloDisponible && this.selloTiempo,
    };
  }

  // --- firmar con AutoFirma ---------------------------------------------

  override ejecutar(): void {
    if (this.origen === 'archivo') {
      super.ejecutar();
      return;
    }
    if (this.listo) {
      this.firmarEnElEquipo();
    }
  }

  /**
   * Firma sin que el documento salga del navegador.
   *
   * El servidor sólo dice **dónde** va el sello y **cómo** es; quien firma es
   * AutoFirma, en la máquina del usuario. El PDF que vuelve sí se sube, pero
   * sólo para que la lista de resultados le dé descarga, vista previa y
   * renombrado: a esas alturas el documento ya estaba en el servidor desde que
   * se subió. Lo que esta vía protege es la **clave**.
   */
  private async firmarEnElEquipo(): Promise<void> {
    const archivo = this.archivos[0];
    if (!archivo?.id || !archivo.file) {
      return;
    }
    if (archivo.file.size > MAXIMO_AUTOFIRMA) {
      avisoError('El documento es demasiado grande para mandárselo a AutoFirma. '
                 + 'Fírmalo con un archivo .p12 en la otra pestaña.');
      return;
    }

    this.procesando = true;
    try {
      const paquete = await firstValueFrom(
        this.api.paraAutofirma({ file_ids: [archivo.id], ...this.opciones() }));
      const pdf = await aBase64(archivo.file);
      const firmado = await this.autofirma.firmar(pdf, paquete.algoritmo, extras(paquete));
      this.resultados = [await this.guardar(firmado, archivo.file.name)];
      avisoExito(this.mensajeExito);
    } catch (err) {
      if (!(err instanceof FirmaCancelada)) {
        avisoError(mensajeDeError(err, 'No se ha podido firmar el documento.'));
      }
    } finally {
      this.procesando = false;
    }
  }

  /** Sube el PDF ya firmado para que la lista de resultados pueda con él. */
  private guardar(firmadoB64: string, nombre: string): Promise<ArchivoServidor> {
    const bytes = Uint8Array.from(atob(firmadoB64), c => c.charCodeAt(0));
    const base = nombre.replace(/\.pdf$/i, '');
    const archivo = new File([bytes], `${base}-firmado.pdf`, { type: 'application/pdf' });

    return new Promise((ok, fallo) => {
      this.api.subir([archivo]).subscribe({
        next: estado => {
          if (estado.tipo === 'progreso') {
            this.progreso = estado.porcentaje;
          } else {
            this.progreso = -1;
            ok(estado.archivos[0]);
          }
        },
        error: err => {
          this.progreso = -1;
          fallo(err);
        },
      });
    });
  }

  protected override alReiniciar(): void {
    super.alReiniciar();
    this.trazos = [];
    this.contarPaginas(0);
    this.cerrarPdf();
    this.olvidarFondo();
    this.olvidarCertificado();
  }

  centrar(): void {
    this.colocacion = { ...COLOCACION_SELLO };
    this.alCambiarLista();
  }

  private olvidarCertificado(): void {
    this.certificado = '';
    this.nombreCertificado = '';
    this.contrasena = '';
    this.certificadoPublico = '';
    this.datosCertificado = null;
    this.olvidarApariencia();
  }

  private cerrarPdf(): void {
    this.documento?.cerrar();
    this.documento = null;
  }

  private olvidarFondo(): void {
    if (this.fondo.startsWith('blob:')) {
      URL.revokeObjectURL(this.fondo);
    }
    this.fondo = '';
  }

  private olvidarApariencia(): void {
    if (this.apariencia.startsWith('blob:')) {
      URL.revokeObjectURL(this.apariencia);
    }
    this.apariencia = '';
  }
}

/** El archivo local en base64, que es como lo quiere AutoFirma. */
function aBase64(archivo: File): Promise<string> {
  return new Promise((ok, fallo) => {
    const lector = new FileReader();
    // `readAsDataURL` da "data:...;base64,XXXX"; sólo interesa lo de la coma.
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => fallo(new Error('No se ha podido leer el documento.'));
    lector.readAsDataURL(archivo);
  });
}

/**
 * Los parámetros de firma de AutoFirma, con sus nombres exactos.
 *
 * Las coordenadas van en puntos y con el origen abajo a la izquierda, y la
 * página numerada desde uno; el servidor ya las da así. La rúbrica es un JPEG en
 * base64 que AutoFirma **deforma** para llenar el recuadro, de ahí que las dos
 * cosas se compongan con la misma proporción.
 */
function extras(paquete: PaqueteAutofirma): Record<string, unknown> {
  // `signReason` y `signatureProductionCity` van al diccionario del PDF y valen
  // también para una firma invisible, así que no dependen del recuadro.
  const comunes = {
    signReason: paquete.motivo,
    signatureProductionCity: paquete.lugar,
  };
  if (!paquete.recuadro) {
    return comunes;
  }
  const [x0, y0, x1, y1] = paquete.recuadro;
  return {
    ...comunes,
    signaturePage: paquete.pagina,
    signaturePositionOnPageLowerLeftX: Math.round(x0),
    signaturePositionOnPageLowerLeftY: Math.round(y0),
    signaturePositionOnPageUpperRightX: Math.round(x1),
    signaturePositionOnPageUpperRightY: Math.round(y1),
    signatureRubricImage: paquete.rubrica,
  };
}
