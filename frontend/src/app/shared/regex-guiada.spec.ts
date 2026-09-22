import { Pieza, construir, describir, escapar } from './regex-guiada';

describe('armar una expresión por partes', () => {
  it('un texto y unas cifras', () => {
    const piezas: Pieza[] = [
      { clase: 'texto', valor: 'EXP' },
      { clase: 'separador', valor: 'guion' },
      { clase: 'digitos', min: 4 },
    ];
    expect(construir(piezas)).toBe('(?<![0-9A-Za-z])EXP\\-\\d{4}(?![0-9A-Za-z])');
  });

  it('un intervalo de repeticiones', () => {
    expect(construir([{ clase: 'digitos', min: 2, max: 5 }], false)).toBe('\\d{2,5}');
  });

  it('una sola repetición no lleva llaves', () => {
    expect(construir([{ clase: 'digitos', min: 1 }], false)).toBe('\\d');
  });

  it('escapa lo que en una expresión significa otra cosa', () => {
    // Sin esto, «EXP.2026» generaría un punto, que casa con cualquier cosa.
    expect(escapar('EXP.2026')).toBe('EXP\\.2026');
    expect(construir([{ clase: 'texto', valor: 'a+b' }], false)).toBe('a\\+b');
  });

  it('sin piezas no genera nada', () => {
    expect(construir([])).toBe('');
  });

  it('las letras incluyen las acentuadas y la eñe', () => {
    // Un apellido español dentro de una referencia no puede quedarse fuera.
    expect(construir([{ clase: 'letras', min: 3 }], false)).toContain('Ñ');
  });

  it('la palabra entera se marca con miradas, no con \\b', () => {
    // Es la forma que usan los patrones que ya trae el proyecto, y la que
    // entiende el `re` de Python.
    const salida = construir([{ clase: 'digitos', min: 4 }]);
    expect(salida.startsWith('(?<![0-9A-Za-z])')).toBe(true);
    expect(salida.endsWith('(?![0-9A-Za-z])')).toBe(true);
  });

  it('describe cada pieza para poder repasarla', () => {
    expect(describir({ clase: 'texto', valor: 'EXP' })).toBe('el texto «EXP»');
    expect(describir({ clase: 'digitos', min: 4 })).toBe('4 cifras');
    expect(describir({ clase: 'digitos', min: 1 })).toBe('1 cifra');
    expect(describir({ clase: 'letras', min: 2, max: 3 })).toBe('de 2 a 3 letras');
    expect(describir({ clase: 'separador', valor: 'barra' })).toBe('una barra');
    expect(describir({ clase: 'separador', valor: 'guion' })).toBe('un guion');
  });
});
