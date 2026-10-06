import { Injectable } from '@angular/core';

import {
  DestinoPdf, EnlacePdf, alturaDeDestino, destinoDeAccion, urlAbrible,
} from '../pages/visor/enlaces';

/**
 * pdf.js usa `Promise.try` al decodificar imágenes, y zone.js —que Angular
 * carga— sustituye el `Promise` nativo por el suyo, que no lo implementa. Sin
 * este remiendo, abrir un PDF con imágenes deja una promesa que no resuelve ni
 * falla: la página se queda "preparando" para siempre.
 *
 * Se aplica al `Promise` global, que a estas alturas ya es el de zone.js.
 */
function asegurarPromiseTry(): void {
  const promesa = Promise as unknown as { try?: unknown };
  if (typeof promesa.try !== 'function') {
    promesa.try = <T>(fn: (...args: unknown[]) => T, ...args: unknown[]) =>
      new Promise<T>(resolve => resolve(fn(...args)));
  }
}

/**
 * Un campo rellenable de los que trae el propio PDF.
 *
 * Es lo que da `getAnnotations` de pdf.js, traducido a lo que necesita el visor
 * y con el rectángulo ya en su convención: proporciones de 0 a 1 con el origen
 * arriba a la izquierda, sobre la página tal y como está en el archivo.
 */
export interface CampoPdf {
  nombre: string;
  tipo: 'texto' | 'casilla' | 'opcion' | 'lista';
  rect: [number, number, number, number];
  /** El valor que trae el archivo. */
  valor: string;
  multilinea: boolean;
  /** Tope de caracteres, si el campo lo declara. */
  maximo: number;
  /** Las alternativas de un desplegable o una lista. */
  opciones: { valor: string; texto: string }[];
  /** Lo que vale una casilla o una opción cuando está marcada. */
  marcado: string;
}

/** Ancho al que se rasteriza una página para verla a tamaño completo. */
export const ANCHO_VISTA = 1100;

/** Ancho de las miniaturas de las herramientas que trabajan página a página. */
export const ANCHO_MINIATURA = 200;

/**
 * Tope por página. No debería hacer falta nunca, pero una promesa de pdf.js que
 * no vuelve deja la interfaz colgada sin decir nada, y eso es peor que un error.
 */
const LIMITE_POR_PAGINA = 20000;

/**
 * Un PDF abierto en el navegador, con sus páginas listas para pintar.
 *
 * Las imágenes se guardan por página y ancho: quien va y viene entre páginas no
 * las vuelve a rasterizar.
 */
export class DocumentoPdf {
  private readonly cache = new Map<string, string>();

  constructor(private readonly tarea: any, private readonly documento: any,
              private readonly pdfjs: any) {}

  get paginas(): number {
    return this.documento.numPages;
  }

  /** La página de pdf.js, para quien necesite dibujarla o leer su texto. */
  pagina(numero: number): Promise<any> {
    return this.documento.getPage(numero);
  }

  /**
   * Medidas de todas las páginas a escala 1, que es lo que necesita el visor
   * para colocarlas sin haberlas dibujado.
   *
   * Casi todos los documentos tienen todas las páginas iguales, así que primero
   * se comprueban unas cuantas: si coinciden, se da por hecho el resto y abrir
   * un documento de trescientas páginas cuesta lo mismo que uno de tres. Sólo
   * si hay mezcla se recorren todas.
   */
  async medidas(): Promise<{ numero: number; ancho: number; alto: number }[]> {
    const total = this.paginas;
    const medir = async (numero: number) => {
      const { width, height } = (await this.pagina(numero)).getViewport({ scale: 1 });
      return { numero, ancho: width, alto: height };
    };

    const muestras = [...new Set([1, Math.ceil(total / 2), total])];
    const medidas = await Promise.all(muestras.map(medir));
    const primera = medidas[0];
    const uniforme = medidas.every(m => m.ancho === primera.ancho && m.alto === primera.alto);

    if (uniforme) {
      return Array.from({ length: total }, (_, i) => ({ ...primera, numero: i + 1 }));
    }
    const todas = [];
    for (let numero = 1; numero <= total; numero++) {
      todas.push(await medir(numero));
    }
    return todas;
  }

  /**
   * Monta la capa de texto invisible sobre la página.
   *
   * Es lo que permite seleccionar, copiar y subrayar: sin ella, la página no
   * pasa de ser una imagen. Devuelve los elementos de cada fragmento, que es lo
   * que hace falta para localizar sobre el papel lo que encuentra el buscador.
   */
  async capaTexto(numero: number, viewport: any, contenedor: HTMLElement): Promise<HTMLElement[]> {
    const pagina = await this.pagina(numero);
    contenedor.replaceChildren();
    const capa = new this.pdfjs.TextLayer({
      textContentSource: pagina.streamTextContent(),
      container: contenedor,
      viewport,
    });
    await capa.render();
    return capa.textDivs;
  }

