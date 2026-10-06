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

/** Las figuras que se dibujan con la herramienta de formas. */
export type Figura = 'rectangulo' | 'elipse' | 'linea' | 'flecha';

/** Un punto en proporciones de 0 a 1 sobre la página sin el giro del visor. */
export type Punto = [number, number];

interface AnotacionBase {
  id: string;
  pagina: number;
  /** Las mismas tintas que el texto escrito: negro, azul o rojo. */
  color: ColorTexto;
}

/** Una nota adhesiva: un icono en un punto y su texto, que sale al pulsarlo. */
export interface Nota extends AnotacionBase {
  tipo: 'nota';
  x: number;
  y: number;
  texto: string;
}

/** Dibujo a mano alzada: uno o varios trazos, ya simplificados. */
export interface Trazo extends AnotacionBase {
  tipo: 'trazo';
  trazos: Punto[][];
  /** Grosor en puntos PDF. */
  grosor: number;
}

export interface Forma extends AnotacionBase {
  tipo: 'forma';
  figura: Figura;
  desde: Punto;
  hasta: Punto;
  grosor: number;
}

/** Un sello de texto con su marco («Aprobado», «Recibido»…). */
export interface Sello extends AnotacionBase {
  tipo: 'sello';
  rect: Rect;
  texto: string;
  /**
   * Giro del visor con el que se puso, como en los textos: el sello se ve
   * derecho en la página tal y como se estaba leyendo. Sin él (borradores de
   * antes), derecho respecto a la página sin girar.
   */
  rotacion?: number;
}

/** Una imagen estampada: la firma dibujada o una foto de ella. */
export interface Imagen extends AnotacionBase {
  tipo: 'imagen';
  rect: Rect;
  /** PNG o JPEG como `data:`, ya reducido. */
  datos: string;
  /** Como en `Sello`. */
  rotacion?: number;
}

export type Anotacion = Nota | Trazo | Forma | Sello | Imagen;

/** Lo que se puede crear: todo menos el identificador, que lo pone `Cambios`. */
export type AnotacionNueva = Omit<Nota, 'id'> | Omit<Trazo, 'id'> | Omit<Forma, 'id'>
  | Omit<Sello, 'id'> | Omit<Imagen, 'id'>;

/** Lo que se puede cambiar de una anotación ya puesta: moverla, su texto, su tinta… */
export interface CambioDeAnotacion {
  color?: ColorTexto;
  x?: number;
  y?: number;
  texto?: string;
  rect?: Rect;
  desde?: Punto;
  hasta?: Punto;
}

/** Una anotación que ya traía el PDF, por su id de pdf.js («12R») y su página. */
export interface Existente {
  id: string;
  pagina: number;
}

/** Lo que se guarda en el navegador entre visitas. */
export interface Borrador {
  marcas: Marca[];
  textos?: Texto[];
  campos?: [string, string][];
  rotaciones: [number, number][];
  eliminadas: number[];
  anotaciones?: Anotacion[];
  borradas?: Existente[];
}

/**
 * Cómo estaba todo antes de un paso. Copias superficiales: las listas son
 * nuevas, pero los objetos de dentro se comparten, y por eso **ningún cambio
 * modifica un objeto que ya esté en una lista**: lo sustituye por otro. Si no,
 * deshacer devolvería el objeto ya cambiado.
 */
interface Estado {
  marcas: Marca[];
  textos: Texto[];
  campos: Map<string, string>;
  rotaciones: Map<number, number>;
  eliminadas: Set<number>;
  anotaciones: Anotacion[];
  borradas: Map<string, Existente>;
}

/**
 * Cuántos pasos se pueden deshacer. Con «datos personales», un paso puede
 * llevar miles de marcas y cada instantánea copia la lista entera: sin tope,
 * una tarde de trabajo serían cientos de megas.
 */
