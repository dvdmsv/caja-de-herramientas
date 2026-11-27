import { Cambios } from '../pages/visor/cambios';
import { MemoriaDocumentoService } from './memoria-documento.service';

/** Dos PDF válidos de la misma longitud con el único carácter distinto en el centro. */
function documento(letra: string): File {
  const texto = 'BT /F1 12 Tf 50 50 Td (' + letra + ') Tj ET';
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + texto.length + ' >>\nstream\n' + texto + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const relleno = '%' + ' '.repeat(80000) + '\n';
  let pdf = '%PDF-1.4\n' + relleno;
  const offsets = ['0000000000 65535 f '];
  objetos.forEach((objeto, i) => {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n ');
    pdf += (i + 1) + ' 0 obj\n' + objeto + '\nendobj\n';
  });
  pdf += relleno;
  const inicio = pdf.length;
  pdf += 'xref\n0 6\n' + offsets.join('\n') + '\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + inicio + '\n%%EOF\n';
  return new File([pdf], 'informe.pdf', { type: 'application/pdf' });
}

describe('Identidad del documento', () => {
  it('dos PDF de la misma longitud y extremos recuperan sus propios borradores', async () => {
    const memoria = new MemoriaDocumentoService();
    const a = documento('A');
    const b = documento('B');
    expect(await memoria.huellaAnterior(a)).toBe(await memoria.huellaAnterior(b));
    const id = await memoria.huella(a);
    const otro = await memoria.huella(b);
    expect(otro).not.toBe(id);
    const cambios = new Cambios();
    cambios.marcar({ pagina: 1, texto: 'A', rects: [[0, 0, 0.1, 0.1]], tipo: 'subrayado', color: 'amarillo' });
    try {
      memoria.guardar(id, { pagina: 1, escala: 1, modoZoom: 'pagina', columnas: 1,
        oscuro: false, borrador: cambios.aBorrador() });
      expect(memoria.recordar(otro)).toBeNull();
      expect(memoria.recordar(await memoria.huella(a))?.borrador).toEqual(cambios.aBorrador());
    } finally {
      memoria.olvidar(id);
    }
  });
});
