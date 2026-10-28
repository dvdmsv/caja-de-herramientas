import { Injectable } from '@angular/core';

import {
  BovedaCifrada, ContrasenaIncorrecta, ITERACIONES, ParametrosClave, alAzar, aBase64, cifrar, deBase64, derivarClave,
  descifrar, leerBovedaCifrada, parametrosNuevos,
} from './boveda/cifrado';
import {
  BOVEDA_VACIA, CertificadoGuardado, ContenidoBoveda, FirmaGuardada, anadirCertificado, anadirFirma, leerContenido,
  quitar, renombrar,
} from './boveda/contenido';
import { borrarBoveda, guardarBoveda, leerBoveda, puente } from './escritorio';
import { nuevoId } from './ids';

/** Sin usarla este rato, se cierra sola y hay que volver a dar la contraseña. */
export const CIERRE_TRAS_MS = 15 * 60 * 1000;

/** Lo mínimo que se pide a la contraseña maestra: lo demás es cosa de cada cual. */
export const CONTRASENA_MINIMA = 8;

export type EstadoBoveda = 'no-disponible' | 'sin-crear' | 'cerrada' | 'abierta';

/** Lo que entrega «De la bóveda» en «Firmar con certificado». */
export interface CertificadoElegido {
  nombre: string;
  p12: string;
  contrasena?: string;
}

/**
 * La bóveda de certificados y firmas manuscritas. **Sólo existe en la
 * aplicación de Windows**: fuera de ella no hay puente, y en la web por HTTP
 * tampoco habría WebCrypto, que sólo se da en contexto seguro.
 *
 * - La clave sale de la contraseña maestra y vive **sólo en memoria**, no
 *   extraíble, hasta que se cierra: a mano, o sola a los `CIERRE_TRAS_MS` sin
 *   usarla. Cada ventana la abre por su cuenta: la clave no sale de su página.
 * - **Cada cambio relee el archivo, lo descifra, cambia y vuelve a cifrar**.
 *   Con varias ventanas abiertas, ninguna pisa lo que guardó otra. Si otra
 *   cambió la contraseña, el descifrado falla y ésta se cierra.
 * - En el disco sólo hay texto cifrado (`boveda_disco.rs`).
 */
@Injectable({ providedIn: 'root' })
export class BovedaService {
  private readonly tauri = puente();
  private readonly subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;

  estado: EstadoBoveda = this.disponible ? 'cerrada' : 'no-disponible';
  /** Lo que hay dentro; vacío mientras no esté abierta. */
  contenido: ContenidoBoveda = BOVEDA_VACIA;

  /** Las de PBKDF2 al crear o cambiar la contraseña. Sólo los tests las bajan. */
  iteraciones = ITERACIONES;

