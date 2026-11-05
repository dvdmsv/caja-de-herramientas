import { extraerImagenes } from './extraer-imagenes';
import { marcaDeAgua } from './marca';
import { numerar } from './numeracion';
import type * as MuPDF from 'mupdf';
import type { EntradaMotor, PeticionMotor, ResultadoMotor } from './tipos';
import { expandirRangos } from '../../shared/rangos';
import { CUOTA_LOCAL, MAXIMO_PIXELES } from './catalogo';

type Motor = typeof MuPDF;
type Avance = (hechos: number, total: number) => void;

export function base(nombre: string): string { return nombre.replace(/\.[^.]+$/, ''); }

export function guardarPdf(doc: MuPDF.PDFDocument, opciones: Record<string, unknown> = {}): Blob {
  const buffer = doc.saveToBuffer({ garbage: 4, compress: true, ...opciones });
  try { return new Blob([buffer.asUint8Array().slice()], { type: 'application/pdf' }); }
  finally { buffer.destroy(); }
}

export async function abrirPdf(m: Motor, entrada: EntradaMotor, password = ''): Promise<MuPDF.PDFDocument> {
  const doc = new m.PDFDocument(await entrada.blob.arrayBuffer());
  if (doc.needsPassword() && (!password || !doc.authenticatePassword(password))) {
    doc.destroy();
    throw new Error(`«${entrada.name}» necesita su contraseña. Utiliza «Proteger PDF» para quitarla primero.`);
  }
  if (!doc.countPages()) { doc.destroy(); throw new Error('El PDF no tiene páginas.'); }
  return doc;
}

/** MuPDF no copia el árbol de formularios al injertar páginas entre documentos. */
function comprobarUnion(doc: MuPDF.PDFDocument): void {
  if (!doc.getTrailer().get('Root', 'AcroForm').isNull()) {
    throw new Error('Para unir un PDF con formularios en Android, aplánalo primero. Así se conservan sus valores visibles.');
  }
  for (let n = 0; n < doc.countPages(); n++) {
    const pagina = doc.findPage(n);
    try {
      if (pagina.get('Annots').length > 0) {
        throw new Error('Este PDF contiene anotaciones o enlaces. La unión en Android aún no los conserva. Puedes aplanar las anotaciones primero o usar Windows para conservar los enlaces.');
      }
    } finally { pagina.destroy(); }
  }
}

type EntradaIndice = { title?: string; page?: number; open: boolean; down?: EntradaIndice[] };

/** Reconstruye los marcadores con destinos a las páginas del documento combinado. */
export function escribirIndice(doc: MuPDF.PDFDocument, entradas: EntradaIndice[]): void {
  if (!entradas.length) return;
  const raiz = doc.addObject({ Type: 'Outlines' });
  const hijos = (padre: MuPDF.PDFObject, lista: EntradaIndice[]): number => {
    let anterior: MuPDF.PDFObject | null = null, total = 0;
    for (const entrada of lista) {
      const nodo = doc.addObject({ Title: doc.newString(entrada.title ?? ''), Parent: padre });
      if (entrada.page !== undefined && entrada.page >= 0 && entrada.page < doc.countPages()) {
        nodo.put('Dest', [doc.findPage(entrada.page), 'Fit']);
      }
      if (anterior) { anterior.put('Next', nodo); nodo.put('Prev', anterior); }
      else padre.put('First', nodo);
      if (entrada.down?.length) {
        const cuantos = hijos(nodo, entrada.down);
        nodo.put('Count', entrada.open ? cuantos : -cuantos);
        if (entrada.open) total += cuantos;
      }
      anterior = nodo; total++;
    }
    if (anterior) padre.put('Last', anterior);
    return total;
  };
  raiz.put('Count', hijos(raiz, entradas));
  doc.getTrailer().get('Root').put('Outlines', raiz);
}

function tieneFirma(doc: MuPDF.PDFDocument): boolean {
  for (let n = 1; n < doc.countObjects(); n++) {
    const obj = doc.newIndirect(n);
    try { if (obj.get('FT').asName() === 'Sig' && !obj.get('V').isNull()) return true; }
    finally { obj.destroy(); }
  }
  return false;
}

