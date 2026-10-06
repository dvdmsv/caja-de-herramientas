import Swal from 'sweetalert2';

/**
 * Los atajos de teclado del visor, para la ayuda que sale con «?». Si se añade
 * uno en `alPulsarTecla`, va también aquí: es la única forma de que alguien
 * se entere de que existe.
 */
export const ATAJOS: [string, string][] = [
  ['→ ← · Av Pág Re Pág', 'Página siguiente y anterior'],
  ['Inicio · Fin', 'Primera y última página'],
  ['↓ ↑', 'Desplazarse; página a página, al llegar al borde pasa de página'],
  ['Ctrl + rueda · pellizco', 'Ampliar donde está el cursor o los dedos'],
  ['Ctrl + · Ctrl − · + −', 'Ampliar y reducir'],
  ['Ctrl 0', 'Ver la página entera'],
  ['Ctrl F', 'Buscar'],
  ['Intro · F3 (Mayús para atrás)', 'Resultado siguiente'],
  ['Ctrl Z', 'Deshacer'],
  ['Ctrl P', 'Imprimir'],
  ['F5', 'Presentación; Esc para salir'],
  ['G', 'Panel de páginas'],
  ['Supr', 'Quitar el texto escrito que esté seleccionado'],
  ['Esc', 'Cerrar el panel'],
  ['?', 'Esta ayuda'],
];

export function mostrarAtajos(): void {
  const filas = ATAJOS
    .map(([tecla, que]) => `<tr><th scope="row"><kbd>${tecla}</kbd></th><td>${que}</td></tr>`)
    .join('');
  Swal.fire({
    title: 'Atajos de teclado',
    html: `<table class="table table-sm text-start align-middle mb-0"><tbody>${filas}</tbody></table>`,
    confirmButtonText: 'Vale',
    width: '36rem',
  });
}
