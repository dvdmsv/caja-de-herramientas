/**
 * Catálogo de herramientas.
 *
 * Es la única fuente de verdad para la portada, el buscador y el menú. Al añadir
 * una herramienta nueva basta con:
 *   1. añadir su entrada aquí con `disponible: true`,
 *   2. registrar su ruta en `app.routes.ts` (Angular necesita el import estático),
 *   3. crear el blueprint equivalente en `backend/api/tools/`.
 */

import { encaja } from '../shared/tipos-archivo';

export type Categoria = 'PDF' | 'Imágenes' | 'Documentos';

export interface Herramienta {
  /** Último tramo de la ruta y, por convención, el slug del endpoint del backend. */
  slug: string;
  nombre: string;
  descripcion: string;
  /** Clase de Bootstrap Icons. */
  icono: string;
  categoria: Categoria;
  /**
   * Qué archivos admite, con la misma sintaxis que el `accept` de un
   * `<input type="file">`; vacío si no recibe archivos (Generar QR, Crear
   * certificado). Es la fuente única: de aquí lo toma la cola de subida, los
   * mensajes de "elige un PDF" y "Usar en…", que ofrece a qué herramientas
   * mandar un resultado.
   */
  acepta: string;
  /** Si trabaja con varios archivos a la vez; si no, con uno cada vez. */
  varios: boolean;
  /**
   * Otras formas de llamarla, para el buscador del inicio: quien quiere unir
   * PDF puede escribir "juntar". Sin acentos no hace falta: se normalizan.
   */
  palabras: string[];
  /** Las no disponibles se muestran atenuadas como "próximamente". */
  disponible: boolean;
}

export const CATEGORIAS: Categoria[] = ['PDF', 'Imágenes', 'Documentos'];

/**
 * Nombre de la categoría tal como lo usa el CSS: en `<html data-categoria>` y en
 * las clases `pastilla--…` de `estilos/tema.css`, que le dan su color.
 */
export type ClaveCategoria = 'pdf' | 'imagenes' | 'documentos';

const CLAVES: Record<Categoria, ClaveCategoria> = {
  PDF: 'pdf',
  'Imágenes': 'imagenes',
  Documentos: 'documentos',
};

export function claveDeCategoria(categoria: Categoria): ClaveCategoria {
  return CLAVES[categoria];
}

