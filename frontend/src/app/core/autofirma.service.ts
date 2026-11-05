import { Injectable } from '@angular/core';
import { SIN_SERVIDOR } from './plataforma';

/**
 * Firmar con un certificado instalado en el equipo, a través de AutoFirma.
 *
 * **Por qué hace falta un programa de por medio.** Ninguna página web puede
 * abrir el almacén de certificados del sistema: no hay API, y es deliberado —si
 * la hubiera, cualquier web podría pedir que se firme con tu certificado—. Los
 * applets de Java y ActiveX están eliminados, `<keygen>` se retiró del estándar,
 * y WebCrypto sólo maneja claves que la propia página genera o importa. Con el
 * DNIe ni siquiera cabría el arreglo: su clave no es exportable.
 *
 * Lo que hacen las sedes electrónicas, y lo que se hace aquí, es lanzar
 * AutoFirma: una aplicación de escritorio que sí vive en el equipo del usuario.
 * Ella abre el almacén, enseña el selector, firma en local y devuelve el
 * resultado. El navegador es sólo la lanzadera.
 *
 * Este servicio encapsula `autoscript.js`, la librería oficial, que es una
 * variable global con callbacks, y la deja detrás de promesas.
 */

/** La global que define `autoscript.js` al cargarse. */
declare const AutoScript: {
  cargarAppAfirma: (direccion?: string, almacen?: string) => void;
  setStickySignatory: (fijo: boolean) => void;
  selectCertificate: (params: string | null,
                      ok: (certificadoB64: string) => void,
                      error: (tipo: string, mensaje: string) => void) => void;
  sign: (datosB64: string, algoritmo: string, formato: string, params: string | null,
         ok: (firmaB64: string, certificadoB64: string) => void,
         error: (tipo: string, mensaje: string) => void) => void;
};

const RUTA = 'assets/autofirma/autoscript.js';

/** Lo que dice AutoFirma cuando el usuario cierra el selector sin elegir. */
const CANCELADO = /cancel/i;

export const DESCARGA_AUTOFIRMA = 'https://firmaelectronica.gob.es/Home/Descargas.html';

/**
 * Cuánto se espera a que AutoFirma conteste, en milisegundos.
 *
 * Hace falta porque `autoscript.js` **no avisa cuando no hay nadie al otro
 * lado**: enseña su propio diálogo, reintenta la conexión a los puertos locales
 * indefinidamente y nunca llama al callback de error. Sin este plazo la página
 * se queda con el botón girando para siempre y sólo se recupera recargando.
 *
 * Son generosos a propósito, porque el plazo cubre también lo que tarde la
 * persona en elegir su certificado o teclear el PIN de la tarjeta: más vale
 * esperar de más que cortarle a alguien una firma legítima.
 */
const ESPERA_SELECCION = 90_000;
const ESPERA_FIRMA = 180_000;

/** Se distingue de un fallo de verdad para no enseñar un error al cancelar. */
export class FirmaCancelada extends Error {
  constructor() {
    super('Has cerrado el selector de certificados.');
  }
}

@Injectable({ providedIn: 'root' })
export class AutofirmaService {
  private carga?: Promise<void>;

  /**
   * Trae la librería la primera vez que se usa.
   *
   * Con un `<script>` y no con un `import`: son 252 kB de código del Gobierno
   * que no tienen por qué entrar en el paquete de una aplicación en la que
   * veintitantas herramientas no firman nada.
   */
  private cargar(): Promise<void> {
    if (this.carga) {
      return this.carga;
    }
    this.carga = new Promise<void>((listo, fallo) => {
      const etiqueta = document.createElement('script');
      etiqueta.src = RUTA;
      etiqueta.onload = () => {
        AutoScript.cargarAppAfirma();
        // Con esto el certificado se elige una vez y vale para la firma que
        // viene después; con el DNIe, además, sólo pide el PIN al firmar.
        AutoScript.setStickySignatory(true);
        listo();
      };
      etiqueta.onerror = () => fallo(new Error('No se ha podido cargar autoscript.js.'));
      document.head.appendChild(etiqueta);
    });
    return this.carga;
  }

  /** Abre el selector del sistema y devuelve el certificado elegido, en base64.
   *
   * Sólo la parte pública: el manual del integrador es explícito en que esta
   * operación nunca toca las claves privadas ni pide sus contraseñas.
   */
  async elegirCertificado(): Promise<string> {
    if(SIN_SERVIDOR) {
      const {FirmasAndroid}=await import('./local/firmas-digitales');
      try{return (await FirmasAndroid.elegirCertificado()).certificado;}
      catch(e){if((e as {code?:string}).code==='CANCELADO')throw new FirmaCancelada();throw e;}
    }
    await this.cargar();
    return this.conPlazo(ESPERA_SELECCION, (ok, fallo) =>
      AutoScript.selectCertificate(null, ok, (tipo, mensaje) => fallo(this.traducir(tipo, mensaje))));
  }

  /** Firma el PDF con el certificado ya elegido y devuelve el resultado en base64. */
  async firmar(pdfB64: string, algoritmo: string, extras: Record<string, unknown>): Promise<string> {
    await this.cargar();
    // AutoFirma quiere los parámetros como texto: `clave=valor` por línea.
    const params = Object.entries(extras)
      .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
      .map(([clave, valor]) => `${clave}=${valor}`)
      .join('\n');

    return this.conPlazo(ESPERA_FIRMA, (ok, fallo) =>
      AutoScript.sign(pdfB64, algoritmo, 'PAdES', params, firma => ok(firma),
                      (tipo, mensaje) => fallo(this.traducir(tipo, mensaje))));
  }

  /**
   * Una operación de AutoFirma con plazo máximo.
   *
   * Cumplido el plazo se da por perdida: lo que llegue después se ignora, porque
   * la promesa ya está resuelta. Lo importante es que la pantalla se
   * desbloquee y se pueda volver a intentar.
   */
  private conPlazo(espera: number,
                   operacion: (ok: (v: string) => void, fallo: (e: Error) => void) => void
  ): Promise<string> {
    return new Promise<string>((resolver, rechazar) => {
      const reloj = setTimeout(() => rechazar(new Error(
        'AutoFirma no responde. Comprueba que lo tienes instalado y que has permitido que el ' +
        'navegador lo abra; si ya lo tenías abierto, ciérralo y vuelve a intentarlo. También ' +
        'puedes firmar con un archivo .p12 en la otra pestaña.')), espera);
      const acabar = <T,>(f: (v: T) => void) => (v: T) => { clearTimeout(reloj); f(v); };
      operacion(acabar(resolver), acabar(rechazar));
    });
  }

  /**
   * Convierte el error de AutoFirma en algo que se le pueda enseñar a alguien.
   *
   * El fallo típico no es un error del programa: es que el programa no está.
   */
  private traducir(tipo: string, mensaje: string): Error {
    const texto = `${tipo ?? ''} ${mensaje ?? ''}`;
    if (CANCELADO.test(texto)) {
      return new FirmaCancelada();
    }
    return new Error(
      'No se ha podido contactar con AutoFirma. Comprueba que lo tienes instalado y ' +
      'que has permitido que el navegador lo abra; si no lo tienes, puedes firmar con ' +
      `un archivo .p12 en la otra pestaña. (${mensaje || tipo || 'sin detalle'})`);
  }
}
