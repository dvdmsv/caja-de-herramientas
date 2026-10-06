/**
 * Los enlaces que trae el PDF: a dónde lleva cada uno.
 *
 * pdf.js da las anotaciones `Link` tal cual vienen en el archivo, y un destino
 * puede ser una dirección web, una página con su posición (`XYZ`, `FitH`…), un
 * nombre que hay que resolver o una acción como «página siguiente». Aquí está
 * lo que se puede decidir sin pdf.js ni DOM; `DocumentoPdf.enlaces` hace la
 * parte que necesita el documento.
 */

/** A qué sitio del documento lleva un enlace o una entrada del índice. */
export interface DestinoPdf {
  pagina: number;
  /** Proporción desde arriba (0–1) sobre la página tal y como está en el archivo, si la da. */
  y: number | null;
}

/** Un enlace de la página, con su rectángulo en proporciones (como los campos). */
export interface EnlacePdf {
  rect: [number, number, number, number];
  /** Fuera del documento, ya comprobada. */
  url?: string;
  destino?: DestinoPdf;
}

/**
 * El punto de un destino explícito (`[página, /XYZ, izquierda, arriba, zoom]`),
 * en espacio PDF, o `null` en lo que no fije.
 *
 * Sólo interesa la altura: el visor se desplaza en vertical, y el zoom del
 * enlace no se aplica, porque cambiar el zoom de quien lee al pulsar un enlace
 * es más molesto que útil.
 */
export function alturaDeDestino(explicito: unknown[]): number | null {
  const tipo = (explicito[1] as { name?: string })?.name;
  const numero = (i: number) => (typeof explicito[i] === 'number' ? explicito[i] as number : null);
  switch (tipo) {
    case 'XYZ':
      return numero(3);
    case 'FitH':
    case 'FitBH':
      return numero(2);
    case 'FitR':
      // [página, /FitR, izquierda, abajo, derecha, arriba]
      return numero(5);
    default:
      return null;     // Fit, FitB, FitV… la página entera
  }
}

/** Las acciones con nombre que tienen sentido en un visor. */
export function destinoDeAccion(accion: string, actual: number, total: number): number | null {
  switch (accion) {
    case 'NextPage':
      return Math.min(actual + 1, total);
    case 'PrevPage':
      return Math.max(actual - 1, 1);
    case 'FirstPage':
      return 1;
    case 'LastPage':
      return total;
    default:
      return null;
  }
}

/**
 * Si se puede abrir una dirección que trae el PDF.
 *
 * Sólo web y correo: un PDF puede llevar enlaces a `javascript:`, a `file:` o al
 * esquema de cualquier programa, y abrir eso por un clic en un documento ajeno
 * no es buena idea. En la aplicación de Windows `ventanas.rs` aplica la misma
 * regla, por si algo se colara por aquí.
 */
export function urlAbrible(url: unknown): string | null {
  if (typeof url !== 'string') {
    return null;
  }
  try {
    const leida = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(leida.protocol) ? leida.href : null;
  } catch {
    return null;
  }
}