  private clave: CryptoKey | null = null;
  private cierre?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.comprobar();
  }

  get disponible(): boolean {
    return !!this.tauri && !!this.subtle;
  }

  get abierta(): boolean {
    return this.estado === 'abierta';
  }

  /**
   * Vuelve a mirar el disco. Otra ventana puede haberla creado, borrado o
   * cambiado de contraseña: quien la enseñe lo llama al aparecer.
   */
  async comprobar(): Promise<void> {
    if (!this.disponible) {
      return;
    }
    const guardada = await leerBoveda(this.tauri!);
    if (guardada === null) {
      this.olvidar('sin-crear');
      return;
    }
    if (!this.clave) {
      this.estado = 'cerrada';
      return;
    }
    try {
      this.contenido = leerContenido(await descifrar(this.subtle!, this.clave, leerBovedaCifrada(guardada)));
    } catch {
      this.cerrar();
    }
  }

  async crear(contrasena: string): Promise<void> {
    if (contrasena.length < CONTRASENA_MINIMA) {
      throw new Error(`La contraseña tiene que tener al menos ${CONTRASENA_MINIMA} caracteres.`);
    }
    if ((await leerBoveda(this.tauri!)) !== null) {
      throw new Error('Ya hay una bóveda: ábrela con su contraseña.');
    }
    const parametros = parametrosNuevos(alAzar, this.iteraciones);
    const clave = await derivarClave(this.subtle!, contrasena, parametros);
    await this.escribir(clave, parametros, BOVEDA_VACIA);
    this.abrirCon(clave, BOVEDA_VACIA);
  }

  /** Lanza `ContrasenaIncorrecta` si no es la suya. */
  async abrir(contrasena: string): Promise<void> {
    const cifrada = await this.leerCifrada();
    const clave = await derivarClave(this.subtle!, contrasena, cifrada.clave);
    const contenido = leerContenido(await descifrar(this.subtle!, clave, cifrada));
    this.abrirCon(clave, contenido);
  }

  cerrar(): void {
    this.olvidar(this.disponible ? 'cerrada' : 'no-disponible');
  }

  /** Vuelve a cifrarlo todo con una sal y una clave nuevas. */
  async cambiarContrasena(nueva: string): Promise<void> {
    if (nueva.length < CONTRASENA_MINIMA) {
      throw new Error(`La contraseña tiene que tener al menos ${CONTRASENA_MINIMA} caracteres.`);
    }
    const actual = await this.releer();
    const parametros = parametrosNuevos(alAzar, this.iteraciones);
    const clave = await derivarClave(this.subtle!, nueva, parametros);
    await this.escribir(clave, parametros, actual);
    this.abrirCon(clave, actual);
  }

  /** Borra el archivo. Sin la contraseña es lo único que se puede hacer con ella. */
  async borrar(): Promise<void> {
    await borrarBoveda(this.tauri!);
    this.olvidar('sin-crear');
  }

  // --- lo que se guarda ---------------------------------------------------

  async guardarCertificado(datos: Omit<CertificadoGuardado, 'id' | 'anadido'>): Promise<void> {
    const certificado: CertificadoGuardado = { ...datos, id: nuevoId(), anadido: new Date().toISOString() };
    await this.modificar(contenido => anadirCertificado(contenido, certificado));
  }

  async guardarFirma(archivo: Blob, nombre: string): Promise<void> {
    const firma: FirmaGuardada = {
      id: nuevoId(),
      nombre,
      tipo: archivo.type || 'image/png',
      imagen: aBase64(new Uint8Array(await archivo.arrayBuffer())),
      anadida: new Date().toISOString(),
    };
    await this.modificar(contenido => anadirFirma(contenido, firma));
  }

  async quitar(id: string): Promise<void> {
    await this.modificar(contenido => quitar(contenido, id));
  }

  async renombrar(id: string, nombre: string): Promise<void> {
    await this.modificar(contenido => renombrar(contenido, id, nombre));
  }

  // --- lo que se usa ------------------------------------------------------

  /** La firma como archivo, para entrar por donde entra una subida o un dibujo. */
  firmaComoArchivo(firma: FirmaGuardada): File {
    this.tocar();
    const extension = firma.tipo === 'image/jpeg' ? 'jpg' : 'png';
    return new File([deBase64(firma.imagen)], `${firma.nombre}.${extension}`, { type: firma.tipo });
  }

  /** Lo que «Firmar con certificado» necesita de un certificado guardado. */
  usarCertificado(certificado: CertificadoGuardado): CertificadoElegido {
    this.tocar();
    return { nombre: certificado.nombre, p12: certificado.p12, contrasena: certificado.contrasena };
  }

  /** Una imagen guardada como `data:`, para enseñarla en miniatura. */
  miniatura(firma: FirmaGuardada): string {
    return `data:${firma.tipo};base64,${firma.imagen}`;
  }

  // --- por dentro ---------------------------------------------------------

  private async modificar(cambio: (contenido: ContenidoBoveda) => ContenidoBoveda): Promise<void> {
    const cifrada = await this.leerCifrada();
    const actual = await this.descifrarConLaMia(cifrada);
    const nuevo = cambio(actual);
    await this.escribir(this.clave!, cifrada.clave, nuevo);
    this.contenido = nuevo;
    this.tocar();
  }

  /** Lo que hay ahora en el disco, con la clave de esta ventana. */
  private async releer(): Promise<ContenidoBoveda> {
    return this.descifrarConLaMia(await this.leerCifrada());
  }

  private async descifrarConLaMia(cifrada: BovedaCifrada): Promise<ContenidoBoveda> {
    if (!this.clave) {
      throw new Error('La bóveda está cerrada.');
    }
    try {
      return leerContenido(await descifrar(this.subtle!, this.clave, cifrada));
    } catch (error) {
      if (error instanceof ContrasenaIncorrecta) {
        this.cerrar();
        throw new Error('La contraseña de la bóveda ha cambiado en otra ventana. Vuelve a abrirla.');
      }
      throw error;
    }
  }

  private async leerCifrada(): Promise<BovedaCifrada> {
    const guardada = await leerBoveda(this.tauri!);
    if (guardada === null) {
      this.olvidar('sin-crear');
      throw new Error('No hay bóveda: se ha borrado, quizá desde otra ventana.');
    }
    return leerBovedaCifrada(guardada);
  }

  private async escribir(clave: CryptoKey, parametros: ParametrosClave, contenido: ContenidoBoveda): Promise<void> {
    const cifrada = await cifrar(this.subtle!, clave, parametros, contenido, alAzar);
    await guardarBoveda(this.tauri!, JSON.stringify(cifrada));
  }

  private abrirCon(clave: CryptoKey, contenido: ContenidoBoveda): void {
    this.clave = clave;
    this.contenido = contenido;
    this.estado = 'abierta';
    this.tocar();
  }

  /** Cada uso aplaza el cierre automático. */
  private tocar(): void {
    clearTimeout(this.cierre);
    this.cierre = setTimeout(() => this.cerrar(), CIERRE_TRAS_MS);
  }

  private olvidar(estado: EstadoBoveda): void {
    clearTimeout(this.cierre);
    this.clave = null;
    this.contenido = BOVEDA_VACIA;
    this.estado = estado;
  }
}
