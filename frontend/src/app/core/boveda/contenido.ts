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

/** Lo que se escribe en la ficha de un secreto. */
export interface DatosSecreto {
  nombre: string;
  /** La contraseña, el PIN, la clave de API o lo que sea. Tal cual, sin recortar. */
  secreto: string;
  usuario?: string;
  web?: string;
  /** Pueden llevar códigos de recuperación: se ocultan igual que el secreto. */
  notas?: string;
}

export interface SecretoGuardado extends DatosSecreto {
  id: string;
  anadido: string;
  cambiado: string;
}

export interface ContenidoBoveda {
  certificados: CertificadoGuardado[];
  firmas: FirmaGuardada[];
  secretos: SecretoGuardado[];
}

export const BOVEDA_VACIA: ContenidoBoveda = { certificados: [], firmas: [], secretos: [] };

export function anadirCertificado(contenido: ContenidoBoveda, certificado: CertificadoGuardado): ContenidoBoveda {
  return { ...contenido, certificados: [...contenido.certificados, certificado] };
}

export function anadirFirma(contenido: ContenidoBoveda, firma: FirmaGuardada): ContenidoBoveda {
  return { ...contenido, firmas: [...contenido.firmas, firma] };
}

export function anadirSecreto(contenido: ContenidoBoveda, secreto: SecretoGuardado): ContenidoBoveda {
  return { ...contenido, secretos: [...contenido.secretos, secreto] };
}

/** Lo que diga la ficha sustituye a lo que había: un campo vaciado desaparece. */
export function cambiarSecreto(contenido: ContenidoBoveda, id: string, datos: DatosSecreto, cuando: string): ContenidoBoveda {
  return {
    ...contenido,
    secretos: contenido.secretos.map(s => (s.id === id ? { id, anadido: s.anadido, cambiado: cuando, ...limpiarDatos(datos) } : s)),
  };
}

/**
 * Sin los campos vacíos y sin espacios de sobra en lo que no es secreto. El secreto
 * y las notas se dejan como estén: un espacio puede ser parte de la contraseña.
 */
export function limpiarDatos(datos: DatosSecreto): DatosSecreto {
  const limpios: DatosSecreto = { nombre: datos.nombre.trim(), secreto: datos.secreto };
  const usuario = datos.usuario?.trim();
  const web = datos.web?.trim();
  if (usuario) {
    limpios.usuario = usuario;
  }
  if (web) {
    limpios.web = web;
  }
  if (datos.notas?.trim()) {
    limpios.notas = datos.notas;
  }
  return limpios;
}

/** Lo mínimo de una ficha: nombre y secreto. */
export function fichaCompleta(datos: DatosSecreto): boolean {
  return !!datos.nombre.trim() && !!datos.secreto;
}

/**
 * Los que casan con lo buscado, en orden alfabético. Sólo por nombre, usuario y
 * web: **nunca por el secreto ni por las notas**, o el buscador serviría para ir
 * adivinándolos letra a letra.
 */
export function filtrarSecretos(lista: SecretoGuardado[], texto: string): SecretoGuardado[] {
  const buscado = sinTildes(texto.trim());
  return lista
    .filter(s => !buscado || [s.nombre, s.usuario ?? '', s.web ?? ''].some(campo => sinTildes(campo).includes(buscado)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * La dirección para enlazar la web de una ficha, o `null` si no se debe. Sólo
 * `http` y `https`: lo que se escribe aquí acaba en un `href`, y un `javascript:`
 * no puede ser un enlace. `ejemplo.com` y `ejemplo.com:8080` son https.
 */
export function enlaceDe(web: string | undefined): string | null {
  const limpia = web?.trim();
  if (!limpia) {
    return null;
  }
  const conEsquema = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(limpia) ? limpia : `https://${limpia}`;
  try {
    const url = new URL(conEsquema);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** Quita lo que tenga ese id, sea certificado, firma o secreto. */
export function quitar(contenido: ContenidoBoveda, id: string): ContenidoBoveda {
  return {
    ...contenido,
    certificados: contenido.certificados.filter(c => c.id !== id),
    firmas: contenido.firmas.filter(f => f.id !== id),
    secretos: contenido.secretos.filter(s => s.id !== id),
  };
}

/** Cambia el nombre de lo que tenga ese id; vacío no se admite y deja el que había. */
export function renombrar(contenido: ContenidoBoveda, id: string, nombre: string): ContenidoBoveda {
  const limpio = nombre.trim();
  if (!limpio) {
    return contenido;
  }
  return {
    ...contenido,
    certificados: contenido.certificados.map(c => (c.id === id ? { ...c, nombre: limpio } : c)),
    firmas: contenido.firmas.map(f => (f.id === id ? { ...f, nombre: limpio } : f)),
  };
}

/**
 * Lo descifrado, tolerando lo que falte: una bóveda vieja o a medias se abre igual.
 *
 * **Lo que no se conoce se conserva.** Cada cambio reescribe lo que se leyó, así
 * que descartarlo aquí es borrarlo: fue lo que obligó a subir el formato para los
 * secretos. Con esto, lo que añada una versión futura sobrevive a pasar por ésta.
 */
export function leerContenido(valor: unknown): ContenidoBoveda {
  const objeto = (valor && typeof valor === 'object' ? valor : {}) as Partial<Record<keyof ContenidoBoveda, unknown>>;
  const lista = <T>(cosa: unknown, valido: (x: Partial<T>) => boolean): T[] =>
    Array.isArray(cosa) ? (cosa as Partial<T>[]).filter(x => x && typeof x === 'object' && valido(x)) as T[] : [];
  return {
    ...objeto,
    certificados: lista<CertificadoGuardado>(objeto.certificados,
      c => typeof c.id === 'string' && typeof c.nombre === 'string' && typeof c.p12 === 'string'),
    firmas: lista<FirmaGuardada>(objeto.firmas,
      f => typeof f.id === 'string' && typeof f.nombre === 'string' && typeof f.imagen === 'string'
        && typeof f.tipo === 'string'),
    secretos: lista<SecretoGuardado>(objeto.secretos,
      s => typeof s.id === 'string' && typeof s.nombre === 'string' && typeof s.secreto === 'string'),
  };
}
