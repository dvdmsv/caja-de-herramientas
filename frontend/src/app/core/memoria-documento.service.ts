import { Injectable } from '@angular/core';

import { Borrador } from '../pages/visor/cambios';

/**
 * Lo que el visor recuerda de cada documento entre visitas: por dónde ibas, con
 * qué zoom y qué llevabas subrayado sin guardar.
 *
 * En una sesión de trabajo larga, perder eso por un refresco es lo peor que
 * puede pasar, y es justo lo más fácil que pase.
 */

export interface Recuerdo {
  pagina: number;
  escala: number;
  modoZoom: string;
  columnas: number;
  /** Desde que hay más modos que una o dos columnas; sin él, sale de `columnas`. */
  modoLectura?: string;
  oscuro: boolean;
  /** Las capas que se han encendido o apagado, por su id. */
  capas?: Record<string, boolean>;
  borrador?: Borrador;
  actualizado: number;
}

const PREFIJO = 'visor:';

/** Preferencias de la aplicación, no de un documento concreto. */
const CLAVE_PREFERENCIAS = 'visor.preferencias';

/** Cuántos documentos se recuerdan antes de ir tirando los más viejos. */
const MAXIMO_RECUERDOS = 20;

@Injectable({ providedIn: 'root' })
export class MemoriaDocumentoService {
  /**
   * Huella para reconocer un archivo entre visitas.
   *
   * No se usa `crypto.subtle` porque **no existe fuera de contexto seguro**, y
   * esta aplicación se sirve por HTTP en la red local: ahí no estaría
   * disponible. Con el nombre, el tamaño y una muestra del contenido basta;
   * esto distingue documentos, no protege de nadie.
   */
  async huella(archivo: File): Promise<string> {
    const trozos: ArrayBuffer[] = [
      await archivo.slice(0, 65536).arrayBuffer(),
      await archivo.slice(Math.max(0, archivo.size - 65536)).arrayBuffer(),
    ];

    let hash = 0x811c9dc5; // FNV-1a de 32 bits
    for (const trozo of trozos) {
      const bytes = new Uint8Array(trozo);
      for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
    return `${archivo.size.toString(36)}-${hash.toString(36)}`;
  }

  /**
   * Preferencias que no dependen del documento, como si el menú de selección
   * está encendido. Van aparte de los recuerdos, que sí son de cada archivo.
   */
  preferencias(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) || '{}');
    } catch {
      return {};
    }
  }

  guardarPreferencia(clave: string, valor: unknown): void {
    try {
      localStorage.setItem(CLAVE_PREFERENCIAS,
                           JSON.stringify({ ...this.preferencias(), [clave]: valor }));
    } catch {
      /* sin almacenamiento: se pierde al recargar, nada más */
    }
  }

  recordar(huella: string): Recuerdo | null {
    try {
      const guardado = localStorage.getItem(PREFIJO + huella);
      return guardado ? (JSON.parse(guardado) as Recuerdo) : null;
    } catch {
      return null; // modo privado, almacenamiento lleno o dato corrupto
    }
  }

  guardar(huella: string, recuerdo: Omit<Recuerdo, 'actualizado'>): void {
    try {
      localStorage.setItem(PREFIJO + huella,
                           JSON.stringify({ ...recuerdo, actualizado: Date.now() }));
      this.podar();
    } catch {
      /* sin sitio o sin permiso: se sigue trabajando, sólo que sin memoria */
    }
  }

  olvidar(huella: string): void {
    try {
      localStorage.removeItem(PREFIJO + huella);
    } catch {
      /* nada que hacer */
    }
  }

  /** Tira los recuerdos más antiguos para no llenar el almacenamiento. */
  private podar(): void {
    const claves = Object.keys(localStorage).filter(clave => clave.startsWith(PREFIJO));
    if (claves.length <= MAXIMO_RECUERDOS) {
      return;
    }
    const porFecha = claves
      .map(clave => {
        let actualizado = 0;
        try {
          actualizado = JSON.parse(localStorage.getItem(clave) || '{}').actualizado ?? 0;
        } catch {
          /* si no se puede leer, que sea el primero en caer */
        }
        return { clave, actualizado };
      })
      .sort((a, b) => a.actualizado - b.actualizado);

    porFecha.slice(0, claves.length - MAXIMO_RECUERDOS)
      .forEach(({ clave }) => localStorage.removeItem(clave));
  }
}
