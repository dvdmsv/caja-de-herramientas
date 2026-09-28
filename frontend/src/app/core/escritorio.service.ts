import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import Swal from 'sweetalert2';

import {
  AVISO_DESDE_MS, EVENTO_ABIERTOS, EVENTO_ACTUALIZACION, abrirCarpetaDeDatos, acortarCarpeta, actualizacionPendiente,
  responderActualizacion, aplicarMenuContextual, avisarFin, buscarActualizacionAhora, describirGuardado, elegirCarpeta,
  elegirCarpetaDeGuardado, elegirDestino, esFaltaDePermiso, guardarAjustes, guardarConDialogo, guardarEnDestino,
  informacionDeSoporte, leerAjustes, leerMenuContextual, mostrarGuardado, nuevaVentana, progresoTarea, puente,
  recogerAbiertos, reiniciar, textoDelAviso, versionDeLaAplicacion,
} from './escritorio';
import type { AjustesEscritorio, CambiosAjustes, EstadoAjustes } from './ajustes-escritorio';
import { AvanceTrabajo } from '../shared/progreso';
import { AjustesMenu, accionesMarcadas, extensionesQueAcepta } from './menu-contextual';
import type { AvisoActualizacion, NovedadesDeVersion, ReleaseGitHub } from './novedades';
import { avisoError, avisoInfo, mensajeDeError } from '../shared/notify';
import { buscarPorSlug, rutaDe } from './tools';
import { TraspasoService } from './traspaso.service';

/**
 * La aplicación de escritorio vista desde Angular (la lógica, en `escritorio.ts`).
 *
 * Los archivos de «Abrir con…» llegan a la portada como si se hubieran soltado
 * en ella: ahí ya se ofrecen las herramientas que los aceptan, y desde ahí
 * siguen por `TraspasoService` como cualquier otro. Por eso ninguna
 * herramienta sabe nada de esto.
 */
@Injectable({ providedIn: 'root' })
export class EscritorioService {
  private readonly tauri = puente();
  private readonly router = inject(Router);
  private readonly zona = inject(NgZone);
  private readonly traspaso = inject(TraspasoService);

  /** Recibidos antes de que la portada estuviera montada para recogerlos. */
  private recibidos: File[] = [];

  /** Para la portada ya montada cuando llegan más. */
  readonly llegan = new Subject<File[]>();

  get activo(): boolean {
    return this.tauri !== null;
  }

  /** Lo llama la raíz al arrancar. Fuera de la aplicación no hace nada. */
  iniciar(): void {
    if (!this.tauri) {
      return;
    }
    // main.rs avisa con un evento del DOM, que zone.js no ve como propio si
    // llega por `eval`: se vuelve a la zona para que se pinte.
    window.addEventListener(EVENTO_ABIERTOS, () => this.zona.run(() => this.recoger()));
    // La versión nueva: si main.rs la encuentra con la página ya cargada, avisa
    // con el evento; si la encontró antes, se pregunta aquí al arrancar.
    window.addEventListener(EVENTO_ACTUALIZACION, () => this.zona.run(() => this.avisarDeActualizacion()));
    this.avisarDeActualizacion();
    // Una copia de los ajustes para lo que se consulta a menudo (los avisos al
    // terminar). Si falla, se sigue con los valores de serie.
    this.estadoAjustes().catch(() => {});
    // Ctrl+N, como en cualquier programa de Windows. También escribiendo en un
    // campo: ahí no significa nada, y sin `preventDefault` WebView2 abriría una
    // ventana suya, sin nada de lo que main.rs le pone a las de la aplicación.
    window.addEventListener('keydown', evento => {
      if (evento.ctrlKey && !evento.shiftKey && !evento.altKey && evento.key.toLowerCase() === 'n') {
        evento.preventDefault();
        this.nuevaVentana();
      }
    });
    this.recoger();
  }

