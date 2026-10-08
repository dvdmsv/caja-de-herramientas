/** Un instante explícito: el servidor nunca tiene que adivinar la zona. */
export type ZonaFecha = 'local' | 'utc';

export function fechaParaEntrada(fecha: Date, zona: ZonaFecha): string {
  const desplazada = new Date(fecha.getTime() - (zona === 'local' ? fecha.getTimezoneOffset() * 60_000 : 0));
  return desplazada.toISOString().slice(0, 19);
}

export function fechaConZona(valor: string, zona: ZonaFecha): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(valor)) {
    return '';
  }
  const fecha = new Date(valor + (zona === 'utc' ? 'Z' : ''));
  if (!Number.isFinite(fecha.getTime())) {
    return '';
  }
  const completo = valor.length === 16 ? valor + ':00' : valor;
  // Rechazar fechas normalizadas y horas inexistentes en el cambio de horario.
  if (fechaParaEntrada(fecha, zona) !== completo) {
    return '';
  }
  const minutos = zona === 'utc' ? 0 : -fecha.getTimezoneOffset();
  const signo = minutos < 0 ? '-' : '+';
  const horas = String(Math.floor(Math.abs(minutos) / 60)).padStart(2, '0');
  const resto = String(Math.abs(minutos) % 60).padStart(2, '0');
  return completo + signo + horas + ':' + resto;
}