export const HERRAMIENTAS: Herramienta[] = [
  {
    slug: 'unir-pdf',
    nombre: 'Unir PDF',
    descripcion: 'Combina varios PDF en un único documento, en el orden que elijas.',
    icono: 'bi-file-earmark-plus',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: true,
    palabras: ['juntar', 'fusionar', 'combinar', 'merge', 'concatenar'],
    disponible: true,
  },
  {
    slug: 'pdf-a-imagen',
    nombre: 'PDF a imagen',
    descripcion: 'Convierte cada página del PDF en una imagen JPG, PNG, WebP…',
    icono: 'bi-file-earmark-image',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['jpg', 'png', 'webp', 'convertir', 'exportar', 'rasterizar'],
    disponible: true,
  },
  {
    slug: 'firmar',
    nombre: 'Firmar documento',
    descripcion: 'Coloca tu firma donde quieras sobre un PDF o una imagen.',
    icono: 'bi-vector-pen',
    categoria: 'PDF',
    acepta: '.pdf,image/*',
    varios: false,
    palabras: ['firma', 'rubrica', 'autografa', 'dibujar'],
    disponible: true,
  },
  {
    slug: 'firmar-certificado',
    nombre: 'Firmar con certificado',
    descripcion: 'Firma un PDF con tu certificado digital, sin instalar nada ni subirlo a nadie.',
    icono: 'bi-patch-check',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['firma digital', 'certificado', 'autofirma', 'dnie', 'fnmt', 'p12', 'pades'],
    disponible: true,
  },
  {
    slug: 'comprobar-firmas',
    nombre: 'Comprobar firmas',
    descripcion: 'Te dice quién firmó un PDF, cuándo y si alguien lo ha tocado después.',
    icono: 'bi-shield-check',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: true,
    palabras: ['verificar', 'validar', 'firma digital', 'certificado'],
    disponible: true,
  },
  {
    slug: 'visor',
    nombre: 'Visor de PDF',
    descripcion: 'Lee, busca, subraya y edita tus PDF sin salir del navegador.',
    icono: 'bi-book',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['leer', 'ver', 'abrir', 'subrayar', 'anotar', 'buscar texto', 'rellenar formulario'],
    disponible: true,
  },
  {
    slug: 'dividir-pdf',
    nombre: 'Dividir PDF',
    descripcion: 'Saca las páginas que necesites a un documento nuevo.',
    icono: 'bi-scissors',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['separar', 'extraer paginas', 'cortar', 'partir', 'split'],
    disponible: true,
  },
  {
    slug: 'organizar-pdf',
    nombre: 'Organizar PDF',
    descripcion: 'Reordena, gira o elimina páginas arrastrándolas.',
    icono: 'bi-arrows-move',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['ordenar', 'reordenar', 'girar', 'rotar', 'borrar paginas', 'eliminar paginas'],
    disponible: true,
  },
  {
    slug: 'proteger-pdf',
    nombre: 'Proteger PDF',
    descripcion: 'Pon o quita la contraseña de apertura del documento.',
    icono: 'bi-file-earmark-lock',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['contraseña', 'password', 'cifrar', 'bloquear', 'desbloquear', 'quitar contraseña'],
    disponible: true,
  },
  {
    slug: 'ocr-pdf',
    nombre: 'PDF con OCR',
    descripcion: 'Reconoce el texto de un escaneado para poder buscarlo y copiarlo.',
    icono: 'bi-body-text',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['escaneado', 'reconocer texto', 'texto seleccionable', 'buscable'],
    disponible: true,
  },
  {
    slug: 'comprimir-pdf',
    nombre: 'Comprimir PDF',
    descripcion: 'Reduce el peso del documento conservando la calidad.',
    icono: 'bi-file-earmark-zip',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['reducir', 'aligerar', 'peso', 'tamaño', 'optimizar'],
    disponible: true,
  },
  {
    slug: 'marca-de-agua',
    nombre: 'Marca de agua',
    descripcion: 'Estampa un texto o tu logo en todas las páginas del documento.',
    icono: 'bi-droplet-half',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['sello', 'logo', 'borrador', 'confidencial', 'estampar'],
    disponible: true,
  },
  {
    slug: 'numerar-paginas',
    nombre: 'Numerar páginas',
    descripcion: 'Pone el número de página donde tú digas, con el formato que elijas.',
    icono: 'bi-list-ol',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['numeros', 'paginacion', 'pie de pagina'],
    disponible: true,
  },
  {
    slug: 'extraer-imagenes',
    nombre: 'Extraer imágenes',
    descripcion: 'Saca las imágenes que lleva dentro un PDF, sin perder calidad.',
    icono: 'bi-card-image',
    categoria: 'PDF',
    acepta: '.pdf',
    varios: false,
    palabras: ['sacar fotos', 'guardar imagenes', 'fotos'],
    disponible: true,
  },
  {
    slug: 'comprimir-imagen',
    nombre: 'Comprimir imagen',
    descripcion: 'Baja el peso de tus imágenes ajustando la calidad.',
    icono: 'bi-images',
    categoria: 'Imágenes',
    acepta: 'image/*',
    varios: true,
    palabras: ['reducir', 'aligerar', 'peso', 'tamaño', 'optimizar', 'foto', 'jpg'],
    disponible: true,
  },
  {
    slug: 'imagen-a-pdf',
    nombre: 'Imagen a PDF',
    descripcion: 'Reúne tus imágenes en un único PDF, en el orden que elijas.',
    icono: 'bi-file-earmark-pdf',
    categoria: 'Imágenes',
    acepta: 'image/*',
    varios: true,
    palabras: ['fotos a pdf', 'jpg a pdf', 'png a pdf', 'escanear', 'juntar fotos'],
    disponible: true,
  },
  {
    slug: 'generar-qr',
    nombre: 'Generar QR',
    descripcion: 'Códigos QR para un enlace, tu wifi o tu contacto, sin pasar por nadie.',
    icono: 'bi-qr-code',
    categoria: 'Imágenes',
    acepta: '',
    varios: false,
    palabras: ['codigo qr', 'wifi', 'contacto', 'vcard', 'enlace'],
    disponible: true,
  },
  {
    slug: 'limpiar-metadatos',
    nombre: 'Limpiar metadatos',
    descripcion: 'Enseña lo que tus archivos cuentan de ti —hasta dónde se hizo la foto— y lo borra.',
    icono: 'bi-incognito',
    categoria: 'Documentos',
    acepta: '.pdf,image/*',
    varios: true,
    palabras: ['privacidad', 'exif', 'gps', 'ubicacion', 'autor', 'anonimizar'],
    disponible: true,
  },
  {
    slug: 'documento-a-pdf',
    nombre: 'Documento a PDF',
    descripcion: 'Convierte Word, ODT, RTF o texto plano a PDF conservando el formato.',
    icono: 'bi-filetype-pdf',
    categoria: 'Documentos',
    acepta: '.docx,.doc,.odt,.rtf,.txt',
    varios: true,
    palabras: ['word a pdf', 'docx', 'odt', 'rtf', 'convertir', 'exportar'],
    disponible: true,
  },
  {
    slug: 'pdf-a-word',
    nombre: 'PDF a Word',
    descripcion: 'Saca un .docx editable de un PDF, con su texto, sus tablas y sus imágenes.',
    icono: 'bi-file-earmark-word',
    categoria: 'Documentos',
    acepta: '.pdf',
    varios: true,
    palabras: ['docx', 'editar pdf', 'convertir', 'exportar'],
    disponible: true,
  },
  {
    slug: 'a-markdown',
    nombre: 'Documento a Markdown',
    descripcion: 'Pasa un PDF, Word, Excel o PowerPoint a Markdown para dárselo a una IA.',
    icono: 'bi-markdown',
    categoria: 'Documentos',
    acepta: '.pdf,.docx,.xlsx,.xls,.pptx,.csv,.json,.xml,.html,.htm,.txt,.md,.epub',
    varios: true,
    palabras: ['md', 'texto', 'ia', 'chatgpt', 'llm', 'excel', 'powerpoint', 'extraer texto'],
    disponible: true,
  },
  {
    slug: 'markdown-a-pdf',
    nombre: 'Markdown a PDF',
    descripcion: 'Maqueta un .md como documento, con sus títulos, listas, tablas y código.',
    icono: 'bi-filetype-md',
    categoria: 'Documentos',
    acepta: '.md',
    varios: true,
    palabras: ['md', 'maquetar', 'imprimir', 'informe', 'ia', 'chatgpt', 'llm', 'convertir'],
    disponible: true,
  },
  {
    slug: 'crear-certificado',
    nombre: 'Crear certificado',
    descripcion: 'Genera un certificado propio para firmar, si todavía no tienes ninguno.',
    icono: 'bi-award',
    categoria: 'Documentos',
    acepta: '',
    varios: false,
    palabras: ['p12', 'pfx', 'autofirmado', 'generar certificado'],
    disponible: true,
  },
  {
    slug: 'convertir-imagen',
    nombre: 'Convertir imagen',
    descripcion: 'Pasa entre JPG, PNG, WebP y otros formatos.',
    icono: 'bi-arrow-left-right',
    categoria: 'Imágenes',
    acepta: 'image/*',
    varios: true,
    palabras: ['jpg', 'png', 'webp', 'heic', 'formato', 'cambiar formato'],
    disponible: true,
  },
];

