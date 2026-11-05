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

/**
 * En MuPDF.js una clave que falta devuelve el null de PDF, y pedirle a ése otra
 * clave lanza. Esto baja clave a clave y se para en lo primero que no sea un
 * diccionario; quien lo usa mira después si es lo que esperaba.
 */
function bajar(obj: MuPDF.PDFObject, ...claves: string[]): MuPDF.PDFObject {
  let actual = obj;
  for (const clave of claves) {
    if (!actual.isDictionary()) return actual;
    actual = actual.get(clave);
  }
  return actual;
}

/** Busca un destino con nombre en el árbol `Names/Dests` (PDF 1.2+) o en el diccionario `Dests` (1.1). */
function destinoConNombre(doc: MuPDF.PDFDocument, nombre: string): MuPDF.PDFObject | null {
  const raiz = doc.getTrailer().get('Root');
  const antiguo = raiz.get('Dests');
  if (antiguo.isDictionary() && !antiguo.get(nombre).isNull()) return antiguo.get(nombre);
  const buscar = (nodo: MuPDF.PDFObject, profundidad: number): MuPDF.PDFObject | null => {
    if (!nodo.isDictionary() || profundidad > 32) return null;
    const nombres = nodo.get('Names');
    for (let k = 0; nombres.isArray() && k + 1 < nombres.length; k += 2) {
      if (nombres.get(k).asString() === nombre) return nombres.get(k + 1);
    }
    const hijos = nodo.get('Kids');
    for (let k = 0; hijos.isArray() && k < hijos.length; k++) {
      const hallado = buscar(hijos.get(k), profundidad + 1);
      if (hallado) return hallado;
    }
    return null;
  };
  return buscar(bajar(raiz, 'Names', 'Dests'), 0);
}

/**
 * Los enlaces internos que van a un destino con nombre apuntarían, tras unir,
 * a un nombre que ya no existe: el árbol de nombres es del catálogo, no de las
 * páginas. Se cambian por el destino explícito, con su posición exacta, antes
 * de injertar; las referencias a páginas sí las traslada el GraftMap.
 */
function explicitarDestinos(doc: MuPDF.PDFDocument): void {
  for (let n = 0; n < doc.countPages(); n++) {
    const anotaciones = doc.findPage(n).get('Annots');
    for (let k = 0; anotaciones.isArray() && k < anotaciones.length; k++) {
      const enlace = anotaciones.get(k);
      if (!enlace.isDictionary() || enlace.get('Subtype').asName() !== 'Link') continue;
      const accion = enlace.get('A');
      const enAccion = enlace.get('Dest').isNull() && accion.isDictionary() && accion.get('S').asName() === 'GoTo';
      const destino = enAccion ? accion.get('D') : enlace.get('Dest');
      if (!destino.isString() && !destino.isName()) continue;
      let explicito = destinoConNombre(doc, destino.isString() ? destino.asString() : destino.asName());
      if (explicito?.isDictionary()) explicito = explicito.get('D');
      if (!explicito?.isArray()) continue;
      if (enAccion) accion.put('D', explicito); else enlace.put('Dest', explicito);
    }
  }
}

/**
 * `graftPage` de MuPDF copia de la página el contenido, los recursos y las
 * cajas, pero **no `Annots`**: los enlaces, las notas y los widgets de los
 * formularios se perdían al unir (por eso antes se rechazaban esos PDF). Se
 * injertan aquí con el mismo mapa. Lo que apunta a una página del original —el
 * destino de un enlace, el `/P` de cada anotación— no se puede injertar tal
 * cual, porque copiaría esa página como un objeto suelto: se cambia antes por
 * su número y después por la página nueva que le corresponde.
 */
function injertarAnotaciones(salida: MuPDF.PDFDocument, doc: MuPDF.PDFDocument, mapa: MuPDF.PDFGraftMap,
  desplazamiento: number): void {
  const numeroDe = new Map<number, number>();
  for (let n = 0; n < doc.countPages(); n++) numeroDe.set(doc.findPage(n).asIndirect(), n);
  const paginaDe = (ref: MuPDF.PDFObject) => ref.isIndirect() ? numeroDe.get(ref.asIndirect()) : undefined;
  for (let n = 0; n < doc.countPages(); n++) {
    const original = doc.findPage(n).get('Annots');
    if (!original.isArray() || !original.length) continue;
    // Los destinos que llevan una página, con el número al que apuntan.
    const pendientes: { anotacion: number; clave: 'Dest' | 'A'; pagina: number }[] = [];
    for (let k = 0; k < original.length; k++) {
      const anotacion = original.get(k);
      if (!anotacion.isDictionary()) continue;
      anotacion.delete('P');
      const accion = anotacion.get('A');
      const candidatos: ['Dest' | 'A', MuPDF.PDFObject][] = [['Dest', anotacion.get('Dest')]];
      if (accion.isDictionary() && accion.get('S').asName() === 'GoTo') candidatos.push(['A', accion.get('D')]);
      for (const [clave, destino] of candidatos) {
        if (!destino.isArray() || !destino.length) continue;
        const pagina = paginaDe(destino.get(0));
        if (pagina === undefined) continue;
        destino.put(0, pagina);
        pendientes.push({ anotacion: k, clave, pagina });
      }
    }
    const injertadas = mapa.graftObject(original);
    const nueva = salida.findPage(desplazamiento + n);
    nueva.put('Annots', injertadas);
    for (let k = 0; k < injertadas.length; k++) {
      const anotacion = injertadas.get(k);
      if (anotacion.isDictionary()) anotacion.put('P', nueva);
    }
    for (const { anotacion, clave, pagina } of pendientes) {
      const a = injertadas.get(anotacion);
      const destino = clave === 'Dest' ? a.get('Dest') : a.get('A').get('D');
      destino.put(0, salida.findPage(desplazamiento + pagina));
    }
  }
}