  /**
   * Cómo hay que dibujar las anotaciones.
   *
   * `ENABLE_FORMS` deja **el contenido** de los campos fuera del lienzo, que es
   * lo que hace falta: con el modo normal, un campo que ya viniera relleno se
   * pintaría en la imagen y se vería otra vez dentro del control, con el texto
   * doblado. Comprobado contando píxeles con los tres modos.
   *
   * El marco del recuadro sí lo sigue pintando, y está bien: es parte del
   * dibujo del impreso.
   */
  get modoConFormularios(): number {
    return this.pdfjs.AnnotationMode.ENABLE_FORMS;
  }

  /**
   * Los campos rellenables de una página, si el PDF es un formulario.
   *
   * Los rectángulos llegan en espacio PDF —origen abajo a la izquierda— y los
   * pasa al del visor el propio pdf.js, esquina a esquina, sobre el viewport a
   * escala 1, que ya lleva aplicado el giro del archivo. Se convierten las dos
   * esquinas y no el rectángulo entero porque pdf.js 6 ya no trae
   * `convertToViewportRectangle`; `convertToViewportPoint` es la misma que usa
   * "Firmar documento".
   */
  async campos(numero: number): Promise<CampoPdf[]> {
    const pagina = await this.pagina(numero);
    const anotaciones = await pagina.getAnnotations({ intent: 'display' });
    const viewport = pagina.getViewport({ scale: 1 });

    return anotaciones
      // Los de sólo lectura se quedan fuera: no hay nada que rellenar en ellos, y
      // pdf.js ya los dibuja en la imagen tal y como los tenga el documento. Si
      // además se les pusiera un control encima, su texto se vería dos veces.
      .filter((a: any) => a.subtype === 'Widget' && a.fieldName && !a.hidden
        && !a.pushButton && !a.readOnly)
      .map((a: any) => {
        return {
          nombre: String(a.fieldName),
          tipo: tipoDeCampo(a),
          rect: enProporciones(a.rect, viewport),
          valor: valorDeCampo(a),
          multilinea: !!a.multiLine,
          maximo: Number(a.maxLen) || 0,
          opciones: (a.options ?? []).map((o: any) => ({
            valor: String(o.exportValue ?? o.displayValue ?? ''),
            texto: String(o.displayValue ?? o.exportValue ?? ''),
          })),
          // Las casillas lo llaman `exportValue` y las opciones `buttonValue`:
          // sin lo segundo, las opciones de un grupo valdrían todas lo mismo y
          // no se podría distinguir cuál se ha marcado.
          marcado: String(a.buttonValue ?? a.exportValue ?? 'Yes'),
        };
      })
      .filter((campo: CampoPdf) => campo.tipo !== 'texto' || !campo.opciones.length);
  }

  /**
   * Los enlaces de una página: a una dirección de fuera o a otro sitio del
   * documento, con su rectángulo en la misma convención que los campos.
   */
  async enlaces(numero: number): Promise<EnlacePdf[]> {
    const pagina = await this.pagina(numero);
    const anotaciones = await pagina.getAnnotations({ intent: 'display' });
    const viewport = pagina.getViewport({ scale: 1 });
    const enlaces: EnlacePdf[] = [];

    for (const a of anotaciones.filter((a: any) => a.subtype === 'Link')) {
      const rect = enProporciones(a.rect, viewport);
      const url = urlAbrible(a.url);
      if (url) {
        enlaces.push({ rect, url });
        continue;
      }
      const accion = a.action ? destinoDeAccion(a.action, numero, this.paginas) : null;
      const destino = a.dest ? await this.destino(a.dest)
        : accion ? { pagina: accion, y: null } : null;
      if (destino) {
        enlaces.push({ rect, destino });
      }
    }
    return enlaces;
  }

  /** Marcadores del documento, si los trae, ya aplanados para el panel. */
  async indice(): Promise<{ titulo: string; pagina: number; y: number | null; nivel: number }[]> {
    const marcadores = await this.documento.getOutline();
    if (!marcadores?.length) {
      return [];
    }

    const plano: { titulo: string; pagina: number; y: number | null; nivel: number }[] = [];
    const recorrer = async (nodos: any[], nivel: number) => {
      for (const nodo of nodos) {
        const destino = await this.destino(nodo.dest);
        if (destino) {
          plano.push({ titulo: nodo.title?.trim() || 'Sin título', ...destino, nivel });
        }
        if (nodo.items?.length) {
          await recorrer(nodo.items, nivel + 1);
        }
      }
    };
    await recorrer(marcadores, 0);
    return plano;
  }

