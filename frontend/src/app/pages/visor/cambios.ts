import { Rect, seSolapan } from './coordenadas';
import { ColorTexto, Fuente } from './tipografia';

/**
 * Todo lo que el usuario le ha hecho al documento sin haberlo guardado aún.
 *
 * Vive aquí, sin tocar el DOM ni el servidor, por dos razones: se puede probar
 * a solas, y en una sesión larga es lo único que hay que conservar para que un
 * refresco accidental no se lleve por delante una hora de subrayados.
 */

export type ColorSubrayado = 'amarillo' | 'verde' | 'azul' | 'rosa';
export type ColorTachado = 'negro' | 'blanco';

export interface Marca {
  id: string;
  tipo: 'subrayado' | 'tachado';
  pagina: number;
  color: ColorSubrayado | ColorTachado;
  rects: Rect[];
  /** El texto marcado, para poder listarlo en el panel lateral. */
  texto: string;
}

/**
 * Un texto escrito encima de la página.
 *
 * No son rectángulos como las marcas, sino un punto y un contenido, así que va
 * aparte. El punto es el **inicio de la línea base** de la primera línea: es lo
 * único que el navegador y PyMuPDF colocan exactamente igual, porque el alto de
 * una caja de texto depende de métricas que no coinciden entre Arial y
 * Helvetica.
 */
export interface Texto {
  id: string;
  pagina: number;
  /** Proporciones de 0 a 1 sobre la página sin el giro del visor. */
  x: number;
  y: number;
  /** Giro del visor con el que se escribió: el texto gira con la página. */
  rotacion: number;
  /** Con saltos de línea si tiene varias. */
  texto: string;
  fuente: Fuente;
  /** Cuerpo en puntos PDF, que es como piensa el usuario y como lo quiere el PDF. */
  tamano: number;
  color: ColorTexto;
  negrita: boolean;
  cursiva: boolean;
}

/** Lo que se puede cambiar de un texto ya escrito. */
export type EstiloTexto = Partial<Pick<Texto, 'texto' | 'fuente' | 'tamano' | 'color'
  | 'negrita' | 'cursiva'>>;

/** Lo que se guarda en el navegador entre visitas. */
export interface Borrador {
  marcas: Marca[];
  textos?: Texto[];
  campos?: [string, string][];
  rotaciones: [number, number][];
  eliminadas: number[];
}

type Deshacer = () => void;

export class Cambios {
  marcas: Marca[] = [];
  textos: Texto[] = [];
  /**
   * Lo escrito en los campos que ya traía el formulario, por nombre.
   *
   * Va por nombre y no por página porque un campo es del documento: el mismo
   * puede tener recuadros en varias hojas.
   */
  campos = new Map<string, string>();
  /** Giro que el usuario ha dado a cada página, en grados y sentido horario. */
  rotaciones = new Map<number, number>();
  eliminadas = new Set<number>();

  private pila: Deshacer[] = [];
  private secuencia = 0;

  get hayAlgo(): boolean {
    return this.marcas.length > 0 || this.textos.length > 0 || this.campos.size > 0
      || this.rotaciones.size > 0 || this.eliminadas.size > 0;
  }

  get sePuedeDeshacer(): boolean {
    return this.pila.length > 0;
  }

  // --- acciones ---------------------------------------------------------

  /**
   * Añade una marca, sustituyendo a las que se le indiquen.
   *
   * Sustituir es quitar y poner, pero cuenta como **un solo paso** para
   * deshacer: si no, `Ctrl+Z` dejaría el documento en un estado intermedio
   * —sin la vieja y sin la nueva— que el usuario no ha visto nunca.
   */
  marcar(marca: Omit<Marca, 'id'>, sustituye: string[] = []): Marca {
    const quitadas = sustituye
      .map(id => this.marcas.findIndex(m => m.id === id))
      .filter(indice => indice >= 0)
      .sort((a, b) => b - a) // de atrás hacia delante, para que no se descuadren
      .map(indice => ({ indice, marca: this.marcas[indice] }));
    quitadas.forEach(({ indice }) => this.marcas.splice(indice, 1));

    const nueva: Marca = { ...marca, id: `m${++this.secuencia}` };
    this.marcas.push(nueva);
    this.pila.push(() => {
      this.quitarSinRegistrar(nueva.id);
      [...quitadas].reverse().forEach(({ indice, marca: vieja }) =>
        this.marcas.splice(indice, 0, vieja));
    });
    return nueva;
  }

