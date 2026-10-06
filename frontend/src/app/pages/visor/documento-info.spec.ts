import { etiquetasUtiles, paginaDeEtiqueta, propiedades, tamanoDePagina } from './documento-info';

describe('tamanoDePagina', () => {
  it('reconoce A4 en las dos orientaciones', () => {
    expect(tamanoDePagina(595, 842)).toBe('A4 vertical (210 × 297 mm)');
    expect(tamanoDePagina(842, 595)).toBe('A4 apaisado (297 × 210 mm)');
  });

  it('Carta, con el redondeo de los puntos', () => {
    expect(tamanoDePagina(612, 792)).toBe('Carta vertical (216 × 279 mm)');
  });

  it('sin nombre, sólo las medidas', () => {
    expect(tamanoDePagina(500, 500)).toBe('176 × 176 mm');
  });
});

describe('propiedades', () => {
  const base = {
    info: { Title: 'Informe', Author: '  ', PDFFormatVersion: '1.7', IsLinearized: false },
    creado: new Date(2024, 0, 15, 10, 30),
    modificado: null,
    etiquetado: true,
    paginas: 12,
    ancho: 595,
    alto: 842,
    peso: 1536,
  };

  it('las vacías no salen', () => {
    const nombres = propiedades(base).map(fila => fila.nombre);
    expect(nombres).toContain('Título');
    expect(nombres).not.toContain('Autor');
    expect(nombres).not.toContain('Modificado');
  });

  it('con sus valores en texto', () => {
    const valor = (nombre: string) => propiedades(base).find(fila => fila.nombre === nombre)?.valor;
    expect(valor('Peso')).toBe('1,5 KB');
    expect(valor('Etiquetado (accesible)')).toBe('Sí');
    expect(valor('Optimizado para la web')).toBe('No');
    expect(valor('Creado')).toContain('2024');
  });
});

describe('etiquetas de página', () => {
  const etiquetas = ['i', 'ii', 'A-1', 'A-2'];

  it('por su etiqueta, sin distinguir mayúsculas', () => {
    expect(paginaDeEtiqueta('II', etiquetas, 4)).toBe(2);
    expect(paginaDeEtiqueta('a-2', etiquetas, 4)).toBe(4);
  });

  it('si no es una etiqueta, por su número', () => {
    expect(paginaDeEtiqueta('3', etiquetas, 4)).toBe(3);
    expect(paginaDeEtiqueta('9', etiquetas, 4)).toBeNull();
    expect(paginaDeEtiqueta('xyz', etiquetas, 4)).toBeNull();
  });

  it('las que repiten el número no aportan nada', () => {
    expect(etiquetasUtiles(['1', '2', '3'])).toBeNull();
    expect(etiquetasUtiles(etiquetas)).toBe(etiquetas);
    expect(etiquetasUtiles(null)).toBeNull();
  });
});
