/** Lo que cuesta pintar el uso de la sesión, sin Angular, para poder probarlo. */

export type NivelDeUso = 'normal' | 'apurado' | 'lleno';

/** A partir de tres cuartos conviene avisar, no cuando ya no cabe nada. */
export const UMBRAL_APURADO = 0.75;
/** Y a partir de aquí, cualquier resultado un poco grande ya no cabe. */
export const UMBRAL_LLENO = 0.9;

export function nivelDeUso(usado: number, tope: number): NivelDeUso {
  if (tope <= 0) {
    return 'normal';
  }
  const fraccion = usado / tope;
  if (fraccion >= UMBRAL_LLENO) {
    return 'lleno';
  }
  return fraccion >= UMBRAL_APURADO ? 'apurado' : 'normal';
}

/** El porcentaje entero para la barra: nunca 0 si hay algo, nunca más de 100. */
export function porcentajeDeUso(usado: number, tope: number): number {
  if (tope <= 0 || usado <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(1, Math.round((usado / tope) * 100)));
}

/**
 * Desde cuándo se borrarán los archivos, dicho como lo diría una persona.
 *
 * `caduca` viene del servidor en segundos Unix. Sólo la hora si es hoy; si
 * cae en otro día, también el día, que un «a las 01:10» a las once de la noche
 * se lee como si fuera de hoy. Devuelve la frase entera por la contracción:
 * «a partir de las 12:40», pero «a partir **del** jueves 24».
 */
export function horaDeBorrado(caduca: number, ahora: Date = new Date()): string {
  const cuando = new Date(caduca * 1000);
  const hora = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(cuando);
  if (cuando.toDateString() === ahora.toDateString()) {
    return `a partir de las ${hora}`;
  }
  const dia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric' }).format(cuando);
  return `a partir del ${dia} a las ${hora}`;
}

/**
 * Cuánto dura el plazo sin actividad: «2 horas», «1 día», «30 minutos». Viene
 * del servidor en segundos; escrito a mano en el texto, mentía en cuanto no era
 * el de la web.
 */
export function duracionDelPlazo(segundos: number): string {
  const minutos = Math.round(segundos / 60);
  const [cuantos, unidad, plural] = minutos % 1440 === 0 ? [minutos / 1440, 'día', 'días']
    : minutos % 60 === 0 ? [minutos / 60, 'hora', 'horas']
      : [minutos, 'minuto', 'minutos'];
  return `${cuantos} ${cuantos === 1 ? unidad : plural}`;
}