/**
 * Junta el formulario de `doc` con el de `salida`, a través del mismo GraftMap
 * que sus páginas: así los campos injertados son los mismos objetos que los
 * widgets de esas páginas, y no copias sueltas. Es lo que hace en el servidor
 * `insert_pdf(widgets=True)`. Un nombre de campo que ya exista se renombra
 * («firmante» → «firmante_2»): dos campos con el mismo nombre comparten valor,
 * y al unir dos veces el mismo impreso se rellenarían a la vez.
 */
function unirFormulario(salida: MuPDF.PDFDocument, doc: MuPDF.PDFDocument, mapa: MuPDF.PDFGraftMap,
  nombres: Set<string>): void {
  const formulario = bajar(doc.getTrailer(), 'Root', 'AcroForm');
  if (!formulario.isDictionary()) return;
  const campos = formulario.get('Fields');
  if (!campos.isArray() || !campos.length) return;
  const raiz = salida.getTrailer().get('Root');
  let destino = raiz.get('AcroForm');
  if (destino.isNull()) {
    destino = salida.addObject(salida.newDictionary());
    destino.put('Fields', salida.newArray());
    raiz.put('AcroForm', destino);
  }
  const todos = destino.get('Fields');
  for (let k = 0; k < campos.length; k++) {
    const campo = mapa.graftObject(campos.get(k));
    const t = campo.get('T');
    if (t.isString()) {
      let nombre = t.asString();
      if (nombres.has(nombre)) {
        let n = 2;
        while (nombres.has(`${nombre}_${n}`)) n++;
        nombre = `${nombre}_${n}`;
        campo.put('T', salida.newString(nombre));
      }
      nombres.add(nombre);
    }
    todos.push(campo);
  }
  // Aspecto por defecto y recursos: los del primero que los traiga; las
  // fuentes de los siguientes se añaden si su nombre no está ya.
  for (const clave of ['DA', 'Q']) {
    if (destino.get(clave).isNull() && !formulario.get(clave).isNull()) destino.put(clave, mapa.graftObject(formulario.get(clave)));
  }
  const recursos = formulario.get('DR');
  if (recursos.isDictionary()) {
    if (destino.get('DR').isNull()) destino.put('DR', mapa.graftObject(recursos));
    else {
      const fuentes = recursos.get('Font');
      let propias = bajar(destino, 'DR', 'Font');
      if (propias.isNull() && fuentes.isDictionary()) { propias = salida.newDictionary(); destino.get('DR').put('Font', propias); }
      if (fuentes.isDictionary()) fuentes.forEach((fuente, nombre) => {
        if (propias.get(String(nombre)).isNull()) propias.put(String(nombre), mapa.graftObject(fuente));
      });
    }
  }
  if (formulario.get('NeedAppearances').asBoolean()) destino.put('NeedAppearances', true);
  const banderas = formulario.get('SigFlags');
  if (banderas.isNumber()) destino.put('SigFlags', Math.max(banderas.asNumber(), destino.get('SigFlags').isNumber() ? destino.get('SigFlags').asNumber() : 0));
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
    const nombres = new Set<string>();
    try {
      for (let i = 0; i < archivos.length; i++) {
        const doc = await abrirPdf(m, archivos[i]);
        try {
          explicitarDestinos(doc);
          const desplazamiento = salida.countPages();
          const trasladar = (e: EntradaIndice): EntradaIndice => ({ ...e,
            page: e.page === undefined ? undefined : e.page + desplazamiento, down: e.down?.map(trasladar) });
          indice.push(...(doc.loadOutline() ?? []).map(trasladar));
          const mapa = salida.newGraftMap();
          try {
            for (let n = 0; n < doc.countPages(); n++) mapa.graftPage(-1, doc, n);
            injertarAnotaciones(salida, doc, mapa, desplazamiento);
            unirFormulario(salida, doc, mapa, nombres);
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