const MAXIMO_PASOS = 100;

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
  /** Notas, dibujos, formas, sellos e imágenes. */
  anotaciones: Anotacion[] = [];
  /** Anotaciones que ya traía el PDF y se quitarán al guardar, por id. */
  borradas = new Map<string, Existente>();

  private pila: Estado[] = [];
  private rehechos: Estado[] = [];
  private secuencia = 0;

  get hayAlgo(): boolean {
    return this.marcas.length > 0 || this.textos.length > 0 || this.campos.size > 0
      || this.rotaciones.size > 0 || this.eliminadas.size > 0
      || this.anotaciones.length > 0 || this.borradas.size > 0;
  }

  get sePuedeDeshacer(): boolean {
    return this.pila.length > 0;
  }

  get sePuedeRehacer(): boolean {
    return this.rehechos.length > 0;
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
    this.registrar();
    const fuera = new Set(sustituye);
    this.marcas = this.marcas.filter(m => !fuera.has(m.id));
    const nueva: Marca = { ...marca, id: `m${++this.secuencia}` };
    this.marcas.push(nueva);
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
    this.registrar();
    const puestas = nuevas.map(marca => ({ ...marca, id: `m${++this.secuencia}` }));
    this.marcas.push(...puestas);
    return puestas;
  }

  cambiarColor(id: string, color: ColorSubrayado | ColorTachado): void {
    const indice = this.marcas.findIndex(m => m.id === id);
    if (indice < 0 || this.marcas[indice].color === color) {
      return;
    }
    this.registrar();
    this.marcas[indice] = { ...this.marcas[indice], color };
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
    this.registrar();
    this.marcas.splice(indice, 1);
  }

  /** Escribe un texto nuevo y lo devuelve ya con su identificador. */
  escribir(texto: Omit<Texto, 'id'>): Texto {
    this.registrar();
    const nuevo: Texto = { ...texto, id: `t${++this.secuencia}` };
    this.textos.push(nuevo);
    return nuevo;
  }

  /**
   * Cambia el contenido o el estilo de un texto.
   *
   * Devuelve si ha cambiado algo: escribir lo mismo que ya había no debe
   * gastar un paso de deshacer.
   */
  editarTexto(id: string, cambio: EstiloTexto): boolean {
    const indice = this.textos.findIndex(t => t.id === id);
    if (indice < 0) {
      return false;
    }
    const texto = this.textos[indice];
    const claves = (Object.keys(cambio) as (keyof EstiloTexto)[])
      .filter(clave => cambio[clave] !== undefined && cambio[clave] !== texto[clave]);
    if (!claves.length) {
      return false;
    }
    this.registrar();
    this.textos[indice] = { ...texto, ...Object.fromEntries(claves.map(c => [c, cambio[c]])) };
    return true;
  }

  moverTexto(id: string, x: number, y: number): boolean {
    const indice = this.textos.findIndex(t => t.id === id);
    const texto = this.textos[indice];
    if (!texto || (texto.x === x && texto.y === y)) {
      return false;
    }
    this.registrar();
    this.textos[indice] = { ...texto, x, y };
    return true;
  }

  quitarTexto(id: string): void {
    const indice = this.textos.findIndex(t => t.id === id);
    if (indice < 0) {
      return;
    }
    this.registrar();
    this.textos.splice(indice, 1);
  }

  /** Una nota, un dibujo, una forma, un sello o una imagen nuevos. */
  anotar(nueva: AnotacionNueva): Anotacion {
    this.registrar();
    const anotacion = { ...nueva, id: `a${++this.secuencia}` } as Anotacion;
    this.anotaciones.push(anotacion);
    return anotacion;
  }

  /**
   * Cambia una anotación (moverla, su texto, su color…). Devuelve si ha
   * cambiado algo, para no gastar un paso de deshacer en balde.
   */
  cambiarAnotacion(id: string, cambio: CambioDeAnotacion): boolean {
    const indice = this.anotaciones.findIndex(a => a.id === id);
    if (indice < 0) {
      return false;
    }
    const actual = this.anotaciones[indice] as unknown as Record<string, unknown>;
    const distinto = Object.entries(cambio).some(([clave, valor]) =>
      valor !== undefined && JSON.stringify(valor) !== JSON.stringify(actual[clave]));
    if (!distinto) {
      return false;
    }
    this.registrar();
    this.anotaciones[indice] = { ...this.anotaciones[indice], ...cambio } as Anotacion;
    return true;
  }

  quitarAnotacion(id: string): void {
    const indice = this.anotaciones.findIndex(a => a.id === id);
    if (indice < 0) {
      return;
    }
    this.registrar();
    this.anotaciones.splice(indice, 1);
  }

  /** Marca para quitar al guardar una anotación que ya traía el PDF. */
  borrarExistente(existente: Existente): void {
    if (this.borradas.has(existente.id)) {
      return;
    }
    this.registrar();
    this.borradas.set(existente.id, existente);
  }

  recuperarExistente(id: string): void {
    if (!this.borradas.has(id)) {
      return;
    }
    this.registrar();
    this.borradas.delete(id);
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
    this.registrar();
    if (ahora === undefined) {
      this.campos.delete(nombre);
    } else {
      this.campos.set(nombre, ahora);
    }
    return true;
  }

  /** Lo escrito en un campo, o lo que traía el archivo si no se ha tocado. */
  valorDeCampo(nombre: string, original: string): string {
    return this.campos.get(nombre) ?? original;
  }

  girar(pagina: number, grados = 90): void {
    const antes = this.rotaciones.get(pagina) ?? 0;
    this.registrar();
    this.fijarRotacion(pagina, (antes + grados) % 360);
  }

  rotacionDe(pagina: number): number {
    return this.rotaciones.get(pagina) ?? 0;
  }

  eliminar(pagina: number): void {
    if (this.eliminadas.has(pagina)) {
      return;
    }
    this.registrar();
    this.eliminadas.add(pagina);
  }

  restaurar(pagina: number): void {
    if (!this.eliminadas.has(pagina)) {
      return;
    }
    this.registrar();
    this.eliminadas.delete(pagina);
  }

  deshacer(): void {
    const antes = this.pila.pop();
    if (antes) {
      this.rehechos.push(this.foto());
      this.poner(antes);
    }
  }

  rehacer(): void {
    const despues = this.rehechos.pop();
    if (despues) {
      this.pila.push(this.foto());
      this.poner(despues);
    }
  }

  /**
   * Antes de cada cambio: guarda cómo estaba todo, y lo deshecho ya no se puede
   * rehacer, como en cualquier editor.
   */
  private registrar(): void {
    this.pila.push(this.foto());
    if (this.pila.length > MAXIMO_PASOS) {
      this.pila.shift();
    }
    this.rehechos = [];
  }

  private foto(): Estado {
    return {
      marcas: [...this.marcas],
      textos: [...this.textos],
      campos: new Map(this.campos),
      rotaciones: new Map(this.rotaciones),
      eliminadas: new Set(this.eliminadas),
      anotaciones: [...this.anotaciones],
      borradas: new Map(this.borradas),
    };
  }

  private poner(estado: Estado): void {
    Object.assign(this, estado);
  }

  // --- persistencia y envío ---------------------------------------------

  aBorrador(): Borrador {
    return {
      marcas: this.marcas,
      textos: this.textos,
      campos: [...this.campos],
      rotaciones: [...this.rotaciones],
      eliminadas: [...this.eliminadas],
      anotaciones: this.anotaciones,
      borradas: [...this.borradas.values()],
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
    cambios.anotaciones = borrador.anotaciones ?? [];
    cambios.borradas = new Map((borrador.borradas ?? []).map(b => [b.id, b]));
    // Los identificadores siguen donde los dejó la sesión anterior, y el
    // contador va por delante de todos los tipos, que lo comparten.
    cambios.secuencia = [...cambios.marcas, ...cambios.textos, ...cambios.anotaciones].reduce(
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

    const vivas = this.anotaciones.filter(a => !this.eliminadas.has(a.pagina));
    const deClase = <T extends Anotacion['tipo']>(tipo: T) =>
      vivas.filter(a => a.tipo === tipo).map(({ id, tipo: _, ...resto }) => resto);

    return {
      subrayados: deTipo('subrayado'), tachados: deTipo('tachado'), textos, campos, paginas,
      notas: deClase('nota').filter(nota => (nota as { texto: string }).texto.trim()),
      trazos: deClase('trazo'),
      formas: deClase('forma'),
      sellos: deClase('sello'),
      imagenes: deClase('imagen'),
      anotaciones_borradas: [...this.borradas.values()]
        .filter(b => !this.eliminadas.has(b.pagina)),
    };
  }

  private fijarRotacion(pagina: number, grados: number): void {
    if (grados % 360 === 0) {
      this.rotaciones.delete(pagina);
    } else {
      this.rotaciones.set(pagina, ((grados % 360) + 360) % 360);
    }
  }

}
