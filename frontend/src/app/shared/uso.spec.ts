import { horaDeBorrado, nivelDeUso, porcentajeDeUso } from './uso';

describe('nivelDeUso', () => {
  const GB = 1024 ** 3;

  it('es normal por debajo de tres cuartos', () => {
    expect(nivelDeUso(0, GB)).toBe('normal');
    expect(nivelDeUso(GB * 0.74, GB)).toBe('normal');
  });

  it('avisa desde el 75 % y se pone en rojo desde el 90 %', () => {
    expect(nivelDeUso(GB * 0.75, GB)).toBe('apurado');
    expect(nivelDeUso(GB * 0.89, GB)).toBe('apurado');
    expect(nivelDeUso(GB * 0.9, GB)).toBe('lleno');
    expect(nivelDeUso(GB * 2, GB)).toBe('lleno');
  });

  it('no se asusta con un tope que no ha llegado', () => {
    expect(nivelDeUso(100, 0)).toBe('normal');
  });
});

describe('porcentajeDeUso', () => {
  it('redondea, pero enseña al menos un 1 % si hay algo', () => {
    expect(porcentajeDeUso(0, 1000)).toBe(0);
    expect(porcentajeDeUso(1, 1000)).toBe(1);
    expect(porcentajeDeUso(505, 1000)).toBe(51);
  });

  it('no pasa de 100', () => {
    expect(porcentajeDeUso(3000, 1000)).toBe(100);
    expect(porcentajeDeUso(10, 0)).toBe(0);
  });
});

describe('horaDeBorrado', () => {
  it('sólo la hora si es hoy', () => {
    const ahora = new Date(2026, 8, 23, 10, 30);
    const caduca = new Date(2026, 8, 23, 12, 40).getTime() / 1000;
    expect(horaDeBorrado(caduca, ahora)).toBe('las 12:40');
  });

  it('con el día si cae en otro', () => {
    const ahora = new Date(2026, 8, 23, 23, 30);
    const caduca = new Date(2026, 8, 24, 1, 30).getTime() / 1000;
    expect(horaDeBorrado(caduca, ahora)).toBe('el jueves 24 a las 01:30');
  });
});