export async function ejecutarPdf(m: Motor, peticion: PeticionMotor, avance: Avance): Promise<ResultadoMotor> {
  const { slug, archivos, opciones: o } = peticion;
  if (!archivos.length) throw new Error('Elige al menos un archivo.');
  const resultados: EntradaMotor[] = [];
  let bytes = 0;
  const agregar = (name: string, blob: Blob) => {
    bytes += blob.size;
    if (bytes > CUOTA_LOCAL) throw new Error('El resultado supera 250 MB. Prueba con menos páginas o una resolución menor.');
    resultados.push({ name, blob });
  };
  if (slug === 'unir-pdf') {
    if (archivos.length < 2) throw new Error('Elige al menos dos PDF.');
    const salida = new m.PDFDocument();
    const indice: EntradaIndice[] = [];
    try {
      for (let i = 0; i < archivos.length; i++) {
        const doc = await abrirPdf(m, archivos[i]);
        try {
          comprobarUnion(doc);
          const desplazamiento = salida.countPages();
          const trasladar = (e: EntradaIndice): EntradaIndice => ({ ...e,
            page: e.page === undefined ? undefined : e.page + desplazamiento, down: e.down?.map(trasladar) });
          indice.push(...(doc.loadOutline() ?? []).map(trasladar));
          const mapa = salida.newGraftMap();
          try {
            for (let n = 0; n < doc.countPages(); n++) mapa.graftPage(-1, doc, n);
          } finally { mapa.destroy(); }
        } finally { doc.destroy(); }
        avance(i + 1, archivos.length);
      }
      escribirIndice(salida, indice);
      agregar('documento-combinado.pdf', guardarPdf(salida));
    } finally { salida.destroy(); }
    return { archivos: resultados };
  }
  for (let i = 0; i < archivos.length; i++) {
    const entrada = archivos[i];
    const doc = await abrirPdf(m, entrada, String(o['password_actual'] ?? ''));
    try {
      if (slug === 'extraer-imagenes') {
        for (const imagen of extraerImagenes(m, doc, entrada.name, o, avance)) agregar(imagen.name, imagen.blob);
      } else if (slug === 'marca-de-agua' || slug === 'marca-de-agua/previsualizar') {
        const previa = slug.endsWith('/previsualizar'), numero = Number(o['pagina'] ?? 1);
        if (previa && (!Number.isInteger(numero) || numero < 1 || numero > doc.countPages())) throw new Error('La página no existe.');
        const recurso = peticion.recursos?.['imagen_id'];
        const imagen = recurso ? new m.Image(await recurso.blob.arrayBuffer()) : undefined;
        try { marcaDeAgua(m, doc, o, imagen, previa ? numero : undefined); }
        finally { imagen?.destroy(); }
        agregar(previa ? 'vista.jpg' : `${base(entrada.name)}-con-marca.pdf`, previa ? previsualizarPdf(m, doc, numero) : guardarPdf(doc));
      } else if (slug === 'numerar-paginas/previsualizar') {
        const numero = Number(o['pagina'] ?? 1);
        if (!Number.isInteger(numero) || numero < 1 || numero > doc.countPages()) throw new Error('La página no existe.');
        numerar(m, doc, o, numero);
        agregar('vista.jpg', previsualizarPdf(m, doc, numero));
      } else if (slug === 'numerar-paginas') {
        numerar(m, doc, o);
        agregar(`${base(entrada.name)}-numerado.pdf`, guardarPdf(doc));
      } else if (slug === 'paginas') {
        // La consulta de páginas usa el mismo worker y devuelve un pequeño JSON.
        agregar('paginas.json', new Blob([JSON.stringify({ paginas: doc.countPages() })]));
      } else if (slug === 'dividir-pdf') {
        const paginas = expandirRangos(String(o['paginas'] ?? ''), doc.countPages()).map(n => n - 1);
        if (!paginas.length) throw new Error('Elige al menos una página válida.');
        if (o['modo'] === 'por-pagina') {
          for (const n of paginas) {
            // El constructor que recibe otro PDF comparte el documento nativo;
            // reabrir los bytes evita modificar el original al sacar cada página.
            const copia = await abrirPdf(m, entrada);
            try {
              copia.rearrangePages([n]);
              agregar(`${base(entrada.name)}-pagina-${n + 1}.pdf`, guardarPdf(copia));
            } finally { copia.destroy(); }
          }
        } else {
          doc.rearrangePages(paginas);
          agregar(`${base(entrada.name)}-seleccion.pdf`, guardarPdf(doc));
        }
      } else if (slug === 'organizar-pdf') {
        const paginas = o['paginas'] as { numero: number; rotacion: number }[];
        if (!Array.isArray(paginas) || !paginas.length || paginas.some(p =>
          !Number.isInteger(p.numero) || p.numero < 1 || p.numero > doc.countPages()
          || ![0, 90, 180, 270].includes(p.rotacion))) throw new Error('La selección de páginas no es válida.');
        for (const p of paginas) {
          const obj = doc.findPage(p.numero - 1);
          try { obj.put('Rotate', (obj.getInheritable('Rotate').asNumber() + p.rotacion) % 360); }
          finally { obj.destroy(); }
        }
        doc.rearrangePages(paginas.map(p => p.numero - 1));
        agregar(`${base(entrada.name)}-organizado.pdf`, guardarPdf(doc));
      } else if (slug === 'proteger-pdf') {
        const proteger = o['accion'] === 'proteger';
        const password = String(o['password'] ?? '');
        if (proteger && (password.length < 4 || new TextEncoder().encode(password).length > 127 || password.includes('\0'))) {
          throw new Error('La contraseña debe tener al menos 4 caracteres y ocupar como máximo 127 bytes.');
        }
        agregar(`${base(entrada.name)}-${proteger ? 'protegido' : 'sin-contrasena'}.pdf`, guardarPdf(doc,
          proteger ? { encrypt: 'aes-256', 'user-password': password, 'owner-password': password }
            : { encrypt: 'none' }));
      } else if (slug === 'aplanar-pdf') {
        if (!o['campos'] && !o['anotaciones']) throw new Error('Elige qué quieres aplanar.');
        if (!o['firmados'] && tieneFirma(doc)) throw new Error('El PDF está firmado. Aplanarlo invalida su firma; marca la opción correspondiente si quieres continuar.');
        doc.bake(Boolean(o['anotaciones']), Boolean(o['campos']));
        agregar(`${base(entrada.name)}-aplanado.pdf`, guardarPdf(doc));
      } else if (slug === 'pdf-a-imagen') {
        const ppp = ({ pantalla: 96, normal: 150, alta: 300 } as Record<string, number>)[String(o['resolucion'])] ?? 150;
        const formato = String(o['formato']);
        if (!['PNG', 'JPEG'].includes(formato)) throw new Error('Elige PNG o JPG.');
        for (let n = 0; n < doc.countPages(); n++) {
          const pagina = doc.loadPage(n);
          try {
            const [x0, y0, x1, y1] = pagina.getBounds();
            if ((x1 - x0) * (y1 - y0) * (ppp / 72) ** 2 > MAXIMO_PIXELES) {
              throw new Error('Esta página supera 20 megapíxeles. Elige una resolución menor.');
            }
            const pix = pagina.toPixmap(m.Matrix.scale(ppp / 72, ppp / 72), m.ColorSpace.DeviceRGB, false);
            try {
              const datos = formato === 'PNG' ? pix.asPNG() : pix.asJPEG(Math.max(1, Math.min(100, Number(o['calidad']) || 85)));
              agregar(`${base(entrada.name)}-${n + 1}.${formato === 'PNG' ? 'png' : 'jpg'}`,
                new Blob([datos.slice()], { type: formato === 'PNG' ? 'image/png' : 'image/jpeg' }));
            } finally { pix.destroy(); }
          } finally { pagina.destroy(); }
          avance(n + 1, doc.countPages());
        }
      } else throw new Error('Esta herramienta aún no está adaptada a Android.');
    } finally { doc.destroy(); }
    avance(i + 1, archivos.length);
  }
  return { archivos: resultados };
}

export function previsualizarPdf(m: Motor, doc: MuPDF.PDFDocument, numero: number): Blob {
  const pagina = doc.loadPage(numero - 1);
  try {
    const [x0, y0, x1, y1] = pagina.getBounds(), escala = 700 / (x1 - x0);
    if (!Number.isFinite(escala) || (x1-x0)*(y1-y0)*escala**2 > MAXIMO_PIXELES) throw new Error('La página supera el tamaño permitido para la vista previa.');
    const pix = pagina.toPixmap(m.Matrix.scale(escala, escala), m.ColorSpace.DeviceRGB, false);
    try { return new Blob([pix.asJPEG(85).slice()], { type: 'image/jpeg' }); }
    finally { pix.destroy(); }
  } finally { pagina.destroy(); }
}
