/**
 * Los ajustes de la aplicación de Windows, vistos desde la página.
 *
 * Quien los guarda y los aplica es `escritorio/src-tauri/src/ajustes.rs`, que
 * además los recorta a su rango al leerlos. Aquí se repiten los rangos para
 * decirlo mientras se escribe, no para decidir: **si se cambia uno, en los dos
 * sitios**.
 *
 * Los de «Avanzado» van a `null` cuando están en su valor de serie, y el de
 * serie lo decide quien lo aplica (`escritorio.preparar_entorno` en el backend,
 * `trabajo.rs` la memoria). `DE_SERIE` sólo sirve para enseñarlo.
 */

export type ModoGuardado = 'preguntar' | 'junto' | 'carpeta';

export interface AjustesEscritorio {
  activo: boolean;
  acciones: string[];
  extensiones_escritas: string[];
  version_saltada: string | null;
  /** Sólo lo pone la aplicación: si ya avisó de que la X la deja junto al reloj. */
  bandeja_avisada: boolean;
  /** `pdf_en_la_portada`: un PDF abierto con «Abrir con…» no va al visor. */
  ventana: { a_la_bandeja: boolean; pdf_en_la_portada: boolean };
  guardado: { modo: ModoGuardado; carpeta: string | null };
  avisos: { activos: boolean; desde_segundos: number };
  actualizaciones: { al_abrir: boolean };
  espacio: { plazo: Plazo | null };
  avanzado: Avanzado;
}

/**
 * Cuándo se borran los archivos de trabajo. Los minutos de cada uno los sabe
 * el backend (`escritorio.PLAZOS`); `null` es el de serie, al salir. «Al
 * salir» y no «al cerrar»: con la ventana junto al reloj, cerrarla no es salir.
 */
export type Plazo = 'horas_2' | 'dia_1';

/** En el orden del desplegable. Los mismos nombres que `PLAZOS` en `ajustes.rs`. */
export const PLAZOS: { valor: Plazo | null; texto: string }[] = [
  { valor: null, texto: 'Al salir de la aplicación' },
  { valor: 'horas_2', texto: 'Tras 2 horas sin usarlos' },
  { valor: 'dia_1', texto: 'Tras 1 día sin usarlos' },
];

export interface Avanzado {
  /** % de la RAM; 0 es sin tope. */
  memoria_porcentaje: number | null;
  prioridad_baja: boolean | null;
  subida_max_mb: number | null;
  cuota_mb: number | null;
  sello_tiempo: string | null;
}

/** Lo que devuelven `leer_ajustes` y `guardar_ajustes`. */
export interface EstadoAjustes {
  ajustes: AjustesEscritorio;
  /** Hay cambios de «Avanzado» que no valdrán hasta volver a abrir la aplicación. */
  reinicio_pendiente: boolean;
}

/** Lo que la página puede cambiar (ver `ajustes::mezclar`). */
export type CambiosAjustes = Partial<{
  ventana: Partial<AjustesEscritorio['ventana']>;
  guardado: { modo: ModoGuardado };
  avisos: Partial<AjustesEscritorio['avisos']>;
  actualizaciones: Partial<AjustesEscritorio['actualizaciones']>;
  espacio: Partial<AjustesEscritorio['espacio']>;
  avanzado: Partial<Avanzado>;
  version_saltada: null;
}>;

/** Los de serie, para enseñarlos. Los de la aplicación, no los de la web. */
export const DE_SERIE = {
  memoriaPorcentaje: 60,
  subidaMaxMb: 2048,
  cuotaMb: 20_480,
  selloTiempo: 'https://freetsa.org/tsr',
  avisosDesdeSegundos: 10,
} as const;

/** Los mismos que `ajustes.rs`. */
export const RANGOS = {
  memoriaPorcentaje: [30, 90],
  subidaMaxMb: [100, 8192],
  cuotaMb: [1024, 102_400],
} as const;

/** Lo que se ofrece para «A partir de», en segundos. */
export const ESPERAS_DE_AVISO = [10, 30, 60, 300];

export function textoDeEspera(segundos: number): string {
  return segundos < 60 ? `${segundos} s` : segundos === 60 ? '1 minuto' : `${segundos / 60} minutos`;
}

/** Un `https://` con algo detrás y sin espacios: lo mismo que `es_url_segura`. */
export function esUrlSegura(url: string): boolean {
  return url.length <= 300 && /^https:\/\/\S+$/.test(url);
}

/** Por qué no vale un número de «Avanzado», dicho para quien lo escribe; `null` si vale. */
export function fueraDeRango(campo: keyof typeof RANGOS, valor: number): string | null {
  const [minimo, maximo] = RANGOS[campo];
  if (!Number.isFinite(valor) || !Number.isInteger(valor)) {
    return 'Tiene que ser un número entero.';
  }
  return valor < minimo || valor > maximo ? `Entre ${minimo.toLocaleString('es-ES')} y ${maximo.toLocaleString('es-ES')}.` : null;
}

/** Si «Avanzado» está entero en sus valores de serie. */
export function avanzadoDeSerie(avanzado: Avanzado): boolean {
  return Object.values(avanzado).every(valor => valor === null);
}

/** Megas con su unidad: «2 GB», «512 MB». */
export function textoDeMegas(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb.toLocaleString('es-ES')} MB`;
}

export type IdSeccion = 'ventana' | 'guardado' | 'avisos' | 'explorador' | 'actualizaciones' | 'espacio' | 'ayuda' | 'avanzado';

export interface Seccion {
  id: IdSeccion;
  nombre: string;
  icono: string;
  /** La línea bajo el título: para qué sirve. */
  descripcion: string;
}

/** En el orden del menú lateral; «Avanzado», el último y separado. */
export const SECCIONES: Seccion[] = [
  { id: 'ventana', nombre: 'Ventana', icono: 'bi-window', descripcion: 'Qué pasa al cerrarla y al abrir un PDF.' },
  { id: 'guardado', nombre: 'Guardado', icono: 'bi-floppy', descripcion: 'Dónde van los archivos que guardas.' },
  { id: 'avisos', nombre: 'Avisos', icono: 'bi-bell', descripcion: 'Qué te dice Windows cuando termina un trabajo largo.' },
  { id: 'explorador', nombre: 'Menú del Explorador', icono: 'bi-menu-button-wide',
    descripcion: 'Las herramientas al hacer clic derecho en un archivo.' },
  { id: 'actualizaciones', nombre: 'Actualizaciones', icono: 'bi-arrow-repeat',
    descripcion: 'Qué versión tienes y cómo te llegan las nuevas.' },
  { id: 'espacio', nombre: 'Espacio', icono: 'bi-hdd', descripcion: 'Lo que ocupan los archivos de trabajo.' },
  { id: 'ayuda', nombre: 'Ayuda', icono: 'bi-life-preserver', descripcion: 'Para cuando algo no va bien.' },
  { id: 'avanzado', nombre: 'Avanzado', icono: 'bi-sliders',
    descripcion: 'Memoria, prioridad y límites de la aplicación.' },
];

/** La sección de `/ajustes#…`; sin fragmento o con uno que no existe, la primera. */
export function seccionDe(fragmento: string | null | undefined): Seccion {
  return SECCIONES.find(seccion => seccion.id === fragmento) ?? SECCIONES[0];
}