  /**
   * El aviso de versión nueva, con lo que trae cada versión desde la instalada
   * para que cada uno decida si le compensa actualizar ya (ver `novedades.ts`).
   * Con varias ventanas, lo enseña sólo la primera que lo pide.
   */
  private async avisarDeActualizacion(): Promise<void> {
    let aviso: AvisoActualizacion | null;
    try {
      aviso = await actualizacionPendiente(this.tauri!);
    } catch (error) {
      console.warn('No se ha podido preguntar por la versión nueva.', error);
      return;
    }
    if (!aviso) {
      return;
    }
    // Se carga aquí y no arriba: sólo lo usa la aplicación, y en la web serían
    // kilobytes de más para todo el mundo en la carga inicial.
    const { htmlDelAviso } = await import('./novedades');
    const { versiones, completas } = await this.novedades(aviso);
    const respuesta = await Swal.fire({
      title: `Versión ${aviso.version} disponible`,
      html: htmlDelAviso(aviso, versiones, completas),
      customClass: { popup: 'aviso-novedades' },
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Actualizar ahora',
      cancelButtonText: 'Ahora no',
      denyButtonText: 'Saltar esta versión',
      // Cerrar el aviso de cualquier otra forma es «Ahora no»: vuelve a
      // preguntar la próxima vez que se abra la aplicación.
      focusConfirm: true,
    });
    const decision = respuesta.isConfirmed ? 'actualizar' : respuesta.isDenied ? 'saltar' : 'despues';
    responderActualizacion(this.tauri!, decision)
      .catch(error => avisoError(mensajeDeError(error, 'No se ha podido actualizar.')));
  }

  /**
   * Las novedades de todas las versiones desde la instalada, pedidas a GitHub.
   * Si no contesta en unos segundos, las de la última, que trae el aviso.
   */
  private async novedades(aviso: AvisoActualizacion): Promise<{ versiones: NovedadesDeVersion[]; completas: boolean }> {
    const { RELEASES, novedadesEntre, soloLaUltima } = await import('./novedades');
    try {
      const respuesta = await fetch(RELEASES, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!respuesta.ok) {
        throw new Error(`GitHub ha contestado ${respuesta.status}`);
      }
      const versiones = novedadesEntre((await respuesta.json()) as ReleaseGitHub[], aviso.instalada, aviso.version);
      if (versiones.length > 0) {
        return { versiones, completas: true };
      }
    } catch (error) {
      console.warn('No se han podido pedir las novedades a GitHub.', error);
    }
    return { versiones: soloLaUltima(aviso), completas: false };
  }

  /** Otra ventana de la aplicación, vacía y con su propia sesión. */
  nuevaVentana(): void {
    if (this.tauri) {
      nuevaVentana(this.tauri).catch(error => console.warn('No se ha podido abrir otra ventana.', error));
    }
  }

  /** La versión instalada, o `null` en la web o si no se puede saber. */
  async version(): Promise<string | null> {
    if (!this.tauri) {
      return null;
    }
    try {
      return await versionDeLaAplicacion(this.tauri);
    } catch {
      return null;
    }
  }

  /** Lo que haya llegado mientras la portada no estaba. Se entrega una vez. */
  tomar(): File[] {
    const archivos = this.recibidos;
    this.recibidos = [];
    return archivos;
  }

  /**
   * Guarda con el diálogo de Windows. Devuelve `false` si no hay aplicación o
   * si la ventana no tiene permiso: entonces quien llama hace lo del navegador.
   */
  async guardar(blob: Blob, nombre: string): Promise<boolean> {
    if (!this.tauri) {
      return false;
    }
    try {
      const ruta = await guardarConDialogo(this.tauri, blob, nombre);
      if (ruta) {
        this.avisarGuardado(ruta);
      }
      return true;
    } catch (error) {
      if (esFaltaDePermiso(error)) {
        // Se descarga como en el navegador, pero diciéndolo: este rechazo
        // fue mudo durante tres versiones («not allowed by ACL» por no
        // declarar el permiso del comando) y nadie lo vio hasta usarla.
        console.warn('Tauri ha rechazado guardar_como; se descarga como en el navegador.', error);
        return false;
      }
      throw error;
    }
  }

  /**
   * Tras guardar, el diálogo de Windows se cierra y no se veía nada: aquí se
   * dice dónde ha quedado, con un botón para abrir el Explorador ahí. Con el
   * aspecto de los demás avisos (`shared/notify.ts`), pero con más tiempo y
   * pausa al pasar por encima, porque trae algo que hacer.
   */
  private avisarGuardado(ruta: string): void {
    const { archivo, carpeta } = describirGuardado(ruta);
    this.avisarConCarpeta(`Guardado: ${archivo}`, carpeta ? `En ${carpeta}` : undefined);
  }