  /**
   * La página y la altura a la que lleva un destino, con nombre o explícito.
   *
   * La altura sale en espacio PDF y se pasa a la proporción desde arriba sobre
   * la página del archivo, la que usa el visor para todo.
   */
  async destino(destino: any): Promise<DestinoPdf | null> {
    try {
      const explicito = typeof destino === 'string'
        ? await this.documento.getDestination(destino)
        : destino;
      if (!Array.isArray(explicito) || explicito[0] === null || explicito[0] === undefined) {
        return null;
      }
      // Casi siempre es una referencia a la página; algunos generadores ponen
      // directamente su número, empezando en cero.
      const indice = typeof explicito[0] === 'number'
        ? explicito[0]
        : await this.documento.getPageIndex(explicito[0]);
      const pagina = indice + 1;
      const altura = alturaDeDestino(explicito);
      if (altura === null || pagina < 1 || pagina > this.paginas) {
        return pagina >= 1 && pagina <= this.paginas ? { pagina, y: null } : null;
      }
      const viewport = (await this.pagina(pagina)).getViewport({ scale: 1 });
      const [, y] = viewport.convertToViewportPoint(0, altura);
      return { pagina, y: Math.max(0, Math.min(1, y / viewport.height)) };
    } catch {
      return null; // un marcador roto no debe impedir enseñar los demás
    }
  }

  async imagen(numero: number, ancho = ANCHO_VISTA): Promise<string> {
    const clave = `${numero}:${ancho}`;
    const guardada = this.cache.get(clave);
    if (guardada) {
      return guardada;
    }

    const pagina = await this.documento.getPage(numero);
    const natural = pagina.getViewport({ scale: 1 });
    const viewport = pagina.getViewport({ scale: ancho / natural.width });

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(viewport.width);
    lienzo.height = Math.round(viewport.height);
    const dibujo = pagina.render({ canvas: lienzo, canvasContext: lienzo.getContext('2d')!, viewport });
    await conLimite(dibujo.promise, numero);

    const imagen = lienzo.toDataURL('image/png');
    this.cache.set(clave, imagen);
    return imagen;
  }

  cerrar(): void {
    this.cache.clear();
    // Quien libera el documento es la tarea de carga: el proxy no tiene `destroy`.
    this.tarea?.destroy();
  }
}

/**
 * Carga de PDF en el navegador, con pdf.js.
 *
 * Vive aquí y no en cada herramienta porque lo usan tres: firmar, dividir y
 * organizar. La librería se importa la primera vez que hace falta, así que sólo
 * la descarga quien entra en una de ellas.
 */
@Injectable({ providedIn: 'root' })
export class PdfService {
  private pdfjs: any;

  async abrir(archivo: File): Promise<DocumentoPdf> {
    const pdfjs = await this.libreria();
    const tarea = pdfjs.getDocument({ data: await archivo.arrayBuffer() });
    return new DocumentoPdf(tarea, await tarea.promise, pdfjs);
  }

  private async libreria(): Promise<any> {
    if (!this.pdfjs) {
      asegurarPromiseTry();
      this.pdfjs = await import('pdfjs-dist');
      // Con ruta absoluta: la herramienta se sirve desde /herramientas/…, y una
      // ruta relativa buscaría el worker donde no está.
      this.pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
    }
    return this.pdfjs;
  }
}

/**
 * Un rectángulo de anotación (espacio PDF, origen abajo) en proporciones del
 * visor. Se convierten las dos esquinas y no el rectángulo entero porque pdf.js
 * 6 ya no trae `convertToViewportRectangle`.
 */
function enProporciones(rect: number[], viewport: any): [number, number, number, number] {
  const [ax0, ay0, ax1, ay1] = rect;
  const [x0, y0] = viewport.convertToViewportPoint(ax0, ay0);
  const [x1, y1] = viewport.convertToViewportPoint(ax1, ay1);
  const entre = (v: number) => Math.max(0, Math.min(1, v));
  return [
    entre(Math.min(x0, x1) / viewport.width),
    entre(Math.min(y0, y1) / viewport.height),
    entre(Math.max(x0, x1) / viewport.width),
    entre(Math.max(y0, y1) / viewport.height),
  ];
}

function tipoDeCampo(anotacion: any): CampoPdf['tipo'] {
  if (anotacion.checkBox) {
    return 'casilla';
  }
  if (anotacion.radioButton) {
    return 'opcion';
  }
  // Los desplegables y las listas son lo mismo para el PDF; cambia si se
  // despliegan o se ven abiertos, y aquí se resuelven igual.
  return anotacion.fieldType === 'Ch' ? 'lista' : 'texto';
}

/** El valor puede venir suelto o en lista, según el tipo de campo. */
function valorDeCampo(anotacion: any): string {
  const valor = anotacion.fieldValue;
  if (Array.isArray(valor)) {
    return valor.length ? String(valor[0]) : '';
  }
  return valor === null || valor === undefined ? '' : String(valor);
}

/** Falla en vez de esperar indefinidamente si una página no termina de pintarse. */
function conLimite<T>(promesa: Promise<T>, numero: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aviso = setTimeout(
      () => reject(new Error(`La página ${numero} ha tardado demasiado en prepararse.`)),
      LIMITE_POR_PAGINA);
    promesa.then(resolve, reject).finally(() => clearTimeout(aviso));
  });
}
