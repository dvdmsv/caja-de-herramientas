import { fechaConZona, fechaParaEntrada } from './fecha';

describe('fecha explícita de la marca visible', () => {
  it('conserva el instante en UTC y en la zona del equipo', () => {
    const ahora = new Date('2026-10-08T10:30:45Z');
    for (const zona of ['local', 'utc'] as const) {
      const entrada = fechaParaEntrada(ahora, zona);
      expect(new Date(fechaConZona(entrada, zona)).getTime()).toBe(ahora.getTime());
    }
    expect(fechaConZona('2026-10-08T10:30:45', 'utc')).toBe('2026-10-08T10:30:45+00:00');
  });

  it('completa los segundos y rechaza fechas normalizadas o inválidas', () => {
    expect(fechaConZona('2026-10-08T10:30', 'utc')).toBe('2026-10-08T10:30:00+00:00');
    for (const entrada of ['', 'mañana', '2026-02-30T10:00', '2026-10-08T25:00']) {
      expect(fechaConZona(entrada, 'utc')).toBe('');
      expect(fechaConZona(entrada, 'local')).toBe('');
    }
  });
});


// Esta comprobación se ejecuta también con TZ=Europe/Madrid en desarrollo.
describe('cambios de horario de la zona del equipo', () => {
  it('calcula el desplazamiento para la fecha manual, incluyendo horario de verano', () => {
    for (const entrada of ['2026-01-08T16:00:00', '2026-07-08T16:00:00']) {
      const explicita = fechaConZona(entrada, 'local');
      expect(new Date(explicita).getTime()).toBe(new Date(entrada).getTime());
    }
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Madrid') {
      expect(fechaConZona('2026-01-08T16:00:00', 'local')).toContain('+01:00');
      expect(fechaConZona('2026-07-08T16:00:00', 'local')).toContain('+02:00');
      expect(fechaConZona('2026-03-29T02:30:00', 'local')).toBe('');
    }
  });
});
