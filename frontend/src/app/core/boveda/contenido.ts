/**
 * Lo que hay dentro de la bóveda, ya descifrado, y cómo se cambia.
 *
 * Ningún cambio modifica la lista que recibe: devuelve otra, como `cambios.ts`
 * del visor. El servicio relee, cambia y vuelve a cifrar en cada operación, y
 * así el contenido de antes sigue intacto si algo falla a mitad.
 */

export interface CertificadoGuardado {
  id: string;
  /** El que le pone la persona; de serie, el titular. */
  nombre: string;
  /** Lo que dice el certificado, comprobado al guardarlo. */
  titular: string;
  emisor: string;
  /** Caducidad en ISO, o vacío si no se supo. */
  hasta: string;
  /** El `.p12` en base64, como lo manda «Firmar con certificado». */
  p12: string;
  /** Sólo si se pidió recordarla. */
  contrasena?: string;
  anadido: string;
}

export interface FirmaGuardada {
  id: string;
  nombre: string;
  /** Tipo de la imagen (`image/png`…) y la imagen en base64. */
  tipo: string;
  imagen: string;
  anadida: string;
}

export interface ContenidoBoveda {
  certificados: CertificadoGuardado[];
  firmas: FirmaGuardada[];
}

export const BOVEDA_VACIA: ContenidoBoveda = { certificados: [], firmas: [] };

export function anadirCertificado(contenido: ContenidoBoveda, certificado: CertificadoGuardado): ContenidoBoveda {
  return { ...contenido, certificados: [...contenido.certificados, certificado] };
}

export function anadirFirma(contenido: ContenidoBoveda, firma: FirmaGuardada): ContenidoBoveda {
  return { ...contenido, firmas: [...contenido.firmas, firma] };
}

/** Quita lo que tenga ese id, sea certificado o firma. */
export function quitar(contenido: ContenidoBoveda, id: string): ContenidoBoveda {
  return {
    certificados: contenido.certificados.filter(c => c.id !== id),
    firmas: contenido.firmas.filter(f => f.id !== id),
  };
}

/** Cambia el nombre de lo que tenga ese id; vacío no se admite y deja el que había. */
export function renombrar(contenido: ContenidoBoveda, id: string, nombre: string): ContenidoBoveda {
  const limpio = nombre.trim();
  if (!limpio) {
    return contenido;
  }
  return {
    certificados: contenido.certificados.map(c => (c.id === id ? { ...c, nombre: limpio } : c)),
    firmas: contenido.firmas.map(f => (f.id === id ? { ...f, nombre: limpio } : f)),
  };
}

/** Lo descifrado, tolerando lo que falte: una bóveda vieja o a medias se abre igual. */
export function leerContenido(valor: unknown): ContenidoBoveda {
  const objeto = (valor ?? {}) as Partial<Record<keyof ContenidoBoveda, unknown>>;
  const lista = <T>(cosa: unknown, valido: (x: Partial<T>) => boolean): T[] =>
    Array.isArray(cosa) ? (cosa as Partial<T>[]).filter(x => x && typeof x === 'object' && valido(x)) as T[] : [];
  return {
    certificados: lista<CertificadoGuardado>(objeto.certificados,
      c => typeof c.id === 'string' && typeof c.nombre === 'string' && typeof c.p12 === 'string'),
    firmas: lista<FirmaGuardada>(objeto.firmas,
      f => typeof f.id === 'string' && typeof f.nombre === 'string' && typeof f.imagen === 'string'
        && typeof f.tipo === 'string'),
  };
}
