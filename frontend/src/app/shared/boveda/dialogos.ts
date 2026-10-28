import Swal from 'sweetalert2';

import { BovedaService, CONTRASENA_MINIMA } from '../../core/boveda.service';
import { ContrasenaIncorrecta } from '../../core/boveda/cifrado';

/**
 * Los diálogos de la bóveda: abrirla, crearla y cambiarle la contraseña.
 *
 * Van en diálogos y no en la página `/boveda` porque se piden **desde las
 * herramientas**, a mitad de trabajo: mandar a la persona a otra página para
 * abrir la bóveda le haría perder el documento que tenía colocado.
 */

/** La deja abierta pidiendo lo que haga falta. `false` si se cancela. */
export async function asegurarAbierta(boveda: BovedaService): Promise<boolean> {
  await boveda.comprobar();
  if (boveda.abierta) {
    return true;
  }
  if (boveda.estado === 'sin-crear') {
    return crearConDialogo(boveda);
  }
  return boveda.estado === 'cerrada' ? abrirConDialogo(boveda) : false;
}

export async function abrirConDialogo(boveda: BovedaService): Promise<boolean> {
  const respuesta = await Swal.fire({
    icon: 'question',
    title: 'Abre tu bóveda',
    input: 'password',
    inputLabel: 'Contraseña de la bóveda',
    inputAttributes: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' },
    showCancelButton: true,
    confirmButtonText: 'Abrir',
    cancelButtonText: 'Cancelar',
    showLoaderOnConfirm: true,
    allowOutsideClick: () => !Swal.isLoading(),
    preConfirm: async (contrasena: string) => {
      if (!contrasena) {
        Swal.showValidationMessage('Escribe la contraseña.');
        return false;
      }
      try {
        await boveda.abrir(contrasena);
        return true;
      } catch (error) {
        Swal.showValidationMessage(error instanceof ContrasenaIncorrecta
          ? 'La contraseña no es correcta.' : (error as Error).message);
        return false;
      }
    },
  });
  return respuesta.isConfirmed;
}

export async function crearConDialogo(boveda: BovedaService): Promise<boolean> {
  return pedirContrasenaNueva({
    titulo: 'Crea tu bóveda',
    explicacion: 'Tus certificados y tus firmas se guardan cifrados en este equipo, y sólo se abren con esta '
      + 'contraseña. <strong>Si la olvidas, no hay forma de recuperarla</strong>: sólo se podrá borrar la bóveda '
      + 'y empezar otra.',
    boton: 'Crear la bóveda',
    usar: contrasena => boveda.crear(contrasena),
  });
}

export async function cambiarContrasenaConDialogo(boveda: BovedaService): Promise<boolean> {
  return pedirContrasenaNueva({
    titulo: 'Cambia la contraseña',
    explicacion: 'Todo se vuelve a cifrar con la nueva. Las demás ventanas tendrán que abrir la bóveda otra vez.',
    boton: 'Cambiarla',
    usar: contrasena => boveda.cambiarContrasena(contrasena),
  });
}

/** Dos campos, para que una errata no deje la bóveda con una contraseña que nadie sabe. */
async function pedirContrasenaNueva(opciones: {
  titulo: string; explicacion: string; boton: string; usar: (contrasena: string) => Promise<void>;
}): Promise<boolean> {
  const respuesta = await Swal.fire({
    icon: 'info',
    title: opciones.titulo,
    html: `
      <p class="text-start mb-3">${opciones.explicacion}</p>
      <label class="swal2-input-label" for="boveda-nueva">Contraseña (${CONTRASENA_MINIMA} caracteres o más)</label>
      <input id="boveda-nueva" type="password" class="swal2-input" autocomplete="new-password">
      <label class="swal2-input-label" for="boveda-repetida">Repítela</label>
      <input id="boveda-repetida" type="password" class="swal2-input" autocomplete="new-password">`,
    focusConfirm: false,
    didOpen: () => document.getElementById('boveda-nueva')?.focus(),
    showCancelButton: true,
    confirmButtonText: opciones.boton,
    cancelButtonText: 'Cancelar',
    showLoaderOnConfirm: true,
    allowOutsideClick: () => !Swal.isLoading(),
    preConfirm: async () => {
      const nueva = (document.getElementById('boveda-nueva') as HTMLInputElement).value;
      const repetida = (document.getElementById('boveda-repetida') as HTMLInputElement).value;
      if (nueva.length < CONTRASENA_MINIMA) {
        Swal.showValidationMessage(`Tiene que tener al menos ${CONTRASENA_MINIMA} caracteres.`);
        return false;
      }
      if (nueva !== repetida) {
        Swal.showValidationMessage('Las dos no coinciden.');
        return false;
      }
      try {
        await opciones.usar(nueva);
        return true;
      } catch (error) {
        Swal.showValidationMessage((error as Error).message);
        return false;
      }
    },
  });
  return respuesta.isConfirmed;
}

/** El nombre con que se guarda algo. `null` si se cancela. */
export async function pedirNombre(titulo: string, propuesto: string): Promise<string | null> {
  const respuesta = await Swal.fire({
    title: titulo,
    input: 'text',
    inputValue: propuesto,
    inputLabel: 'Nombre',
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    inputValidator: valor => (valor.trim() ? null : 'Ponle un nombre.'),
  });
  return respuesta.isConfirmed ? String(respuesta.value).trim() : null;
}
