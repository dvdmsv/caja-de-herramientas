import { porcentajeAhorro, sinAhorro } from './ahorro';

describe('ahorro', () => {
  it('calcula el porcentaje entero de lo que ha bajado', () => {
    expect(porcentajeAhorro({ antes: 1000, despues: 250 })).toBe(75);
  });

  it('sin datos no hay ni porcentaje ni veredicto', () => {
    expect(porcentajeAhorro(null)).toBeNull();
    expect(sinAhorro(null)).toBe(false);
    expect(sinAhorro({ antes: 0, despues: 0 })).toBe(false);
  });

  it('igual, más grande o una mejora que redondea a 0 % cuentan como sin ahorro', () => {
    expect(sinAhorro({ antes: 48_000, despues: 48_000 })).toBe(true);
    expect(sinAhorro({ antes: 1000, despues: 1200 })).toBe(true);
    expect(sinAhorro({ antes: 100_000, despues: 99_800 })).toBe(true);
    expect(sinAhorro({ antes: 1000, despues: 900 })).toBe(false);
  });
});
