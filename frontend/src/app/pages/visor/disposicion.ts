/**
 * Dónde va cada página dentro del lienzo de lectura.
 *
 * Es lo que permite enseñar sólo lo visible: con las posiciones calculadas de
 * antemano, se sabe qué filas caen en pantalla sin tener que montar en el DOM
 * las trescientas páginas del documento. Todo se calcula a partir de las
 * medidas, sin tocar el DOM, así que se puede probar a solas.
 */

/** Medidas de una página a escala 1, con el giro que trae el propio archivo. */
export interface Medida {
  numero: number;
  ancho: number;
  alto: number;
}

export interface PaginaColocada {
  numero: number;
  izquierda: number;
  ancho: number;
  alto: number;
  rotacion: number;
}

export interface Fila {
  top: number;
  alto: number;
  paginas: PaginaColocada[];
}

export interface Disposicion {
  filas: Fila[];
  altoTotal: number;
  anchoTotal: number;
}

export interface OpcionesDisposicion {
  escala: number;
  columnas: number;
  anchoDisponible: number;
  separacion: number;
  rotaciones?: Map<number, number>;
  eliminadas?: Set<number>;
  /** En dos columnas, la primera página sola, como la portada de un libro. */
  portada?: boolean;
  /** Página a página: sólo se coloca ésta. */
  solo?: number;
}

/**
 * Cómo se leen las páginas: todas seguidas, de dos en dos (con o sin portada
 * sola) o de una en una, pasándolas como en un libro.
 */
export type ModoLectura = 'continuo' | 'dos' | 'libro' | 'pagina';

export const MODOS_LECTURA: ModoLectura[] = ['continuo', 'pagina', 'dos', 'libro'];

export function columnasDe(modo: ModoLectura): number {
  return modo === 'dos' || modo === 'libro' ? 2 : 1;
}

/**
 * Las páginas vivas agrupadas por filas: de `columnas` en `columnas`, y con
 * portada la primera va sola.
 */
export function agrupar<T>(vivas: T[], columnas: number, portada = false): T[][] {
  const grupos: T[][] = [];
  let i = 0;
  if (portada && columnas > 1 && vivas.length) {
    grupos.push([vivas[0]]);
    i = 1;
  }
  for (; i < vivas.length; i += columnas) {
    grupos.push(vivas.slice(i, i + columnas));
  }
  return grupos;
}

/**
 * La página a la que lleva «siguiente» o «anterior» (`paso` de +1 o -1): la
 * primera de la fila de al lado, contando las quitadas y la portada.
 */
export function paginaVecina(numeros: number[], eliminadas: Set<number>, actual: number,
                             paso: number, modo: ModoLectura): number {
  const vivas = numeros.filter(numero => !eliminadas.has(numero));
  const grupos = agrupar(vivas, columnasDe(modo), modo === 'libro');
  const i = grupos.findIndex(grupo => grupo.includes(actual));
  if (i < 0) {
    return vivas.find(numero => numero >= actual) ?? vivas.at(-1) ?? actual;
  }
  return grupos[Math.min(grupos.length - 1, Math.max(0, i + paso))][0];
}

/** Tamaño en pantalla de una página, contando el giro que le haya dado el usuario. */
export function dimensiones(medida: Medida, rotacion: number, escala: number) {
  const girada = Math.abs(rotacion % 180) === 90;
  return {
    ancho: (girada ? medida.alto : medida.ancho) * escala,
    alto: (girada ? medida.ancho : medida.alto) * escala,
  };
}

export function calcularDisposicion(medidas: Medida[], opciones: OpcionesDisposicion): Disposicion {
  const { escala, columnas, anchoDisponible, separacion } = opciones;
  const rotaciones = opciones.rotaciones ?? new Map<number, number>();
  const eliminadas = opciones.eliminadas ?? new Set<number>();

  let vivas = medidas.filter(medida => !eliminadas.has(medida.numero));
  if (opciones.solo !== undefined) {
    const sola = vivas.find(medida => medida.numero === opciones.solo) ?? vivas[0];
    vivas = sola ? [sola] : [];
  }
  const filas: Fila[] = [];
  let top = separacion;
  let anchoTotal = 0;

  for (const grupo of agrupar(vivas, columnas, opciones.portada)) {
    const tamanos = grupo.map(medida => {
      const rotacion = rotaciones.get(medida.numero) ?? 0;
      return { medida, rotacion, ...dimensiones(medida, rotacion, escala) };
    });

    const anchoFila = tamanos.reduce((suma, t) => suma + t.ancho, 0)
      + separacion * (tamanos.length - 1);
    const altoFila = Math.max(...tamanos.map(t => t.alto));
    anchoTotal = Math.max(anchoTotal, anchoFila);

    // Centrada, y sin dejar que se salga por la izquierda cuando no cabe.
    let izquierda = Math.max(separacion, (anchoDisponible - anchoFila) / 2);
    const paginas = tamanos.map(t => {
      const colocada: PaginaColocada = {
        numero: t.medida.numero,
        izquierda,
        ancho: t.ancho,
        alto: t.alto,
        rotacion: t.rotacion,
      };
      izquierda += t.ancho + separacion;
      return colocada;
    });

    filas.push({ top, alto: altoFila, paginas });
    top += altoFila + separacion;
  }

  return { filas, altoTotal: top, anchoTotal: anchoTotal + separacion * 2 };
}

/**
 * Qué filas hay que tener montadas.
 *
 * Se añade un margen por arriba y por abajo para que al desplazarse la página
 * siguiente ya esté dibujada y no aparezca en blanco.
 */
export function filasVisibles(disposicion: Disposicion, desplazamiento: number, altoVentana: number,
                              margen = 1): [number, number] {
  const { filas } = disposicion;
  if (filas.length === 0) {
    return [0, -1];
  }

  const primera = buscarFila(filas, desplazamiento);
  let ultima = primera;
  while (ultima + 1 < filas.length && filas[ultima + 1].top < desplazamiento + altoVentana) {
    ultima++;
  }
  return [Math.max(0, primera - margen), Math.min(filas.length - 1, ultima + margen)];
}

/** Qué página se considera que se está mirando, para el contador y la memoria. */
export function paginaEnFoco(disposicion: Disposicion, desplazamiento: number, altoVentana: number): number {
  const fila = disposicion.filas[buscarFila(disposicion.filas, desplazamiento + altoVentana / 3)];
  return fila?.paginas[0]?.numero ?? 1;
}

/** Escala para que la página quepa a lo ancho o entera. */
export function escalaParaAjustar(medida: Medida, rotacion: number, anchoDisponible: number,
                                  altoDisponible: number, modo: 'ancho' | 'pagina',
                                  separacion: number): number {
  const { ancho, alto } = dimensiones(medida, rotacion, 1);
  const porAncho = (anchoDisponible - separacion * 2) / ancho;
  if (modo === 'ancho') {
    return porAncho;
  }
  return Math.min(porAncho, (altoDisponible - separacion * 2) / alto);
}

/** Búsqueda binaria de la última fila que empieza antes del punto dado. */
function buscarFila(filas: Fila[], punto: number): number {
  let bajo = 0;
  let alto = filas.length - 1;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (filas[medio].top <= punto) {
      bajo = medio;
    } else {
      alto = medio - 1;
    }
  }
  return bajo;
}
