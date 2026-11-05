/**
 * Los atajos del icono (las favoritas) abren
 * `cajadeherramientas://herramientas/<slug>` (AtajosPlugin.java). Cualquier otra
 * URL que llegue por `appUrlOpen` —un `content://` de «Abrir con», por
 * ejemplo— no es un atajo y se deja.
 */
export function rutaDeAtajo(url: string): string | null {
  const encontrado = /^cajadeherramientas:\/\/herramientas\/([a-z0-9-]{1,40})\/?$/.exec(url);
  return encontrado ? `/herramientas/${encontrado[1]}` : null;
}
