import { IndiceTexto, normalizar } from './buscador';

const fragmentos = (...trozos: string[]) => trozos.map(str => ({ str }));

describe('buscador del visor', () => {
  it('quita tildes y mayúsculas sin cambiar la longitud', () => {
    expect(normalizar('Petición')).toBe('peticion');
    expect(normalizar('Petición').length).toBe('Petición'.length);
    expect(normalizar('ÁÉÍÓÚÜÑ')).toBe('aeiouun');
  });

  it('encuentra sin tildes lo que está con tildes', () => {
    const indice = new IndiceTexto();
    indice.anadir(1, fragmentos('El plazo de la petición es de diez días'));
    expect(indice.buscar('peticion').length).toBe(1);
    expect(indice.buscar('PETICIÓN').length).toBe(1);
  });

  it('encuentra palabras que cruzan dos fragmentos', () => {
    const indice = new IndiceTexto();
    // pdf.js parte el texto donde le conviene, y no mete el espacio.
    indice.anadir(1, fragmentos('el plazo', 'de entrega'));
    const encontradas = indice.buscar('plazo de entrega');
    expect(encontradas.length).toBe(1);
    expect(encontradas[0].fragmentos).toEqual([0, 1]);
  });

  it('devuelve todas las apariciones, en orden de página', () => {
    const indice = new IndiceTexto();
    indice.anadir(2, fragmentos('contrato y contrato'));
    indice.anadir(1, fragmentos('contrato'));
    const encontradas = indice.buscar('contrato');
    expect(encontradas.length).toBe(3);
    expect(encontradas.map(c => c.pagina)).toEqual([1, 2, 2]);
  });

  it('trae contexto alrededor de la coincidencia', () => {
    const indice = new IndiceTexto();
    indice.anadir(1, fragmentos('lo que sea antes de la palabra buscada y lo que venga después'));
    expect(indice.buscar('buscada')[0].contexto).toContain('buscada');
  });

  it('ignora búsquedas demasiado cortas', () => {
    const indice = new IndiceTexto();
    indice.anadir(1, fragmentos('algo de texto'));
    expect(indice.buscar('a')).toEqual([]);
    expect(indice.buscar('  ')).toEqual([]);
  });

  it('sabe qué páginas lleva indexadas', () => {
    const indice = new IndiceTexto();
    indice.anadir(3, fragmentos('hola'));
    expect(indice.tiene(3)).toBe(true);
    expect(indice.tiene(4)).toBe(false);
    expect(indice.indexadas).toBe(1);
  });
});

describe('opciones del buscador', () => {
  const indice = new IndiceTexto();
  indice.anadir(1, [{ str: 'Los plazos del Plazo y el plazo.' }]);

  it('palabra entera: no encuentra dentro de otra', () => {
    expect(indice.buscar('plazo').length).toBe(3);
    expect(indice.buscar('plazo', { palabraEntera: true }).length).toBe(2);
  });

  it('distinguiendo mayúsculas', () => {
    expect(indice.buscar('Plazo', { mayusculas: true }).length).toBe(1);
  });

  it('dice qué letras de cada fragmento son de la coincidencia', () => {
    const otro = new IndiceTexto();
    otro.anadir(1, [{ str: 'el plazo' }, { str: 'de entrega' }]);
    const [c] = otro.buscar('plazo de');
    expect(c.trozos).toEqual([
      { indice: 0, desde: 3, hasta: 8 },
      { indice: 1, desde: 0, hasta: 2 },
    ]);
  });
});
