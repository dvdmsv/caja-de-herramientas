import { finalDelLote, sumarResumen, textoDelLote } from './lote';

describe('lote', () => {
  it('suma lo ahorrado de cada archivo, sin contar los que no dicen nada', () => {
    let resumen = sumarResumen(null, { antes: 1000, despues: 400 });
    resumen = sumarResumen(resumen, undefined);
    resumen = sumarResumen(resumen, { antes: 500, despues: 500 });
    expect(resumen).toEqual({ antes: 1500, despues: 900 });
    expect(sumarResumen(null, null)).toBeNull();
  });

  it('no toca el resumen que le pasan', () => {
    const primero = { antes: 10, despues: 5 };
    sumarResumen(sumarResumen(null, primero), { antes: 10, despues: 5 });
    expect(primero).toEqual({ antes: 10, despues: 5 });
  });

  it('dice por qué archivo va', () => {
    expect(textoDelLote({ actual: 2, total: 5 })).toBe('Archivo 2 de 5');
  });

  it('si todo va bien, el aviso de siempre', () => {
    expect(finalDelLote(3, 3, [], false).tipo).toBe('exito');
  });

  it('si falla alguno, cuántos han salido y qué ha pasado con cada uno', () => {
    const final = finalDelLote(5, 4, [{ nombre: 'informe.pdf', mensaje: 'Está protegido con contraseña.' }], false);
    expect(final.tipo).toBe('aviso');
    expect(final.texto).toBe('4 de 5 listos. No se ha podido con informe.pdf: Está protegido con contraseña.');

    const dos = finalDelLote(3, 1, [
      { nombre: 'a.pdf', mensaje: 'Dañado' }, { nombre: 'b.pdf', mensaje: 'Demasiado grande.' },
    ], false);
    expect(dos.texto).toBe('1 de 3 listo. No se ha podido con a.pdf: Dañado. No se ha podido con b.pdf: Demasiado grande.');
  });

  it('si fallan todos, es un error', () => {
    const final = finalDelLote(2, 0, [{ nombre: 'a.pdf', mensaje: 'x' }, { nombre: 'b.pdf', mensaje: 'y' }], false);
    expect(final.tipo).toBe('error');
    expect(final.texto).toBe('No se ha podido con a.pdf: x. No se ha podido con b.pdf: y.');
  });

  it('cancelar no es un fallo: dice cuántos quedaron hechos', () => {
    expect(finalDelLote(5, 2, [], true)).toEqual({ tipo: 'info', texto: 'Lote cancelado: 2 de 5 listos.' });
  });
});
