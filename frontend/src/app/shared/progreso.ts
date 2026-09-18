/**
 * Cómo se lee el parte de un trabajo: porcentaje, etiqueta y detalle.
 *
 * Lógica pura y con tests propios, como `ahorro.ts` o `subida.ts`: aquí no hay
 * DOM ni peticiones, sólo la cuenta. Es donde están las tres decisiones que se
 * ven en pantalla:
 *
 * - **No se predice** cuánto queda. Se dice por dónde va y cuánto lleva, que es
 *   lo que se sabe; un «quedan 20 s» que luego son dos minutos es peor que no
 *   decir nada.
 * - Un trabajo **estimado** —los que son una sola llamada a un programa externo
 *   y no tienen pasos que contar— no pasa del 95 % hasta que hay respuesta. Una
 *   barra clavada en el 100 % miente más que una clavada en el 95.
 * - **Mientras no hay parte, el trabajo está en la cola**, y eso se dice: es
 *   información, no un hueco.
 */

/** El parte tal y como lo escribe el servidor (`backend/api/progreso.py`). */
export interface EstadoTrabajo {
  modo: 'pasos' | 'estimado';
  etapa: string;
  /** Cuándo empezó el trabajo, según el reloj del servidor. */
  desde: number;
  cancelable: boolean;
  hechos?: number;
  total?: number;
  /** Segundos que el servidor cree que va a tardar. Sólo en `estimado`. */
  estimado?: number;
}

export interface AvanceTrabajo {
  /** 0 a 100; no significa nada si `indeterminado`. */
  porcentaje: number;
  /** No se puede saber por dónde va: la barra se anima sin cifra. */
  indeterminado: boolean;
  etapa: string;
  /** Lo que acompaña a la etapa: «7 de 40 · lleva 12 s». */
  detalle: string;
}

/** Tope de lo estimado: el 100 % lo pone la respuesta, no el reloj. */
export const TOPE_ESTIMADO = 95;

export function avance(estado: EstadoTrabajo | null, transcurridoMs: number): AvanceTrabajo {
  const transcurrido = textoTranscurrido(transcurridoMs);

  if (!estado) {
    return {
      porcentaje: 0,
      indeterminado: true,
      etapa: 'Esperando turno',
      detalle: 'Hay otros trabajos por delante.',
    };
  }

  if (estado.modo === 'estimado') {
    const estimado = Math.max(1, estado.estimado ?? 1) * 1000;
    const bruto = Math.round((transcurridoMs / estimado) * 100);
    return {
      porcentaje: Math.min(TOPE_ESTIMADO, Math.max(0, bruto)),
      indeterminado: false,
      etapa: estado.etapa,
      detalle: transcurrido,
    };
  }

  const total = estado.total ?? 0;
  const hechos = Math.min(Math.max(0, estado.hechos ?? 0), total || Number.MAX_SAFE_INTEGER);
  if (total <= 0) {
    // Una etapa que es una sola llamada —maquetar, guardar— no tiene pasos.
    return { porcentaje: 0, indeterminado: true, etapa: estado.etapa, detalle: transcurrido };
  }

  return {
    porcentaje: Math.min(100, Math.round((hechos / total) * 100)),
    indeterminado: false,
    etapa: estado.etapa,
    detalle: `${hechos} de ${total} · ${transcurrido}`,
  };
}

/** «lleva 12 s», «lleva 1 min 12 s». Cuenta lo que ha pasado, no lo que falta. */
export function textoTranscurrido(transcurridoMs: number): string {
  const segundos = Math.max(0, Math.floor(transcurridoMs / 1000));
  if (segundos < 60) {
    return `lleva ${segundos} s`;
  }
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto === 0 ? `lleva ${minutos} min` : `lleva ${minutos} min ${resto} s`;
}
