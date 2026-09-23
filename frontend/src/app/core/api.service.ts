import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, filter, map } from 'rxjs';

import { EstadoTrabajo } from '../shared/progreso';

/** Archivo tal y como lo describe el servidor. */
export interface ArchivoServidor {
  id: string;
  name: string;
  size: number;
  generated: boolean;
}

/** Comparación de peso antes y después, cuando la herramienta la aporta. */
/** Lo que ocupa la sesión en el servidor, en bytes, y su tope. */
export interface UsoSesion {
  usado: number;
  tope: number;
  /** Desde cuándo se puede borrar, en segundos Unix; `null` si no hay nada guardado. */
  caduca: number | null;
}

export interface ResumenTamano {
  antes: number;
  despues: number;
}

/** Texto convertido que algunas herramientas devuelven para enseñarlo en pantalla. */
export interface VistaPrevia {
  texto: string;
  caracteres: number;
  palabras: number;
}

/** Un dato que un archivo lleva dentro sin que su dueño lo sepa. */
export interface CampoMetadato {
  /** Con la que se le dice al servidor que lo borre o lo cambie. */
  clave: string;
  etiqueta: string;
  /** Recortado para enseñarlo de un vistazo. */
  valor: string;
  /** El valor entero, que es lo que se edita; vacío si el campo no lleva nada. */
  texto: string;
  /**
   * Si se puede escribir encima. Los bloques enteros —XMP, IPTC, la ubicación,
   * los datos técnicos de la cámara— sólo se conservan o se tiran.
   */
  editable: boolean;
}

/** Lo que "Editar metadatos" ha encontrado en un archivo. */
export interface MetadatosArchivo {
  /** Id del archivo en el servidor, para casar el informe con la selección. */
  id: string;
  archivo: string;
  campos: CampoMetadato[];
  /** Si lleva dentro dónde se hizo la foto. */
  ubicacion: boolean;
}

/** Quién es el titular de un certificado y hasta cuándo vale. */
export interface DatosCertificado {
  nombre: string;
  emisor: string;
  /** En ISO 8601, tal y como vienen del certificado. */
  desde: string;
  hasta: string;
  caducado: boolean;
  todavia_no: boolean;
  /** Un certificado que se expidió a sí mismo: sirve, pero nadie lo respalda. */
  autofirmado: boolean;
}

/** Una firma digital encontrada dentro de un PDF. */
export interface FirmaEncontrada {
  campo: string;
  firmante: string;
  emisor: string;
  autofirmado: boolean;
  fecha: string | null;
  /** La hora que puso una autoridad de sellado, si la hay. */
  sello_tiempo: string | null;
  /** Si los bytes firmados son los que hay. `null` si no se ha podido saber. */
  intacta: boolean | null;
  /** `todo`, `revision` (se añadió algo después) o `parcial`. */
  cobertura: string;
  cambios: string | null;
  vigente_al_firmar: boolean | null;
  error: string | null;
}

/** Lo que AutoFirma necesita para estampar el mismo sello que estampamos aquí. */
export interface PaqueteAutofirma {
  /** Numerada desde uno, que es como las cuenta AutoFirma. */
  pagina: number;
  /** `[x0, y0, x1, y1]` en puntos, con el origen abajo a la izquierda. */
  recuadro: number[] | null;
  /** El sello en JPEG y base64, ya acotado de tamaño. */
  rubrica: string;
  /** El que le corresponde a la clave del certificado. */
  algoritmo: string;
  motivo: string;
  lugar: string;
}

/** Lo que "Comprobar firmas" ha encontrado en un archivo. */
/** Cuántos datos de un tipo se han encontrado en un documento. */
export interface RecuentoAnonimizado {
  tipo: string;
  cuantas: number;
}

