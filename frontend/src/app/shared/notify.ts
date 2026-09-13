import Swal from 'sweetalert2';

/**
 * Avisos de la aplicación, con un aspecto único para todas las herramientas.
 * Los aciertos son discretos (un aviso que se va solo); los errores piden
 * atención y muestran el mensaje que devuelve el servidor.
 */

export function avisoExito(texto: string): void {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: texto,
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
  });
}

/**
 * Un aviso que informa sin interrumpir: como el de éxito, pero dura más, porque
 * suele traer algo que leer ("ese archivo no vale aquí"). Se detiene mientras el
 * ratón está encima.
 */
export function avisoInfo(texto: string): void {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'info',
    title: texto,
    showConfirmButton: false,
    timer: 6000,
    timerProgressBar: true,
    didOpen: aviso => {
      aviso.addEventListener('mouseenter', Swal.stopTimer);
      aviso.addEventListener('mouseleave', Swal.resumeTimer);
    },
  });
}

export function avisoError(texto: string): void {
  Swal.fire({ icon: 'error', title: 'Algo ha fallado', text: texto, confirmButtonText: 'Entendido' });
}

export function aviso(texto: string): void {
  Swal.fire({ icon: 'info', text: texto, confirmButtonText: 'Vale' });
}

/** Pregunta antes de algo que no se puede deshacer del todo. */
export function confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean> {
  return Swal.fire({
    icon: 'question',
    title: titulo,
    text: texto,
    showCancelButton: true,
    confirmButtonText: aceptar,
    cancelButtonText: 'Cancelar',
  }).then(respuesta => respuesta.isConfirmed);
}

/** Extrae el mensaje útil de un error HTTP, con un texto de respaldo. */
export function mensajeDeError(err: unknown, respaldo: string): string {
  const detalle = (err as { error?: { error?: string } })?.error?.error;
  return typeof detalle === 'string' && detalle ? detalle : respaldo;
}
