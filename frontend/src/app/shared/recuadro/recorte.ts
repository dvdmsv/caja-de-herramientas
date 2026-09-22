/**
 * Un recuadro de recorte sobre una imagen, y cómo lo cambian los tiradores.
 *
 * Todo en **fracciones de 0 a 1** con el origen arriba a la izquierda y referido
 * a la imagen sin girar: la convención de todo el proyecto, la misma que usan
 * `coordenadas.ts`, `visor.py` y `firmar.py`, y la que espera
 * `backend/api/tools/editar_imagen.py`. Así da igual a qué tamaño se esté viendo
 * la foto, y lo que se ve es exactamente lo que recorta el servidor.
 *
 * La lógica vive aquí y no en el componente porque es donde se puede probar: un
 * recuadro que se sale por un lado o una proporción que se va a la mitad del
 * arrastre no dan ningún error, dan una foto recortada por donde no era.
 */

export interface Recorte {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export const RECORTE_COMPLETO: Recorte = { x: 0, y: 0, ancho: 1, alto: 1 };

/** Por debajo de esto no es un recorte, es un resbalón con el ratón. */
export const LADO_MINIMO = 0.02;

/** `mover` arrastra el recuadro entero; el resto son las asas del borde. */
export type Tirador = 'mover' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function entre(valor: number, minimo: number, maximo: number): number {
  return Math.max(minimo, Math.min(maximo, valor));
}

/**
 * La proporción que hay que mantener **en fracciones**, a partir de la que se
 * quiere en píxeles.
 *
 * No son lo mismo y confundirlas es el error clásico: un recuadro cuadrado sobre
 * una foto apaisada ocupa más fracción de alto que de ancho. `relacion` es el
 * ancho entre el alto de la imagen en píxeles.
 */
export function enFracciones(proporcion: number, relacion: number): number {
  return proporcion / relacion;
}

/**
 * Pasa un desplazamiento del puntero **de la pantalla a la imagen**.
 *
 * Hace falta en cuanto la foto se enseña girada o volteada: lo que en pantalla
 * es «hacia la derecha» puede ser «hacia arriba» en la imagen, y el recuadro
 * vive siempre en las coordenadas de la imagen **sin girar**, que son las que
 * entiende `editar_imagen.py`.
 *
 * La imagen se pinta con `rotate(giro) scaleX(±1)`, así que para volver hay que
 * deshacerlo en el orden contrario: primero el giro y después el espejo. Si esto
 * se desvía no falla nada —el recuadro se mueve en diagonal cuando arrastras en
 * recto—, que es justo por lo que está aquí, aparte y con un test por caso.
 *
 * Entra y sale en **píxeles**, no en fracciones: al girar 90° un píxel horizontal
 * de pantalla se convierte en uno vertical de la imagen, y hay que dividirlo por
 * el alto y no por el ancho.
 */
export function enEspacioImagen(dx: number, dy: number, giro: number,
                                espejo = false): [number, number] {
  const radianes = (((giro % 360) + 360) % 360) * Math.PI / 180;
  const cos = Math.round(Math.cos(radianes));
  const sen = Math.round(Math.sin(radianes));

  // Inverso de `rotate(giro)` con la `y` hacia abajo, que es como mide el CSS.
  // El `|| 0` no sobra: el coseno de 270° sale como -0, y un -0 arrastrado hasta
  // una comparación la hace fallar sin que nada esté mal.
  const x = (dx * cos + dy * sen) || 0;
  const y = (-dx * sen + dy * cos) || 0;

  return [(espejo ? -x : x) || 0, y];
}

/** Arrastrar el recuadro entero, sin dejar que se salga de la imagen. */
export function mover(inicio: Recorte, dx: number, dy: number): Recorte {
  return {
    ...inicio,
    x: entre(inicio.x + dx, 0, 1 - inicio.ancho),
    y: entre(inicio.y + dy, 0, 1 - inicio.alto),
  };
}

/**
 * Arrastrar un asa del borde.
 *
 * `objetivo` es la proporción ancho/alto que hay que respetar, ya en fracciones
 * (ver `enFracciones`), o `null` para recorte libre.
 */
export function redimensionar(inicio: Recorte, tirador: Tirador, dx: number, dy: number,
                              objetivo: number | null = null): Recorte {
  if (tirador === 'mover') {
    return mover(inicio, dx, dy);
  }

  const izquierda = inicio.x;
  const arriba = inicio.y;
  const derecha = inicio.x + inicio.ancho;
  const abajo = inicio.y + inicio.alto;

  let x0 = izquierda;
  let y0 = arriba;
  let x1 = derecha;
  let y1 = abajo;

  if (tirador.includes('w')) {
    x0 = entre(izquierda + dx, 0, derecha - LADO_MINIMO);
  }
  if (tirador.includes('e')) {
    x1 = entre(derecha + dx, izquierda + LADO_MINIMO, 1);
  }
  if (tirador.includes('n')) {
    y0 = entre(arriba + dy, 0, abajo - LADO_MINIMO);
  }
  if (tirador.includes('s')) {
    y1 = entre(abajo + dy, arriba + LADO_MINIMO, 1);
  }

  const libre = { x: x0, y: y0, ancho: x1 - x0, alto: y1 - y0 };
  return objetivo === null ? libre : _conProporcion(libre, tirador, objetivo);
}

/**
 * Ajusta el lado que no se está arrastrando para respetar la proporción.
 *
 * El punto fijo es la esquina o el lado contrario al asa: es lo que hace que
 * arrastrar por abajo a la derecha no mueva la esquina de arriba a la izquierda,
 * que es lo que uno espera y lo que hace que el recorte se sienta estable.
 */
function _conProporcion(recorte: Recorte, tirador: Tirador, objetivo: number): Recorte {
  let { x, y, ancho, alto } = recorte;

  // En las asas de arriba y abajo manda el alto; en las de los lados, el ancho;
  // en las esquinas, el que haya quedado mayor en proporción.
  const mandaElAlto = tirador === 'n' || tirador === 's'
    || (tirador.length === 2 && ancho / alto > objetivo);

  if (mandaElAlto) {
    const nuevo = alto * objetivo;
    // Se crece o se encoge desde el lado que no se está tocando.
    x = tirador.includes('w') ? x + ancho - nuevo : x;
    if (tirador === 'n' || tirador === 's') {
      x = x + ancho / 2 - nuevo / 2;
    }
    ancho = nuevo;
  } else {
    const nuevo = ancho / objetivo;
    y = tirador.includes('n') ? y + alto - nuevo : y;
    if (tirador === 'e' || tirador === 'w') {
      y = y + alto / 2 - nuevo / 2;
    }
    alto = nuevo;
  }

  // Si al ajustar se ha salido, se encoge **manteniendo la proporción**. Lo
  // otro sería recortar el lado que se sale, y eso rompería justo lo que se
  // estaba pidiendo respetar.
  const cabe = Math.min(
    1,
    x < 0 ? (x + ancho) / ancho : 1,
    y < 0 ? (y + alto) / alto : 1,
    x + ancho > 1 ? (1 - x) / ancho : 1,
    y + alto > 1 ? (1 - y) / alto : 1,
  );
  if (cabe < 1) {
    ancho *= cabe;
    alto *= cabe;
  }

  return { x: entre(x, 0, 1 - ancho), y: entre(y, 0, 1 - alto), ancho, alto };
}

/** Encaja un recuadro que respete `objetivo` y quepa entero, centrado. */
export function centradoCon(objetivo: number): Recorte {
  let ancho = 1;
  let alto = ancho / objetivo;
  if (alto > 1) {
    alto = 1;
    ancho = alto * objetivo;
  }
  return { x: (1 - ancho) / 2, y: (1 - alto) / 2, ancho, alto };
}

/** Qué tamaño tendrá el recorte en píxeles, para poder enseñarlo. */
export function enPixeles(recorte: Recorte, ancho: number, alto: number): [number, number] {
  return [Math.round(recorte.ancho * ancho), Math.round(recorte.alto * alto)];
}