/** Una categoría con sus herramientas, tal y como la pintan portada y menú. */
export interface Grupo {
  categoria: Categoria;
  herramientas: Herramienta[];
}

/**
 * Agrupa el catálogo por categorías, en el orden de `CATEGORIAS` y sin las
 * categorías que se quedarían vacías.
 *
 * El menú sólo enseña lo que ya funciona; la portada también anuncia lo que
 * está por venir, de ahí el parámetro.
 */
export function agruparPorCategoria(incluirPendientes = false): Grupo[] {
  return CATEGORIAS
    .map(categoria => ({
      categoria,
      herramientas: HERRAMIENTAS.filter(
        h => h.categoria === categoria && (incluirPendientes || h.disponible)),
    }))
    .filter(grupo => grupo.herramientas.length > 0);
}

export function rutaDe(herramienta: Herramienta): string {
  // El visor no es una herramienta de un disparo: vive en su propia pantalla.
  return herramienta.slug === 'visor' ? '/visor' : `/herramientas/${herramienta.slug}`;
}

export function buscarPorSlug(slug: string): Herramienta | undefined {
  return HERRAMIENTAS.find(h => h.slug === slug);
}

/** Minúsculas y sin acentos, para comparar lo que se escribe con el catálogo. */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Las herramientas disponibles que casan con lo que se busca, las que casan por
 * el nombre primero. Cada palabra de la búsqueda tiene que aparecer en el
 * nombre, la descripción o las palabras clave; da igual el orden.
 */
export function buscar(texto: string): Herramienta[] {
  const terminos = normalizar(texto).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) {
    return [];
  }
  const puntuadas = HERRAMIENTAS
    .filter(h => h.disponible)
    .map(h => {
      const nombre = normalizar(h.nombre);
      const resto = normalizar([h.descripcion, ...h.palabras].join(' '));
      const casan = terminos.every(t => nombre.includes(t) || resto.includes(t));
      const porNombre = terminos.filter(t => nombre.includes(t)).length;
      return { h, casan, porNombre };
    })
    .filter(x => x.casan);
  return puntuadas.sort((a, b) => b.porNombre - a.porNombre).map(x => x.h);
}

/**
 * A qué herramientas se pueden mandar estos archivos: las disponibles que
 * admiten todos ellos y, si son varios, que trabajan con varios.
 */
export function destinosPara(archivos: { name: string; type: string }[], excepto?: string): Herramienta[] {
  if (archivos.length === 0) {
    return [];
  }
  return HERRAMIENTAS.filter(h =>
    h.disponible && h.slug !== excepto && h.acepta !== ''
    && (archivos.length === 1 || h.varios)
    && archivos.every(a => encaja(a, h.acepta)));
}
