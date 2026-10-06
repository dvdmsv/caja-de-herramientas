import { PesoPipe } from '../../shared/peso.pipe';

/**
 * Lo que el visor cuenta del documento —sus propiedades y las etiquetas de sus
 * páginas—, ya en texto para enseñarlo. Sin pdf.js: `DocumentoPdf` le pasa lo
 * que pdf.js devuelve y aquí sólo se decide qué decir.
 */

export interface Propiedad {
  nombre: string;
  valor: string;
}

/** Lo que llega de `getMetadata()`, más lo que el visor sabe por su cuenta. */
export interface DatosDelDocumento {
  info: Record<string, unknown>;
  /** Las fechas ya convertidas por pdf.js (`PDFDateString`). */
  creado: Date | null;
  modificado: Date | null;
  etiquetado: boolean;
  paginas: number;
  /** De la primera página, en puntos. */
  ancho: number;
  alto: number;
  peso: number;
}

/** Los formatos con nombre, en milímetros (el lado corto primero). */
const FORMATOS: [string, number, number][] = [
  ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148],
  ['Carta', 216, 279], ['Legal', 216, 356], ['B5', 176, 250],
];

const MM_POR_PUNTO = 25.4 / 72;

/** «A4 vertical (210 × 297 mm)», o sólo las medidas si no tiene nombre. */
export function tamanoDePagina(ancho: number, alto: number): string {
  const mmAncho = Math.round(ancho * MM_POR_PUNTO);
  const mmAlto = Math.round(alto * MM_POR_PUNTO);
  const [corto, largo] = mmAncho <= mmAlto ? [mmAncho, mmAlto] : [mmAlto, mmAncho];
  // Dos milímetros de tolerancia: los generadores redondean los puntos a su manera.
  const formato = FORMATOS.find(([, c, l]) => Math.abs(c - corto) <= 2 && Math.abs(l - largo) <= 2);
  const medidas = `${mmAncho} × ${mmAlto} mm`;
  if (!formato) {
    return medidas;
  }
  const orientacion = mmAncho === mmAlto ? '' : mmAncho < mmAlto ? ' vertical' : ' apaisado';
  return `${formato[0]}${orientacion} (${medidas})`;
}

/** Las propiedades que merece la pena enseñar; las vacías no salen. */
export function propiedades(datos: DatosDelDocumento): Propiedad[] {
  const texto = (clave: string) => {
    const valor = datos.info[clave];
    return typeof valor === 'string' ? valor.trim() : '';
  };
  const fecha = (valor: Date | null) =>
    valor && !Number.isNaN(valor.getTime())
      ? valor.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
      : '';
  const si = (valor: unknown) => (valor ? 'Sí' : 'No');

  const filas: Propiedad[] = [
    { nombre: 'Título', valor: texto('Title') },
    { nombre: 'Autor', valor: texto('Author') },
    { nombre: 'Asunto', valor: texto('Subject') },
    { nombre: 'Palabras clave', valor: texto('Keywords') },
    { nombre: 'Creado', valor: fecha(datos.creado) },
    { nombre: 'Modificado', valor: fecha(datos.modificado) },
    { nombre: 'Hecho con', valor: texto('Creator') },
    { nombre: 'Convertido con', valor: texto('Producer') },
    { nombre: 'Páginas', valor: String(datos.paginas) },
    { nombre: 'Tamaño de página', valor: tamanoDePagina(datos.ancho, datos.alto) },
    { nombre: 'Peso', valor: new PesoPipe().transform(datos.peso) },
    { nombre: 'Versión de PDF', valor: texto('PDFFormatVersion') },
    { nombre: 'Formulario', valor: si(datos.info['IsAcroFormPresent'] || datos.info['IsXFAPresent']) },
    { nombre: 'Firmas', valor: si(datos.info['IsSignaturesPresent']) },
    // Etiquetado es lo que necesita un lector de pantalla para leerlo en orden.
    { nombre: 'Etiquetado (accesible)', valor: si(datos.etiquetado) },
    { nombre: 'Optimizado para la web', valor: si(datos.info['IsLinearized']) },
  ];
  return filas.filter(fila => fila.valor);
}

/**
 * La página que corresponde a lo que se escribe en el cuadro de página: su
 * etiqueta («iv», «A-3») o, si no es ninguna, su número. `null` si no existe.
 */
export function paginaDeEtiqueta(escrito: string, etiquetas: string[] | null,
                                 total: number): number | null {
  const buscado = escrito.trim().toLowerCase();
  if (!buscado) {
    return null;
  }
  const indice = etiquetas?.findIndex(etiqueta => etiqueta.trim().toLowerCase() === buscado) ?? -1;
  if (indice >= 0) {
    return indice + 1;
  }
  const numero = Number(buscado);
  return Number.isInteger(numero) && numero >= 1 && numero <= total ? numero : null;
}

/**
 * Si las etiquetas aportan algo. Muchos generadores las ponen iguales al número
 * («1», «2», «3»…), y entonces enseñarlas es ruido.
 */
export function etiquetasUtiles(etiquetas: string[] | null): string[] | null {
  if (!etiquetas?.length) {
    return null;
  }
  return etiquetas.some((etiqueta, i) => etiqueta !== String(i + 1)) ? etiquetas : null;
}