/** Un código leído de una imagen o de un PDF. */
export interface CodigoLeido {
  /** Cómo lo llama zxing-cpp: "QR Code", "EAN-13", "Code 128"… */
  formato: string;
  contenido: string;
  /** Qué clase de contenido es: wifi, correo, telefono, contacto, enlace, texto. */
  clase: string;
  /** En qué página estaba, sólo cuando venía de un PDF. */
  pagina?: number;
}

export interface InformeCodigos {
  id: string;
  archivo: string;
  codigos: CodigoLeido[];
}

/** Una tabla detectada en un PDF, antes de sacarla. */
export interface TablaDetectada {
  pagina: number;
  filas: number;
  columnas: number;
}

export interface TablasDetectadas {
  total: number;
  tablas: TablaDetectada[];
}

/** Un dato encontrado: qué es y dónde está. */
export interface MarcaAnonimizado {
  tipo: string;
  /**
   * Proporciones de 0 a 1, origen arriba a la izquierda y sobre la página sin
   * girar: la convención de todo el proyecto, la misma que usan las marcas del
   * visor, que es quien pinta esto.
   */
  rect: number[];
}

/** Lo que la inspección de "Anonimizar PDF" encuentra, sin tocar el archivo. */
export interface ZonasAnonimizado {
  total: number;
  recuento: RecuentoAnonimizado[];
  paginas: { pagina: number; marcas: MarcaAnonimizado[] }[];
}

export interface InformeFirmas {
  id: string;
  archivo: string;
  firmas: FirmaEncontrada[];
}

/** Respuesta de cualquier herramienta: siempre una lista de archivos. */
export interface Resultado {
  files: ArchivoServidor[];
  resumen?: ResumenTamano;
  vista_previa?: VistaPrevia;
  /** Sólo la manda "Comparar PDF": el recuento de páginas de su informe. */
  comparacion?: ResumenComparacion;
  /** Sólo la manda "Comprimir PDF" cuando se le pide un tamaño: si ha llegado. */
  objetivo?: ObjetivoTamano;
}

export interface ObjetivoTamano {
  bytes: number;
  logrado: boolean;
  /** "Comprimir imagen": las que no han llegado, por nombre. */
  no_alcanzadas?: string[];
}

/** Lo más que puede bajar un PDF, y lo que pesa ahora. */
export interface MinimoPdf {
  minimo: number;
  original: number;
}

/** Lo que contesta la consulta de progreso; `null` es «aún no ha empezado». */
export interface EstadoTrabajoRespuesta {
  estado: EstadoTrabajo | null;
}

/** Lo que ha salido de comparar dos documentos, para contarlo en pantalla. */
export interface ResumenComparacion {
  identicos: boolean;
  iguales: number;
  cambiadas: number;
  anadidas: number;
  quitadas: number;
  /** Cuántos párrafos cambian de uno a otro. */
  diferencias: number;
}

/** Formato de imagen ofrecido por el servidor. */
export interface FormatoImagen {
  id: string;
  extension: string;
  nombre: string;
  calidad: boolean;
}

/** Progreso de una subida, o el resultado cuando ya ha terminado. */
/** Un archivo que el servidor no ha admitido, y por qué. */
export interface ArchivoRechazado {
  /** Posición que ocupaba en la tanda enviada, para saber cuál de la cola es. */
  indice: number;
  name: string;
  error: string;
}

export type ProgresoSubida =
  | { tipo: 'progreso'; porcentaje: number }
  | { tipo: 'hecho'; archivos: ArchivoServidor[]; rechazados: ArchivoRechazado[] };

/** Lo que responde el servidor al subir: lo admitido y, si lo hay, lo rechazado. */
interface RespuestaSubida {
  files: ArchivoServidor[];
  rechazados?: ArchivoRechazado[];
}