  /**
   * Añade muchas marcas de una vez, como **un solo paso** para deshacer.
   *
   * Es lo que necesita «buscar y tachar todo»: si cada coincidencia fuese su
   * propio paso, arrepentirse de haber tachado cincuenta DNI costaría cincuenta
   * `Ctrl+Z`, y por el camino se verían estados que nadie ha pedido.
   *
   * No sustituye a nada: lo que ya estuviera marcado se queda. Marcar dos veces
   * la misma zona no hace daño —el tachado se aplica una vez— y quitar aquí lo
   * que el usuario había puesto a mano sería peor.
   */
  marcarVarias(nuevas: Omit<Marca, 'id'>[]): Marca[] {
    if (nuevas.length === 0) {
      return [];
    }
    const puestas = nuevas.map(marca => {
      const completa: Marca = { ...marca, id: `m${++this.secuencia}` };
      this.marcas.push(completa);
      return completa;
    });
    this.pila.push(() => puestas.forEach(marca => this.quitarSinRegistrar(marca.id)));
    return puestas;
  }

  cambiarColor(id: string, color: ColorSubrayado | ColorTachado): void {
    const marca = this.marcas.find(m => m.id === id);
    if (!marca || marca.color === color) {
      return;
    }
    const antes = marca.color;
    marca.color = color;
    this.pila.push(() => {
      const actual = this.marcas.find(m => m.id === id);
      if (actual) {
        actual.color = antes;
      }
    });
  }

  /** Marcas del mismo tipo que pisan la zona indicada, en una página. */
  solapadas(pagina: number, tipo: Marca['tipo'], rects: Rect[]): string[] {
    return this.marcas
      .filter(marca => marca.pagina === pagina && marca.tipo === tipo
        && marca.rects.some(suyo => rects.some(nuevo => seSolapan(suyo, nuevo))))
      .map(marca => marca.id);
  }

  quitarMarca(id: string): void {
    const indice = this.marcas.findIndex(m => m.id === id);
    if (indice < 0) {
      return;
    }
    const [quitada] = this.marcas.splice(indice, 1);
    this.pila.push(() => this.marcas.splice(indice, 0, quitada));
  }

  /** Escribe un texto nuevo y lo devuelve ya con su identificador. */
  escribir(texto: Omit<Texto, 'id'>): Texto {
    const nuevo: Texto = { ...texto, id: `t${++this.secuencia}` };
    this.textos.push(nuevo);
    this.pila.push(() => this.quitarTextoSinRegistrar(nuevo.id));
    return nuevo;
  }

  /**
   * Cambia el contenido o el estilo de un texto.
   *
   * Devuelve si ha cambiado algo: escribir lo mismo que ya había no debe
   * gastar un paso de deshacer.
   */
  editarTexto(id: string, cambio: EstiloTexto): boolean {
    const texto = this.textos.find(t => t.id === id);
    if (!texto) {
      return false;
    }
    const claves = (Object.keys(cambio) as (keyof EstiloTexto)[])
      .filter(clave => cambio[clave] !== undefined && cambio[clave] !== texto[clave]);
    if (!claves.length) {
      return false;
    }

    const antes: EstiloTexto = {};
    claves.forEach(clave => {
      Object.assign(antes, { [clave]: texto[clave] });
      Object.assign(texto, { [clave]: cambio[clave] });
    });
    this.pila.push(() => {
      const actual = this.textos.find(t => t.id === id);
      if (actual) {
        Object.assign(actual, antes);
      }
    });
    return true;
  }

  moverTexto(id: string, x: number, y: number): boolean {
    const texto = this.textos.find(t => t.id === id);
    if (!texto || (texto.x === x && texto.y === y)) {
      return false;
    }
    const antes = { x: texto.x, y: texto.y };
    texto.x = x;
    texto.y = y;
    this.pila.push(() => {
      const actual = this.textos.find(t => t.id === id);
      if (actual) {
        Object.assign(actual, antes);
      }
    });
    return true;
  }

  quitarTexto(id: string): void {
    const indice = this.textos.findIndex(t => t.id === id);
    if (indice < 0) {
      return;
    }
    const [quitado] = this.textos.splice(indice, 1);
    this.pila.push(() => this.textos.splice(indice, 0, quitado));
  }

