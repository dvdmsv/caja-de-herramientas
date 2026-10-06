import {
  Medida, calcularDisposicion, escalaParaAjustar, filasVisibles, paginaEnFoco, paginaVecina,
} from './disposicion';

const medidas = (cuantas: number, ancho = 400, alto = 600): Medida[] =>
  Array.from({ length: cuantas }, (_, i) => ({ numero: i + 1, ancho, alto }));

const opciones = (extra: Partial<Parameters<typeof calcularDisposicion>[1]> = {}) => ({
  escala: 1, columnas: 1, anchoDisponible: 1000, separacion: 10, ...extra,
});

describe('disposición del visor', () => {
  it('apila las páginas con su separación', () => {
    const d = calcularDisposicion(medidas(3), opciones());
    expect(d.filas.map(f => f.top)).toEqual([10, 620, 1230]);
    expect(d.altoTotal).toBe(1840);
  });

  it('centra la página en el espacio disponible', () => {
    const d = calcularDisposicion(medidas(1), opciones());
    expect(d.filas[0].paginas[0].izquierda).toBe(300);
  });

  it('no la deja salirse cuando no cabe', () => {
    const d = calcularDisposicion(medidas(1), opciones({ anchoDisponible: 200 }));
    expect(d.filas[0].paginas[0].izquierda).toBe(10);
  });

  it('pone dos páginas por fila en vista de libro', () => {
    const d = calcularDisposicion(medidas(5), opciones({ columnas: 2 }));
    expect(d.filas.length).toBe(3);
    expect(d.filas[0].paginas.map(p => p.numero)).toEqual([1, 2]);
    expect(d.filas[2].paginas.map(p => p.numero)).toEqual([5]);
  });

  it('aplica la escala', () => {
    const d = calcularDisposicion(medidas(1), opciones({ escala: 2 }));
    expect(d.filas[0].paginas[0].ancho).toBe(800);
    expect(d.filas[0].alto).toBe(1200);
  });

  it('intercambia ancho y alto en las páginas giradas', () => {
    const d = calcularDisposicion(medidas(1), opciones({ rotaciones: new Map([[1, 90]]) }));
    expect(d.filas[0].paginas[0].ancho).toBe(600);
    expect(d.filas[0].alto).toBe(400);
  });

  it('deja fuera las páginas eliminadas', () => {
    const d = calcularDisposicion(medidas(4), opciones({ eliminadas: new Set([2, 3]) }));
    expect(d.filas.length).toBe(2);
    expect(d.filas.map(f => f.paginas[0].numero)).toEqual([1, 4]);
  });

  it('sólo monta las filas de la ventana, con su margen', () => {
    const d = calcularDisposicion(medidas(50), opciones());
    // Se ven las filas 9 a 11; con el margen de una por lado, se montan 8 a 12.
    const [desde, hasta] = filasVisibles(d, 6100, 900);
    expect(desde).toBe(8);
    expect(hasta).toBe(12);
  });

  it('la ventana no se sale por los extremos', () => {
    const d = calcularDisposicion(medidas(3), opciones());
    expect(filasVisibles(d, 0, 900)).toEqual([0, 2]);
    expect(filasVisibles(d, 99999, 900)).toEqual([1, 2]);
  });

  it('con el documento vacío no devuelve ninguna fila', () => {
    const d = calcularDisposicion([], opciones());
    expect(filasVisibles(d, 0, 900)).toEqual([0, -1]);
  });

  it('sabe qué página se está mirando', () => {
    const d = calcularDisposicion(medidas(10), opciones());
    expect(paginaEnFoco(d, 0, 900)).toBe(1);
    expect(paginaEnFoco(d, 1250, 900)).toBe(3);
  });

  it('calcula la escala para ajustar a ancho y a página', () => {
    const medida = { numero: 1, ancho: 400, alto: 600 };
    expect(escalaParaAjustar(medida, 0, 820, 5000, 'ancho', 10)).toBe(2);
    // A página manda el alto: (620-20)/600 = 1.
    expect(escalaParaAjustar(medida, 0, 820, 620, 'pagina', 10)).toBe(1);
  });
});

describe('modos de lectura', () => {
  const cinco = medidas(5, 100, 140);
  const base = { escala: 1, anchoDisponible: 800, separacion: 10 };

  it('libro: la portada sola y luego de dos en dos', () => {
    const { filas } = calcularDisposicion(cinco, { ...base, columnas: 2, portada: true });
    expect(filas.map(f => f.paginas.map(p => p.numero))).toEqual([[1], [2, 3], [4, 5]]);
  });

  it('página a página: sólo la pedida', () => {
    const { filas } = calcularDisposicion(cinco, { ...base, columnas: 1, solo: 3 });
    expect(filas.map(f => f.paginas.map(p => p.numero))).toEqual([[3]]);
  });

  it('página a página sobre una quitada: la primera que queda', () => {
    const { filas } = calcularDisposicion(cinco,
      { ...base, columnas: 1, solo: 1, eliminadas: new Set([1]) });
    expect(filas[0].paginas[0].numero).toBe(2);
  });

  it('siguiente y anterior según el modo', () => {
    const numeros = [1, 2, 3, 4, 5];
    const ninguna = new Set<number>();
    expect(paginaVecina(numeros, ninguna, 1, 1, 'libro')).toBe(2);
    expect(paginaVecina(numeros, ninguna, 2, 1, 'libro')).toBe(4);
    expect(paginaVecina(numeros, ninguna, 3, -1, 'libro')).toBe(1);
    expect(paginaVecina(numeros, ninguna, 1, 1, 'dos')).toBe(3);
    expect(paginaVecina(numeros, ninguna, 5, 1, 'pagina')).toBe(5);
    expect(paginaVecina(numeros, new Set([2]), 1, 1, 'pagina')).toBe(3);
  });
});