  private avisarConCarpeta(titulo: string, texto?: string): void {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: titulo,
      text: texto,
      showConfirmButton: true,
      confirmButtonText: 'Mostrar en la carpeta',
      timer: 7000,
      timerProgressBar: true,
      didOpen: aviso => {
        aviso.addEventListener('mouseenter', Swal.stopTimer);
        aviso.addEventListener('mouseleave', Swal.resumeTimer);
      },
    }).then(respuesta => {
      if (respuesta.isConfirmed && this.tauri) {
        mostrarGuardado(this.tauri).catch(error => console.warn('No se ha podido abrir la carpeta.', error));
      }
    });
  }

  /**
   * «Añadir carpeta»: los archivos de la carpeta que elija la persona que
   * encajen con `acepta`, sin subcarpetas. Vacío si cierra el diálogo o si no hay
   * ninguno, y entonces se dice.
   */
  async archivosDeCarpeta(acepta: string): Promise<File[]> {
    if (!this.tauri) {
      return [];
    }
    try {
      const elegida = await elegirCarpeta(this.tauri, extensionesQueAcepta(acepta));
      if (!elegida) {
        return [];
      }
      const carpeta = acortarCarpeta(elegida.carpeta);
      if (elegida.archivos.length === 0) {
        avisoInfo(`En ${carpeta} no hay ningún archivo que sirva aquí.`);
      } else if (elegida.sobran > 0) {
        avisoInfo(`Se han añadido los ${elegida.archivos.length} primeros; quedan ${elegida.sobran} más en ` +
          'la carpeta. Cuando acabes con estos, añade la carpeta otra vez.');
      }
      return elegida.archivos;
    } catch (error) {
      avisoError(mensajeDeError(error, 'No se ha podido leer la carpeta.'));
      return [];
    }
  }

  /**
   * «Guardar todo en una carpeta»: un solo diálogo y cada archivo suelto, con su
   * nombre y sin sobrescribir ninguno. Si algo falla a mitad, dice cuántos
   * quedaron guardados.
   */
  async guardarTodos(archivos: { nombre: string; contenido: () => Promise<Blob> }[]): Promise<void> {
    if (!this.tauri) {
      return;
    }
    let guardados = 0;
    try {
      const destino = await elegirDestino(this.tauri);
      if (!destino) {
        return;
      }
      for (const archivo of archivos) {
        await guardarEnDestino(this.tauri, await archivo.contenido(), archivo.nombre);
        guardados++;
      }
      this.avisarGuardadoEn(guardados, destino);
    } catch (error) {
      const hechos = guardados > 0 ? ` Se han guardado ${guardados} de ${archivos.length}.` : '';
      avisoError(mensajeDeError(error, 'No se han podido guardar los archivos.') + hechos);
    }
  }

  private avisarGuardadoEn(cuantos: number, carpeta: string): void {
    this.avisarConCarpeta(`Guardados ${cuantos} archivos`, `En ${acortarCarpeta(carpeta)}`);
  }

  private ultimoProgreso = 0;

  /**
   * El progreso de un trabajo en el icono de la barra de tareas. Llega en cada
   * vuelta del sondeo; se manda como mucho cada medio segundo.
   */
  progreso(avance: AvanceTrabajo): void {
    if (!this.tauri || Date.now() - this.ultimoProgreso < 500) {
      return;
    }
    this.ultimoProgreso = Date.now();
    const porcentaje = avance.indeterminado ? null : Math.round(avance.porcentaje);
    progresoTarea(this.tauri, porcentaje, false).catch(() => {});
  }

  /**
   * Quita la barra y, si el trabajo ha sido largo, avisa con una notificación
   * de Windows (que main.rs sólo enseña si la ventana no tiene el foco).
   * `bien` a `null` es un trabajo cancelado: sólo se quita la barra.
   */
  terminado(herramienta: string, bien: boolean | null, duracionMs: number, archivos: string[], mensaje = ''): void {
    if (!this.tauri) {
      return;
    }
    this.ultimoProgreso = 0;
    progresoTarea(this.tauri, null, true).catch(() => {});
    const avisos = this.ajustes?.avisos;
    const desde = avisos ? avisos.desde_segundos * 1000 : AVISO_DESDE_MS;
    if (bien === null || avisos?.activos === false || duracionMs < desde) {
      return;
    }
    const { titulo, cuerpo } = textoDelAviso(herramienta, bien, archivos, mensaje);
    avisarFin(this.tauri, titulo, cuerpo).catch(error => console.warn('No se ha podido avisar al terminar.', error));
  }

  // --- Ajustes ------------------------------------------------------------

  /** La última copia de los ajustes, para no preguntar a Tauri en cada trabajo. */
  private ajustes: AjustesEscritorio | null = null;

  private puenteOLanzar() {
    if (!this.tauri) {
      throw new Error('Sólo en la aplicación de Windows.');
    }
    return this.tauri;
  }

  private recordar(estado: EstadoAjustes): EstadoAjustes {
    this.ajustes = estado.ajustes;
    return estado;
  }

  async estadoAjustes(): Promise<EstadoAjustes> {
    return this.recordar(await leerAjustes(this.puenteOLanzar()));
  }

  async guardarAjustes(cambios: CambiosAjustes): Promise<EstadoAjustes> {
    return this.recordar(await guardarAjustes(this.puenteOLanzar(), cambios));
  }

  /** `null` si se cierra el diálogo sin elegir. */
  async elegirCarpetaDeGuardado(): Promise<EstadoAjustes | null> {
    const estado = await elegirCarpetaDeGuardado(this.puenteOLanzar());
    return estado ? this.recordar(estado) : null;
  }

  /**
   * «Buscar ahora»: si hay versión nueva, se enseña el aviso de siempre con sus
   * novedades. Devuelve cuál, o `null` si ya se tiene la última.
   */
  async buscarActualizacionAhora(): Promise<string | null> {
    const version = await buscarActualizacionAhora(this.puenteOLanzar());
    if (version) {
      await this.avisarDeActualizacion();
    }
    return version;
  }

  async abrirCarpetaDeDatos(): Promise<void> {
    await abrirCarpetaDeDatos(this.puenteOLanzar());
  }

  async informacionDeSoporte(): Promise<string> {
    return informacionDeSoporte(this.puenteOLanzar());
  }

  async reiniciar(): Promise<void> {
    await reiniciar(this.puenteOLanzar());
  }

  /** Cómo está el menú del Explorador; `null` fuera de la aplicación. */
  async menuContextual(): Promise<AjustesMenu | null> {
    return this.tauri ? leerMenuContextual(this.tauri) : null;
  }

  /** Lo pone o lo quita con las herramientas marcadas; devuelve cómo queda. */
  async aplicarMenuContextual(activo: boolean, marcadas: string[]): Promise<AjustesMenu> {
    if (!this.tauri) {
      throw new Error('Sólo en la aplicación de Windows.');
    }
    return aplicarMenuContextual(this.tauri, activo, accionesMarcadas(marcadas));
  }

  /**
   * Lo que llega del menú del Explorador va directo a su herramienta, por
   * `TraspasoService` como «Usar en…», así que la herramienta no sabe nada.
   * Lo de «Abrir con…» va a la portada, que ofrece las que lo aceptan. Si llegan
   * varias tandas a la vez manda la última, que es la que acaba de pedirse.
   */
  private async recoger(): Promise<void> {
    let llegadas;
    try {
      llegadas = await recogerAbiertos(this.tauri!);
    } catch (error) {
      console.warn('No se han podido recoger los archivos de «Abrir con…».', error);
      return;
    }
    const llegada = llegadas.at(-1);
    if (!llegada?.archivos.length) {
      return;
    }
    const herramienta = llegada.herramienta ? buscarPorSlug(llegada.herramienta) : undefined;
    if (herramienta) {
      this.traspaso.dejar(llegada.archivos);
      // Por la portada primero: si ya se está en esa herramienta, navegar a la
      // misma ruta no la vuelve a montar y los archivos se quedarían sin recoger.
      await this.router.navigateByUrl('/', { skipLocationChange: true });
      await this.router.navigateByUrl(rutaDe(herramienta));
      return;
    }
    this.recibidos = llegada.archivos;
    this.llegan.next(llegada.archivos);
    if (this.router.url.split(/[?#]/)[0] !== '/') {
      await this.router.navigateByUrl('/');
    }
  }
}