  /**
   * Escribe en un campo del formulario.
   *
   * Si el valor vuelve a ser el que traía el archivo se borra la entrada en vez
   * de guardarla: un campo devuelto a su sitio no es un cambio pendiente, y el
   * botón de guardar no debe encenderse por nada.
   *
   * Devuelve si ha cambiado algo, para no gastar un paso de deshacer en balde.
   */
  rellenar(nombre: string, valor: string, original: string): boolean {
    const antes = this.campos.get(nombre);
    const ahora = valor === original ? undefined : valor;
    if (antes === ahora) {
      return false;
    }

    if (ahora === undefined) {
      this.campos.delete(nombre);
    } else {
      this.campos.set(nombre, ahora);
    }
    this.pila.push(() => {
      if (antes === undefined) {
        this.campos.delete(nombre);
      } else {
        this.campos.set(nombre, antes);
      }
    });
    return true;
  }

  /** Lo escrito en un campo, o lo que traía el archivo si no se ha tocado. */
  valorDeCampo(nombre: string, original: string): string {
    return this.campos.get(nombre) ?? original;
  }

  girar(pagina: number, grados = 90): void {
    const antes = this.rotaciones.get(pagina) ?? 0;
    this.fijarRotacion(pagina, (antes + grados) % 360);
    this.pila.push(() => this.fijarRotacion(pagina, antes));
  }

  rotacionDe(pagina: number): number {
    return this.rotaciones.get(pagina) ?? 0;
  }

  eliminar(pagina: number): void {
    if (this.eliminadas.has(pagina)) {
      return;
    }
    this.eliminadas.add(pagina);
    this.pila.push(() => this.eliminadas.delete(pagina));
  }

  restaurar(pagina: number): void {
    if (!this.eliminadas.delete(pagina)) {
      return;
    }
    this.pila.push(() => this.eliminadas.add(pagina));
  }

  deshacer(): void {
    this.pila.pop()?.();
  }

  // --- persistencia y envío ---------------------------------------------

  aBorrador(): Borrador {
    return {
      marcas: this.marcas,
      textos: this.textos,
      campos: [...this.campos],
      rotaciones: [...this.rotaciones],
      eliminadas: [...this.eliminadas],
    };
  }

  static desdeBorrador(borrador: Borrador): Cambios {
    const cambios = new Cambios();
    cambios.marcas = borrador.marcas ?? [];
    // Un borrador guardado antes de que existieran los textos no los trae.
    cambios.textos = borrador.textos ?? [];
    cambios.campos = new Map(borrador.campos ?? []);
    cambios.rotaciones = new Map(borrador.rotaciones ?? []);
    cambios.eliminadas = new Set(borrador.eliminadas ?? []);
    // Los identificadores siguen donde los dejó la sesión anterior, y el
    // contador va por delante de los dos tipos: marcas y textos lo comparten.
    cambios.secuencia = [...cambios.marcas, ...cambios.textos].reduce(
      (mayor, uno) => Math.max(mayor, Number(uno.id.slice(1)) || 0), 0);
    return cambios;
  }

  /**
   * Lo que se le manda al servidor.
   *
   * Las marcas van con el número de página original, porque el servidor las
   * aplica antes de borrar nada: si se enviaran renumeradas, acabarían en la
   * página equivocada.
   */
  aPeticion(totalPaginas: number): Record<string, unknown> {
    const deTipo = (tipo: Marca['tipo']) =>
      this.marcas
        .filter(marca => marca.tipo === tipo && !this.eliminadas.has(marca.pagina))
        .map(marca => ({ pagina: marca.pagina, color: marca.color, rects: marca.rects }));

    const paginas = [];
    for (let numero = 1; numero <= totalPaginas; numero++) {
      if (!this.eliminadas.has(numero)) {
        paginas.push({ numero, rotacion: this.rotacionDe(numero) });
      }
    }
    const textos = this.textos
      .filter(texto => texto.texto.trim() && !this.eliminadas.has(texto.pagina))
      .map(({ id, ...resto }) => resto);

    const campos = [...this.campos].map(([nombre, valor]) => ({ nombre, valor }));

    return {
      subrayados: deTipo('subrayado'), tachados: deTipo('tachado'), textos, campos, paginas,
    };
  }

  private fijarRotacion(pagina: number, grados: number): void {
    if (grados % 360 === 0) {
      this.rotaciones.delete(pagina);
    } else {
      this.rotaciones.set(pagina, ((grados % 360) + 360) % 360);
    }
  }

  private quitarTextoSinRegistrar(id: string): void {
    const indice = this.textos.findIndex(t => t.id === id);
    if (indice >= 0) {
      this.textos.splice(indice, 1);
    }
  }

  private quitarSinRegistrar(id: string): void {
    const indice = this.marcas.findIndex(m => m.id === id);
    if (indice >= 0) {
      this.marcas.splice(indice, 1);
    }
  }
}
