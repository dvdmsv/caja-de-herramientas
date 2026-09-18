import { repartirSubida } from './subida';

/** Lo poco que la función necesita de un archivo del servidor. */
const servidor = (id: string) => ({ id, name: `${id}.pdf`, size: 10, generated: false });
const rechazo = (indice: number, motivo = 'no vale') =>
  ({ indice, name: `${indice}.pdf`, error: motivo });

describe('repartir una subida entre lo admitido y lo rechazado', () => {
  it('sin rechazados, cada archivo con su identificador y en orden', () => {
    const reparto = repartirSubida(['a', 'b', 'c'],
                                   [servidor('1'), servidor('2'), servidor('3')], []);

    expect(reparto.admitidos).toEqual([
      { item: 'a', id: '1' }, { item: 'b', id: '2' }, { item: 'c', id: '3' },
    ]);
    expect(reparto.descartados).toEqual([]);
  });

  it('con uno rechazado en medio, los de después NO se desplazan', () => {
    // Es el fallo que no avisa: sin descontar la posición del rechazado, «c»
    // se quedaría con el identificador de «b» y se comprimiría otro documento.
    const reparto = repartirSubida(['a', 'b', 'c'],
                                   [servidor('1'), servidor('3')], [rechazo(1)]);

    expect(reparto.admitidos).toEqual([{ item: 'a', id: '1' }, { item: 'c', id: '3' }]);
    expect(reparto.descartados).toEqual([{ item: 'b', error: 'no vale' }]);
  });

  it('el rechazado puede ser el primero o el último', () => {
    expect(repartirSubida(['a', 'b'], [servidor('2')], [rechazo(0)]).admitidos)
      .toEqual([{ item: 'b', id: '2' }]);
    expect(repartirSubida(['a', 'b'], [servidor('1')], [rechazo(1)]).admitidos)
      .toEqual([{ item: 'a', id: '1' }]);
  });

  it('con varios rechazados salteados', () => {
    const reparto = repartirSubida(['a', 'b', 'c', 'd', 'e'],
                                   [servidor('2'), servidor('4')],
                                   [rechazo(0), rechazo(2), rechazo(4)]);

    expect(reparto.admitidos).toEqual([{ item: 'b', id: '2' }, { item: 'd', id: '4' }]);
    expect(reparto.descartados.map(d => d.item)).toEqual(['a', 'c', 'e']);
  });

  it('si no se admite ninguno, no se empareja nada', () => {
    const reparto = repartirSubida(['a', 'b'], [], [rechazo(0), rechazo(1)]);

    expect(reparto.admitidos).toEqual([]);
    expect(reparto.descartados.map(d => d.item)).toEqual(['a', 'b']);
  });

  it('si el servidor devuelve menos de los que tocaban, nadie toma prestado un id ajeno', () => {
    const reparto = repartirSubida(['a', 'b', 'c'], [servidor('1')], []);

    expect(reparto.admitidos).toEqual([{ item: 'a', id: '1' }]);
    expect(reparto.descartados).toEqual([]);
  });

  it('un índice rechazado que no existe en la cola se ignora', () => {
    const reparto = repartirSubida(['a'], [servidor('1')], [rechazo(7)]);

    expect(reparto.admitidos).toEqual([{ item: 'a', id: '1' }]);
    expect(reparto.descartados).toEqual([]);
  });
});
