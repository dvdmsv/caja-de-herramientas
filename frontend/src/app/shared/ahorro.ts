import { ResumenTamano } from '../core/api.service';

/**
 * Cuánto ha adelgazado un archivo, en porcentaje entero, o `null` si no hay
 * datos o no ha bajado nada que se note (redondeado a 0 % o menos).
 */
export function porcentajeAhorro(resumen: ResumenTamano | null | undefined): number | null {
  if (!resumen?.antes) {
    return null;
  }
  const porcentaje = Math.round(100 * (1 - resumen.despues / resumen.antes));
  return porcentaje > 0 ? porcentaje : null;
}

/**
 * Si una herramienta que promete aligerar no ha conseguido nada.
 *
 * El servidor ya devuelve el original cuando comprimir no gana (nadie quiere una
 * versión peor), pero celebrarlo con un "¡listo!" en verde era mentir: aquí se
 * distingue para decir que ya estaba optimizado.
 */
export function sinAhorro(resumen: ResumenTamano | null | undefined): boolean {
  return !!resumen?.antes && porcentajeAhorro(resumen) === null;
}
