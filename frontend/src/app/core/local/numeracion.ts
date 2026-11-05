import type * as MuPDF from 'mupdf';
import type { OpcionesMotor } from './tipos';

/** Coordenadas visuales de página; incluye CropBox, Rotate y UserUnit. */
export function numerar(m: typeof MuPDF, doc: MuPDF.PDFDocument, o: OpcionesMotor, solo?: number, textoFijo?: string): void {
  const entero = (clave: string, defecto: number, min: number, max: number) => {
    const n = o[clave] === undefined ? defecto : Number(o[clave]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`El valor de ${clave} no es válido.`);
    return n;
  };
  const opcion = (clave: string, defecto: string, valores: string[]) => {
    const s = String(o[clave] ?? defecto);
    if (!valores.includes(s)) throw new Error(`El valor de ${clave} no es válido.`);
    return s;
  };
  const desde = entero('desde', 1, 1, 100000), inicio = entero('empezar_en', 1, 1, 100000);
  const size = entero('tamano', 10, 6, 96), margen = entero('margen', 15, 5, 30) * 72 / 25.4;
  const borde = opcion('borde', 'abajo', ['arriba', 'abajo']);
  const alineacion = opcion('alineacion', 'centro', ['izquierda', 'centro', 'derecha']);
  const formato = opcion('formato', 'numero', ['numero', 'de-total', 'pagina-de-total']);
  const familia = opcion('fuente', 'sans', ['sans', 'serif', 'mono']);
  const color = opcion('color', 'negro', ['negro', 'azul', 'rojo']);
  if (desde > doc.countPages()) throw new Error('La primera página numerada no existe.');
  const font = new m.Font(({ sans: 'Helvetica', serif: 'Times-Roman', mono: 'Courier' })[familia]!);
  try {
    const recurso = doc.addSimpleFont(font);
    try {
      for (let n = desde; n <= doc.countPages(); n++) {
        if (solo !== undefined && n !== solo) continue;
        const pagina = doc.loadPage(n - 1), objeto = doc.findPage(n - 1);
        try {
          const numero = n - desde + inicio, total = doc.countPages() - desde + inicio;
          const texto = textoFijo ?? (formato === 'numero' ? `${numero}` : `${formato === 'pagina-de-total' ? 'Página ' : ''}${numero} de ${total}`);
          const ancho = [...texto].reduce((sum, c) => sum + font.advanceGlyph(font.encodeCharacter(c)) * size, 0);
          const [x0, y0, x1, y1] = pagina.getBounds();
          if (ancho > x1 - x0 - 2 * margen) throw new Error('El texto no cabe en la página. Reduce el tamaño o el margen.');
          const x = alineacion === 'izquierda' ? x0 + margen : alineacion === 'derecha' ? x1 - margen - ancho : (x0 + x1 - ancho) / 2;
          const y = borde === 'arriba' ? y0 + margen + size : y1 - margen;
          let recursos = objeto.getInheritable('Resources');
          if (recursos.isNull()) { recursos = doc.newDictionary(); objeto.put('Resources', recursos); }
          let fuentes = recursos.get('Font');
          if (fuentes.isNull()) { fuentes = doc.newDictionary(); recursos.put('Font', fuentes); }
          let nombre = 'CajaNumeracion';
          while (!fuentes.get(nombre).isNull()) nombre += '_';
          fuentes.put(nombre, recurso);
          const rgb = color === 'azul' ? [26/255,63/255,208/255] : color === 'rojo' ? [200/255,30/255,30/255] : [0,0,0];
          const hex = [...texto].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
          const stream = doc.addStream(`Q q ${m.Matrix.invert(pagina.getTransform()).join(' ')} cm BT /${nombre} ${size} Tf ${rgb.join(' ')} rg 1 0 0 -1 ${x} ${y} Tm <${hex}> Tj ET Q`, {});
          const contenidos = doc.newArray(), anterior = objeto.get('Contents'), save = doc.addStream('q\n', {});
          contenidos.push(save);
          if (anterior.isArray()) for (let k = 0; k < anterior.length; k++) contenidos.push(anterior.get(k));
          else if (!anterior.isNull()) contenidos.push(anterior);
          contenidos.push(stream); objeto.put('Contents', contenidos);
          contenidos.destroy(); anterior.destroy(); save.destroy(); stream.destroy(); fuentes.destroy(); recursos.destroy();
        } finally { pagina.destroy(); objeto.destroy(); }
      }
    } finally { recurso.destroy(); }
  } finally { font.destroy(); }
}