/**
 * Única puerta de entrada a la API. Todas las herramientas la usan; la cabecera
 * de sesión la añade `sessionInterceptor`, aquí no hace falta pensar en ella.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  /** Sube archivos y va emitiendo el progreso hasta terminar. */
  subir(archivos: File[]): Observable<ProgresoSubida> {
    const formData = new FormData();
    archivos.forEach(archivo => formData.append('files', archivo));

    return this.http
      .post<RespuestaSubida>('/api/files', formData, {
        observe: 'events',
        reportProgress: true,
      })
      .pipe(
        map(evento => this.aProgreso(evento)),
        filter((estado): estado is ProgresoSubida => estado !== null)
      );
  }

  /** Ejecuta una herramienta del servidor sobre archivos ya subidos. */
  ejecutar(slug: string, cuerpo: unknown, trabajo?: string): Observable<Resultado> {
    // El identificador del trabajo va en una cabecera y no en el cuerpo: así
    // las veinticinco herramientas siguen recibiendo exactamente sus opciones.
    const opciones = trabajo ? { headers: { 'X-Trabajo-Id': trabajo } } : {};
    return this.http.post<Resultado>(`/api/tools/${slug}`, cuerpo, opciones);
  }

  /**
   * Por dónde va el trabajo que está en marcha.
   *
   * Lo contesta el servicio `web`, que está libre; preguntárselo al que trabaja
   * sería hacer cola detrás de aquello por lo que se pregunta. `null` significa
   * que aún no ha empezado: está esperando turno.
   */
  progresoDelTrabajo(trabajo: string): Observable<EstadoTrabajoRespuesta> {
    return this.http.get<EstadoTrabajoRespuesta>(`/api/progreso/${trabajo}`);
  }

  /**
   * Pide parar el trabajo. No mata nada: deja una marca que el propio trabajo
   * mira entre paso y paso, y que responde con un 409.
   */
  cancelarTrabajo(trabajo: string): Observable<void> {
    return this.http.post<void>(`/api/progreso/${trabajo}/cancelar`, {});
  }

  /** Empaqueta varios resultados en un ZIP y devuelve el archivo creado. */
  empaquetar(ids: string[], nombre: string): Observable<ArchivoServidor> {
    return this.http
      .post<Resultado>('/api/files/zip', { file_ids: ids, name: nombre })
      .pipe(map(respuesta => respuesta.files[0]));
  }

  /**
   * Formatos disponibles en esta instalación del servidor. Cada herramienta
   * ofrece los suyos: "pdf-a-imagen" no incluye PDF, por ejemplo.
   */
  formatosDeImagen(slug = 'convertir-imagen'): Observable<FormatoImagen[]> {
    return this.http
      .get<{ formatos: FormatoImagen[] }>(`/api/tools/${slug}/formatos`)
      .pipe(map(respuesta => respuesta.formatos));
  }

  /**
   * Firma ya procesada (fondo recortado), como URL lista para un `<img>`.
   *
   * La prepara el servidor y no el navegador para que la vista previa enseñe
   * exactamente los píxeles que se van a estampar en el documento.
   */
  prepararFirma(id: string, quitarFondo: boolean, umbral: number): Observable<string> {
    return this.http
      .post('/api/tools/firmar/preparar',
            { firma_id: id, quitar_fondo: quitarFondo, umbral },
            { responseType: 'blob' })
      .pipe(map(blob => URL.createObjectURL(blob)));
  }

  /**
   * Descarga un archivo. Va por HttpClient (y no por `window.open`) porque la
   * petición necesita la cabecera de sesión, que una navegación no envía.
   */
  descargar(archivo: ArchivoServidor): Observable<void> {
    return this.http
      .get(`/api/files/${archivo.id}/download`, { responseType: 'blob' })
      .pipe(map(blob => guardarComo(blob, archivo.name)));
  }

  /**
   * Cuántas páginas tiene un archivo ya subido.
   *
   * Lo dice el servidor para que un selector de página no obligue a cargar
   * pdf.js en el navegador.
   */
  paginasDe(id: string): Observable<number> {
    return this.http
      .get<{ paginas: number }>(`/api/files/${id}/paginas`)
      .pipe(map(respuesta => respuesta.paginas));
  }

  /**
   * Cómo va a quedar una página, ya con lo que la herramienta le va a estampar.
   *
   * La dibuja el servidor con el mismo código que escribirá el archivo, así que
   * lo que se ve es lo que sale. Quien la pida se encarga de revocar el object
   * URL, igual que con `prepararFirma`.
   */
  previsualizar(slug: string, cuerpo: unknown): Observable<string> {
    return this.http
      .post(`/api/tools/${slug}/previsualizar`, cuerpo, { responseType: 'blob' })
      .pipe(map(blob => URL.createObjectURL(blob)));
  }

  /**
   * De quién es un certificado digital y hasta cuándo vale.
   *
   * Sirve a las dos vías: el `.p12` con su contraseña —que va en base64 dentro
   * del cuerpo, y no como archivo subido, para que la clave privada no llegue a
   * tocar el disco del servidor— y el certificado suelto que devuelve el
   * selector de AutoFirma, que es sólo la parte pública.
   */
  inspeccionarCertificado(cuerpo: unknown): Observable<DatosCertificado> {
    return this.http.post<DatosCertificado>('/api/tools/firmar-certificado/certificado', cuerpo);
  }

  /**
   * El recuadro del sello de firma, como imagen lista para colocar.
   *
   * Lo dibuja pyHanko —el mismo código que va a firmar—, así que se puede
   * arrastrar sobre la página sabiendo que es exactamente lo que saldrá. Quien
   * lo pide se encarga de revocar el object URL.
   */
  aparienciaDeFirma(cuerpo: unknown): Observable<string> {
    return this.http
      .post('/api/tools/firmar-certificado/apariencia', cuerpo, { responseType: 'blob' })
      .pipe(map(blob => URL.createObjectURL(blob)));
  }

  /**
   * La colocación y el sello para que los estampe AutoFirma.
   *
   * Lo calcula el servidor con las mismas funciones que la vía del `.p12`: la
   * conversión de coordenadas tiene que corregir el giro de la página, y
   * duplicarla aquí en TypeScript sería garantizar que las dos se desvían.
   */
  paraAutofirma(cuerpo: unknown): Observable<PaqueteAutofirma> {
    return this.http.post<PaqueteAutofirma>('/api/tools/firmar-certificado/autofirma', cuerpo);
  }

  /** Qué firmas digitales lleva dentro un PDF y si siguen en pie. */
  comprobarFirmas(ids: string[]): Observable<InformeFirmas[]> {
    return this.http
      .post<{ informes: InformeFirmas[] }>('/api/tools/comprobar-firmas/inspeccionar',
                                           { file_ids: ids })
      .pipe(map(respuesta => respuesta.informes));
  }

  /**
   * Qué metadatos llevan dentro unos archivos, sin tocarlos.
   *
   * Es la primera mitad de "Editar metadatos": primero se enseña lo que hay y
   * luego el usuario decide qué se borra.
   */
  inspeccionarMetadatos(ids: string[]): Observable<MetadatosArchivo[]> {
    return this.http
      .post<{ metadatos: MetadatosArchivo[] }>('/api/tools/limpiar-metadatos/inspeccionar',
                                               { file_ids: ids })
      .pipe(map(respuesta => respuesta.metadatos));
  }

  /**
   * Lo más ligero que puede quedar un PDF, para no dejar pedir un tamaño
   * imposible. Cuesta una compresión entera: pedirlo sólo cuando haga falta.
   */
  minimoComprimirPdf(id: string): Observable<MinimoPdf> {
    return this.http.post<MinimoPdf>('/api/tools/comprimir-pdf/minimo', { file_ids: [id] });
  }

  /** Qué códigos QR o de barras llevan dentro unas imágenes o unos PDF. */
  leerCodigos(ids: string[]): Observable<InformeCodigos[]> {
    return this.http
      .post<{ informes: InformeCodigos[] }>('/api/tools/leer-codigo/inspeccionar',
                                            { file_ids: ids })
      .pipe(map(respuesta => respuesta.informes));
  }

  /**
   * Qué tablas trae un PDF, sin escribir nada.
   *
   * Es lo que evita ejecutar a ciegas: si el documento maqueta sus tablas con
   * espacios en vez de dibujarlas, aquí sale un cero y se puede explicar por
   * qué, en vez de entregar un libro vacío.
   */
  inspeccionarTablas(id: string): Observable<TablasDetectadas> {
    return this.http.post<TablasDetectadas>('/api/tools/extraer-tablas/inspeccionar',
                                            { file_ids: [id] });
  }

  /**
   * Qué datos personales hay en un PDF y dónde, sin tocarlo.
   *
   * La usan las dos pantallas: "Anonimizar PDF" para decir cuántos hay antes de
   * un borrado que no tiene vuelta atrás, y el visor para pre-marcar las
   * coincidencias y dejar que se revisen. Los patrones viven sólo en el
   * servidor (`api/patrones.py`) a propósito: reescribirlos aquí sería
   * garantizar que las dos versiones se separan a la primera corrección.
   */
  inspeccionarAnonimizado(id: string, tipos: string[], patron: string):
      Observable<ZonasAnonimizado> {
    return this.http.post<ZonasAnonimizado>('/api/tools/anonimizar-pdf/inspeccionar',
                                            { file_ids: [id], tipos, patron });
  }

  /**
   * El contenido de un archivo, para enseñarlo sin descargarlo.
   *
   * Va por HttpClient por lo mismo que `descargar`: la sesión viaja en una
   * cabecera, así que un `<iframe src="/api/…">` se quedaría fuera. Quien lo
   * pida se encarga de crear el object URL y de revocarlo.
   */
  contenido(archivo: ArchivoServidor): Observable<Blob> {
    return this.http.get(`/api/files/${archivo.id}/download`, { responseType: 'blob' });
  }

  /**
   * Cambia el nombre con el que se descargará un archivo. La extensión la
   * conserva el servidor, así que da igual si el nombre nuevo la lleva o no.
   */
  renombrar(id: string, nombre: string): Observable<ArchivoServidor> {
    return this.http.patch<ArchivoServidor>(`/api/files/${id}`, { name: nombre });
  }

  /** Elimina un archivo concreto del servidor. */
  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(`/api/files/${id}`);
  }

  /**
   * Avisa al servidor de que la sesión sigue viva.
   *
   * El visor trabaja en el navegador: sin esto, una lectura larga acabaría con
   * los archivos borrados por inactividad justo cuando se va a guardar.
   */
  mantenerSesion(): Observable<void> {
    return this.http.post<void>('/api/session/keepalive', {});
  }

  /** Borra todos los archivos de esta sesión. */
  /** Cuánto ocupa la sesión y cuánto le cabe, para poder enseñarlo. */
  usoDeLaSesion(): Observable<UsoSesion> {
    return this.http.get<UsoSesion>('/api/session/uso');
  }

  limpiarSesion(): Observable<void> {
    return this.http.delete<void>('/api/session');
  }

  private aProgreso(evento: HttpEvent<RespuestaSubida>): ProgresoSubida | null {
    if (evento.type === HttpEventType.UploadProgress && evento.total) {
      return { tipo: 'progreso', porcentaje: Math.round((100 * evento.loaded) / evento.total) };
    }
    if (evento.type === HttpEventType.Response && evento.body) {
      return { tipo: 'hecho', archivos: evento.body.files,
               rechazados: evento.body.rechazados ?? [] };
    }
    return null;
  }
}

/** Dispara la descarga del blob en el navegador con el nombre original. */
function guardarComo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}
