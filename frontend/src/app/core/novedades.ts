/**
 * Las novedades que enseña el aviso de actualización de la aplicación de Windows.
 *
 * Salen de las notas de cada release de GitHub, que escribe la CI
 * (`.github/workflows/escritorio.yml`) con dos apartados, «## Novedades» y
 * «## Arreglos», hechos con los commits `feat` y `fix`. Se piden todas las que
 * haya entre la versión instalada y la nueva: quien se ha saltado tres versiones
 * tiene que ver lo de las tres. Si GitHub no contesta, se enseñan las de la
 * última, que vienen en el `latest.json` del actualizador.
 *
 * Todo esto es puro y se prueba con textos escritos a mano; quien lo pide y lo
 * enseña es `EscritorioService`.
 */

/** Dónde se piden las releases. Sin clave: 60 peticiones por hora, y se hace una por aviso. */
export const RELEASES = 'https://api.github.com/repos/dvdmsv/caja-de-herramientas/releases?per_page=50';

/** La página de todas las versiones, para «Ver en GitHub». */
export const PAGINA_DE_VERSIONES = 'https://github.com/dvdmsv/caja-de-herramientas/releases';

/** Lo que se usa de cada release que devuelve la API de GitHub. */
export interface ReleaseGitHub {
  tag_name: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string;
}

export interface Notas {
  novedades: string[];
  arreglos: string[];
}

export interface NovedadesDeVersion extends Notas {
  version: string;
  fecha: string | null;
  url: string | null;
}

/** Lo que dice `actualizacion_pendiente` (main.rs). */
export interface AvisoActualizacion {
  version: string;
  instalada: string;
  /** Las novedades de la última versión, de `latest.json`. */
  notas: string | null;
  fecha: string | null;
  /** Por qué no se pudo aplicar la vez anterior: esta vez va el instalador completo. */
  fallo_anterior?: string | null;
}

const PREFIJO = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/;

/**
 * Las novedades y los arreglos del texto de una release.
 *
 * Entiende también el formato de las primeras versiones (0.1.x), que listaba
 * todos los commits con su prefijo debajo de «## Novedades»: de ésos se queda con
 * `feat` y `fix`, les quita el prefijo y descarta el resto (`ci`, `docs`…), que
 * no le dicen nada a quien usa la aplicación.
 */
export function leerNotas(cuerpo: string | null | undefined): Notas {
  const notas: Notas = { novedades: [], arreglos: [] };
  let apartado: keyof Notas | null = null;
  for (const linea of (cuerpo ?? '').split(/\r?\n/)) {
    const titulo = /^#{1,6}\s+(.*)$/.exec(linea.trim());
    if (titulo) {
      apartado = /arreglo/i.test(titulo[1]) ? 'arreglos' : /novedad/i.test(titulo[1]) ? 'novedades' : null;
      continue;
    }
    const punto = /^[-*]\s+(.+)$/.exec(linea.trim());
    if (!punto) {
      continue;
    }
    const conPrefijo = PREFIJO.exec(punto[1]);
    if (conPrefijo) {
      const tipo = conPrefijo[1].toLowerCase();
      if (tipo === 'feat' || tipo === 'fix') {
        notas[tipo === 'feat' ? 'novedades' : 'arreglos'].push(mayuscula(conPrefijo[3]));
      }
    } else if (apartado) {
      notas[apartado].push(mayuscula(punto[1]));
    }
  }
  return notas;
}

function mayuscula(texto: string): string {
  const limpio = texto.trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Negativo si `a` es anterior a `b`. Admite «v0.2.0» y «0.2.0»; lo que va tras un guion no cuenta. */
export function compararVersiones(a: string, b: string): number {
  const partes = (version: string) => version.replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diferencia = (x[i] ?? 0) - (y[i] ?? 0);
    if (diferencia !== 0) {
      return diferencia;
    }
  }
  return 0;
}

