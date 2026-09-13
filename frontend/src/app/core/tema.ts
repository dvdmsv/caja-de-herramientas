/**
 * Preferencia de tema y su resolución, sin tocar el DOM para poder probarla.
 *
 * La misma lógica, en miniatura, vive también en el `<script>` de `index.html`:
 * allí se aplica antes de que arranque Angular para que la página no se pinte
 * en blanco un instante antes de pasar a oscuro. Si cambias la clave o los
 * valores, cámbialos en los dos sitios.
 */

export type PreferenciaTema = 'sistema' | 'claro' | 'oscuro';
export type Tema = 'light' | 'dark';

export const CLAVE_TEMA = 'tema';

/** El orden en que el botón del menú va pasando por las preferencias. */
export const CICLO_TEMA: PreferenciaTema[] = ['sistema', 'claro', 'oscuro'];

export function leerPreferencia(guardado: string | null): PreferenciaTema {
  return CICLO_TEMA.includes(guardado as PreferenciaTema) ? (guardado as PreferenciaTema) : 'sistema';
}

export function resolverTema(preferencia: PreferenciaTema, sistemaOscuro: boolean): Tema {
  if (preferencia === 'sistema') {
    return sistemaOscuro ? 'dark' : 'light';
  }
  return preferencia === 'oscuro' ? 'dark' : 'light';
}

export function siguientePreferencia(actual: PreferenciaTema): PreferenciaTema {
  return CICLO_TEMA[(CICLO_TEMA.indexOf(actual) + 1) % CICLO_TEMA.length];
}
