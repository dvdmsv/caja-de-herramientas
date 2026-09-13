import { Injectable } from '@angular/core';

import { CLAVE_TEMA, PreferenciaTema, leerPreferencia, resolverTema, siguientePreferencia } from './tema';

/**
 * Modo claro u oscuro de toda la aplicación.
 *
 * Aplica `data-bs-theme` en `<html>`, que es lo que entiende Bootstrap 5.3, y
 * recuerda la elección en este navegador. Con "sistema" escucha los cambios del
 * sistema operativo, para que la página cambie sola al anochecer si el sistema
 * lo hace.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  // Opcional: hay entornos sin `matchMedia` (jsdom en los tests, navegadores
  // muy viejos). Ahí "sistema" se resuelve como claro.
  private readonly consulta = window.matchMedia?.('(prefers-color-scheme: dark)');

  preferencia: PreferenciaTema = leerPreferencia(leer());

  constructor() {
    this.consulta?.addEventListener?.('change', () => this.aplicar());
    this.aplicar();
  }

  alternar(): void {
    this.preferencia = siguientePreferencia(this.preferencia);
    guardar(this.preferencia);
    this.aplicar();
  }

  private aplicar(): void {
    document.documentElement.dataset['bsTheme'] = resolverTema(this.preferencia, this.consulta?.matches ?? false);
  }
}

// El almacenamiento puede no estar (navegación privada, cookies bloqueadas):
// entonces el tema funciona igual, sólo que no se recuerda.
function leer(): string | null {
  try {
    return localStorage.getItem(CLAVE_TEMA);
  } catch {
    return null;
  }
}

function guardar(valor: string): void {
  try {
    localStorage.setItem(CLAVE_TEMA, valor);
  } catch {
    // Sin almacenamiento, se queda para esta visita.
  }
}
