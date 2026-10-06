/**
 * Búsqueda de texto en todo el documento.
 *
 * El índice se construye en segundo plano según se lee, para que abrir un
 * documento largo no se quede esperando a extraer el texto de trescientas
 * páginas.
 */

/** Un fragmento de texto de pdf.js, con su sitio dentro del texto de la página. */
interface Fragmento {
  indice: number;
  inicio: number;
  fin: number;
}

export interface Coincidencia {
  pagina: number;
  inicio: number;
  fin: number;
  /** Un trozo de alrededor, para enseñarlo en la lista de resultados. */
  contexto: string;
  /** Fragmentos de pdf.js que toca, para poder pintarla sobre la página. */
  fragmentos: number[];
  /**
   * Qué letras de cada fragmento son de la coincidencia. Sin esto se resaltaba
   * el fragmento entero, que en pdf.js suele ser la línea completa.
   */
  trozos: { indice: number; desde: number; hasta: number }[];
}

export interface OpcionesBusqueda {
  /** Que no encuentre «plazo» dentro de «plazos». */
  palabraEntera?: boolean;
  /** Que «Euro» no encuentre «euro». Las tildes siguen dando igual. */
  mayusculas?: boolean;
}

const CONTEXTO = 40;

/**
 * Deja el texto comparable: sin mayúsculas y sin tildes.
 *
 * Buscar "peticion" tiene que encontrar "petición": en documentos en español,
 * exigir la tilde es exigir que el usuario adivine cómo está escrito.
 * Importante: se hace carácter a carácter para que las posiciones del índice
 * sigan cuadrando con el texto original.
 */
export function normalizar(texto: string): string {
  return sinTildes(texto).toLowerCase();
}

/** Lo mismo sin pasar a minúsculas, para buscar distinguiéndolas. */
export function sinTildes(texto: string): string {
  return [...texto]
    .map(letra => letra.normalize('NFD').replace(/[̀-ͯ]/g, '') || letra)
    .map(letra => (letra.length === 1 ? letra : letra[0]))
    .join('');
}

const LETRA = /[\p{L}\p{N}_]/u;

export class IndiceTexto {
  private readonly paginas = new Map<number, {
    texto: string; normal: string; tildado: string; fragmentos: Fragmento[];
  }>();

  get indexadas(): number {
    return this.paginas.size;
  }

  tiene(pagina: number): boolean {
    return this.paginas.has(pagina);
  }

  /** Añade una página a partir de los fragmentos que devuelve pdf.js. */
  anadir(pagina: number, items: { str: string }[]): void {
    let texto = '';
    const fragmentos: Fragmento[] = [];

    items.forEach((item, indice) => {
      const inicio = texto.length;
      texto += item.str;
      fragmentos.push({ indice, inicio, fin: texto.length });
      // pdf.js no incluye los espacios entre fragmentos: sin esto, dos palabras
      // seguidas se pegarían y "del plazo" no se encontraría nunca.
      if (item.str && !item.str.endsWith(' ')) {
        texto += ' ';
      }
    });

    this.paginas.set(pagina, { texto, normal: normalizar(texto), tildado: sinTildes(texto), fragmentos });
  }

  buscar(consulta: string, opciones: OpcionesBusqueda = {}): Coincidencia[] {
    const aguja = opciones.mayusculas ? sinTildes(consulta.trim()) : normalizar(consulta.trim());
    if (aguja.length < 2) {
      return [];
    }

    const encontradas: Coincidencia[] = [];
    for (const pagina of [...this.paginas.keys()].sort((a, b) => a - b)) {
      const { texto, normal, tildado, fragmentos } = this.paginas.get(pagina)!;
      const pajar = opciones.mayusculas ? tildado : normal;
      let desde = 0;
      for (;;) {
        const inicio = pajar.indexOf(aguja, desde);
        if (inicio < 0) {
          break;
        }
        const fin = inicio + aguja.length;
        desde = inicio + 1;
        if (opciones.palabraEntera
            && (LETRA.test(pajar[inicio - 1] ?? '') || LETRA.test(pajar[fin] ?? ''))) {
          continue;
        }
        const tocados = fragmentos.filter(f => f.inicio < fin && f.fin > inicio);
        encontradas.push({
          pagina,
          inicio,
          fin,
          contexto: recortar(texto, inicio, fin),
          fragmentos: tocados.map(f => f.indice),
          trozos: tocados.map(f => ({
            indice: f.indice,
            desde: Math.max(inicio, f.inicio) - f.inicio,
            hasta: Math.min(fin, f.fin) - f.inicio,
          })),
        });
        desde = fin;
      }
    }
    return encontradas;
  }

  limpiar(): void {
    this.paginas.clear();
  }
}

function recortar(texto: string, inicio: number, fin: number): string {
  const desde = Math.max(0, inicio - CONTEXTO);
  const hasta = Math.min(texto.length, fin + CONTEXTO);
  return (desde > 0 ? '…' : '') + texto.slice(desde, hasta).trim() + (hasta < texto.length ? '…' : '');
}
