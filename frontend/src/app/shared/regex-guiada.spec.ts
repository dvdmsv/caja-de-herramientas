import {
  EJEMPLOS, MAXIMO_VECES, Pieza, construir, describir, enPalabras, escapar, fragmentos, palabrasDe, piezaNueva, recortar,
} from './regex-guiada';

const una = { modo: 'una' as const };

describe('armar una expresión por piezas', () => {
  it('un texto, un separador y unas cifras', () => {
    const piezas: Pieza[] = [
      { tipo: 'texto', valor: 'EXP', repeticion: una },
      { tipo: 'caracteres', valor: '-', repeticion: una },
      { tipo: 'cifras', repeticion: { modo: 'exacta', n: 4 } },
    ];
    expect(construir(piezas)).toBe('(?<![0-9A-Za-z])EXP\\-\\d{4}(?![0-9A-Za-z])');
    expect(construir(piezas, false)).toBe('EXP\\-\\d{4}');
  });

  it('cada repetición con su cuantificador', () => {
    const cifras = (repeticion: Pieza['repeticion']) => construir([{ tipo: 'cifras', repeticion }], false);
    expect(cifras(una)).toBe('\\d');
    expect(cifras({ modo: 'opcional' })).toBe('\\d?');
    expect(cifras({ modo: 'varias' })).toBe('\\d+');
    expect(cifras({ modo: 'exacta', n: 3 })).toBe('\\d{3}');
    expect(cifras({ modo: 'entre', n: 2, m: 5 })).toBe('\\d{2,5}');
    expect(cifras({ modo: 'entre', n: 4, m: 4 })).toBe('\\d{4}');
  });

  it('los números imposibles se ponen en razón', () => {
    expect(recortar({ modo: 'entre', n: 5, m: 2 })).toEqual({ modo: 'entre', n: 5, m: 5 });
    expect(recortar({ modo: 'exacta', n: 0 }).n).toBe(1);
    expect(recortar({ modo: 'exacta', n: 1000 }).n).toBe(MAXIMO_VECES);
    expect(recortar({ modo: 'exacta', n: Number.NaN }).n).toBe(1);
  });

  it('un texto de varias letras se repite entero, no sólo su última letra', () => {
    expect(construir([{ tipo: 'texto', valor: 'ab', repeticion: { modo: 'varias' } }], false)).toBe('(?:ab)+');
    expect(construir([{ tipo: 'texto', valor: 'a', repeticion: { modo: 'opcional' } }], false)).toBe('a?');
  });

  it('las clases de letras llevan tildes y eñe', () => {
    expect(construir([{ tipo: 'mayusculas', repeticion: una }], false)).toBe('[A-ZÁÉÍÓÚÜÑ]');
    expect(construir([{ tipo: 'minusculas', repeticion: una }], false)).toBe('[a-záéíóúüñ]');
    expect(construir([{ tipo: 'letras', repeticion: una }], false)).toContain('ñ');
  });

  it('dentro de [ ] sólo se escapa lo que ahí significa algo', () => {
    expect(construir([{ tipo: 'caracteres', valor: '/-.', repeticion: una }], false)).toBe('[/\\-.]');
    expect(construir([{ tipo: 'caracteres', valor: ']^', repeticion: una }], false)).toBe('[\\]\\^]');
    // Uno solo no necesita corchetes.
    expect(construir([{ tipo: 'caracteres', valor: '.', repeticion: una }], false)).toBe('\\.');
  });

  it('las palabras van de más larga a más corta, para que «SL» no se coma el principio de «SLU»', () => {
    const pieza: Pieza = { tipo: 'palabras', valor: 'SL, SLU, SA, SL', repeticion: una };
    expect(construir([pieza], false)).toBe('(?:SLU|SL|SA)');
    expect(palabrasDe(' S.L. ,, S.A.')).toEqual(['S.L.', 'S.A.']);
    expect(construir([{ tipo: 'palabras', valor: 'S.L.', repeticion: una }], false)).toBe('(?:S\\.L\\.)');
  });

  it('escapa lo que en una expresión significa otra cosa', () => {
    // Sin esto, «EXP.2026» generaría un punto, que casa con cualquier cosa.
    expect(escapar('EXP.2026')).toBe('EXP\\.2026');
    expect(construir([{ tipo: 'texto', valor: 'a+b', repeticion: una }], false)).toBe('a\\+b');
  });

  it('una pieza a medias no genera nada, y sin piezas no hay expresión', () => {
    expect(construir([])).toBe('');
    expect(construir([piezaNueva('texto')])).toBe('');
    expect(fragmentos([piezaNueva('texto'), piezaNueva('cifras')])).toEqual(['', '\\d']);
  });

  it('los fragmentos, juntos, son el cuerpo de la expresión', () => {
    const piezas = EJEMPLOS[0].piezas;
    expect(fragmentos(piezas).join('')).toBe(construir(piezas, false));
  });

  it('se lee como se diría', () => {
    expect(describir({ tipo: 'cifras', repeticion: { modo: 'entre', n: 2, m: 4 } })).toBe('de 2 a 4 cifras');
    expect(describir({ tipo: 'cifras', repeticion: { modo: 'opcional' } })).toBe('1 cifra, si la hay');
    expect(describir({ tipo: 'texto', valor: 'EXP', repeticion: una })).toBe('el texto «EXP»');
    expect(describir({ tipo: 'caracteres', valor: '/-', repeticion: una })).toBe('uno de / -');
    expect(describir({ tipo: 'palabras', valor: 'S.L., S.A.', repeticion: una })).toBe('una de «S.L.», «S.A.»');
    expect(enPalabras(EJEMPLOS[2].piezas)).toBe('Busca 2 mayúsculas, «-» y 4 cifras, como palabra suelta.');
    expect(enPalabras([])).toBe('');
  });

  it('los ejemplos generan lo que dicen', () => {
    const expresion = (nombre: string) => new RegExp(construir(EJEMPLOS.find(e => e.nombre === nombre)!.piezas));
    expect(expresion('Número de expediente').test('Ver EXP-2026-0001.')).toBe(true);
    expect(expresion('Fecha').test('el 12/05/2026')).toBe(true);
    expect(expresion('Referencia').test('XAB-1234')).toBe(false);
    expect(expresion('Nombre de empresa').exec('con Talleres Pérez S.L.U. y')?.[0]).toBe('Talleres Pérez S.L.U.');
  });
});
