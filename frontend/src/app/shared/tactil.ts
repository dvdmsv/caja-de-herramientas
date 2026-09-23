/**
 * La ayuda de una zona de subida, dicha para un dedo.
 *
 * Cada herramienta escribe la suya pensando en el escritorio —«Arrastra aquí el
 * PDF escaneado»—, y en un móvil no hay nada que arrastrar: lo que se hace es
 * tocar la zona. En vez de pedirle a cada página una segunda frase, se reescribe
 * aquí la primera: «Toca para elegir el PDF escaneado». Lo que no empieza por
 * «Arrastra» se deja como está, porque ya no habla del gesto.
 */
export function ayudaTactil(ayuda: string): string {
  const partes = /^Arrastra\s+(?:aquí\s+)?(.+?)(?:\s+aquí)?(?:\s+o haz clic para \S+)?$/.exec(ayuda.trim());
  return partes ? `Toca para elegir ${partes[1]}` : ayuda;
}