/**
 * Las novedades de cada versión posterior a la instalada, hasta la nueva
 * incluida, de la más reciente a la más antigua. Sin borradores ni versiones
 * previas, que el actualizador tampoco ofrece.
 */
export function novedadesEntre(releases: ReleaseGitHub[], instalada: string, nueva: string): NovedadesDeVersion[] {
  return releases
    .filter(release => !release.draft && !release.prerelease)
    .filter(release => compararVersiones(release.tag_name, instalada) > 0
      && compararVersiones(release.tag_name, nueva) <= 0)
    .sort((a, b) => compararVersiones(b.tag_name, a.tag_name))
    .map(release => ({
      version: release.tag_name.replace(/^v/i, ''),
      fecha: release.published_at ?? null,
      url: release.html_url ?? null,
      ...leerNotas(release.body),
    }));
}

/** Lo que se enseña cuando GitHub no contesta: las de la última, de `latest.json`. */
export function soloLaUltima(aviso: AvisoActualizacion): NovedadesDeVersion[] {
  return [{ version: aviso.version, fecha: aviso.fecha, url: null, ...leerNotas(aviso.notas) }];
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, caracter =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caracter]!);
}

function fechaLegible(fecha: string | null): string {
  if (!fecha) {
    return '';
  }
  const dia = new Date(fecha);
  return Number.isNaN(dia.getTime())
    ? ''
    : dia.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * El cuerpo del aviso, en HTML. **Todo lo que viene de fuera va escapado**: las
 * notas salen de GitHub y no se interpretan como HTML.
 *
 * `completas` dice si están todas las versiones o sólo la última (GitHub no
 * contestó y alguien se ha saltado alguna): entonces se dice.
 */
export function htmlDelAviso(aviso: AvisoActualizacion, versiones: NovedadesDeVersion[], completas: boolean): string {
  const lista = (titulo: string, puntos: string[]) => puntos.length === 0 ? '' :
    `<p class="aviso-novedades__apartado">${titulo}</p><ul>${puntos.map(p => `<li>${escapar(p)}</li>`).join('')}</ul>`;

  const bloques = versiones.map(version => {
    const fecha = fechaLegible(version.fecha);
    const contenido = lista('Novedades', version.novedades) + lista('Arreglos', version.arreglos)
      || '<p class="aviso-novedades__vacio">Mejoras internas y de rendimiento.</p>';
    return `<section><h3>Versión ${escapar(version.version)}${fecha ? ` <small>· ${escapar(fecha)}</small>` : ''}</h3>`
      + `${contenido}</section>`;
  }).join('');

  const incompleto = completas ? '' :
    '<p class="aviso-novedades__vacio">No se ha podido consultar GitHub: si te has saltado alguna versión, '
    + 'sus novedades están allí.</p>';

  return `<p class="aviso-novedades__subtitulo">Tienes la ${escapar(aviso.instalada)}. `
    + 'Esto es lo que cambia:</p>'
    + `<div class="aviso-novedades__lista" tabindex="0">${bloques}${incompleto}</div>`
    + `<p class="aviso-novedades__pie">${escapar(comoSeActualiza(aviso))} `
    + `<a href="${PAGINA_DE_VERSIONES}" target="_blank" rel="noopener">Ver todas las versiones en GitHub</a></p>`;
}

/**
 * Qué pasa al actualizar. **Sin tamaños**: el aviso es para ver qué trae la
 * versión, no cuánto ocupa, y cómo se baja (paquete o instalador completo) es
 * cosa de la aplicación. Tras un fallo sí se dice por qué, porque la persona ya
 * lo pidió una vez y le toca saber qué pasó.
 */
export function comoSeActualiza(aviso: AvisoActualizacion): string {
  if (aviso.fallo_anterior) {
    return `La última vez no se pudo terminar (${aviso.fallo_anterior}); se volverá a intentar. `
      + 'La aplicación se cerrará un momento y volverá a abrirse.';
  }
  return 'Al actualizar, la aplicación se cerrará un momento y volverá a abrirse.';
}
