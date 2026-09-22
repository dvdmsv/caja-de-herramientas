import { centradoCon, enEspacioImagen, enFracciones, enPixeles, LADO_MINIMO, mover,
         redimensionar, Recorte } from './recorte';

const MITAD: Recorte = { x: 0.25, y: 0.25, ancho: 0.5, alto: 0.5 };
const casi = (valor: number) => Math.round(valor * 1000) / 1000;
const redondo = (r: Recorte) => ({ x: casi(r.x), y: casi(r.y), ancho: casi(r.ancho), alto: casi(r.alto) });

describe('el recuadro de recorte', () => {
  it('se mueve entero', () => {
    expect(redondo(mover(MITAD, 0.1, -0.1)))
      .toEqual({ x: 0.35, y: 0.15, ancho: 0.5, alto: 0.5 });
  });

  it('no se sale de la imagen al moverlo', () => {
    expect(redondo(mover(MITAD, 5, 5))).toEqual({ x: 0.5, y: 0.5, ancho: 0.5, alto: 0.5 });
    expect(redondo(mover(MITAD, -5, -5))).toEqual({ x: 0, y: 0, ancho: 0.5, alto: 0.5 });
  });

  it('arrastrar una esquina deja la contraria donde estaba', () => {
    const nuevo = redimensionar(MITAD, 'se', 0.1, 0.1);
    expect(casi(nuevo.x)).toBe(0.25);
    expect(casi(nuevo.y)).toBe(0.25);
    expect(casi(nuevo.ancho)).toBe(0.6);
    expect(casi(nuevo.alto)).toBe(0.6);
  });

  it('arrastrar la esquina de arriba a la izquierda mueve el origen', () => {
    const nuevo = redimensionar(MITAD, 'nw', 0.1, 0.1);
    expect(redondo(nuevo)).toEqual({ x: 0.35, y: 0.35, ancho: 0.4, alto: 0.4 });
  });

  it('un asa de lado sólo toca ese lado', () => {
    const nuevo = redimensionar(MITAD, 'e', 0.2, 0);
    expect(redondo(nuevo)).toEqual({ x: 0.25, y: 0.25, ancho: 0.7, alto: 0.5 });
  });

  it('no deja encoger por debajo del mínimo', () => {
    const nuevo = redimensionar(MITAD, 'e', -5, 0);
    expect(casi(nuevo.ancho)).toBe(casi(LADO_MINIMO));
  });

  it('no deja crecer fuera de la imagen', () => {
    const nuevo = redimensionar(MITAD, 'se', 5, 5);
    expect(redondo(nuevo)).toEqual({ x: 0.25, y: 0.25, ancho: 0.75, alto: 0.75 });
  });

  describe('con una proporción que respetar', () => {
    it('ajusta el lado que no se arrastra', () => {
      // 1:1 sobre una imagen cuadrada: el objetivo en fracciones también es 1.
      const nuevo = redimensionar({ x: 0.1, y: 0.1, ancho: 0.4, alto: 0.6 }, 'se', 0, 0, 1);
      expect(casi(nuevo.ancho)).toBe(casi(nuevo.alto));
      expect(casi(nuevo.x)).toBe(0.1);
      expect(casi(nuevo.y)).toBe(0.1);
    });

    it('al salirse encoge en vez de deformarse', () => {
      const nuevo = redimensionar({ x: 0.6, y: 0.6, ancho: 0.3, alto: 0.3 }, 'se', 0.5, 0.5, 1);
      expect(casi(nuevo.ancho)).toBe(casi(nuevo.alto));
      expect(nuevo.x + nuevo.ancho).toBeLessThanOrEqual(1.0001);
      expect(nuevo.y + nuevo.alto).toBeLessThanOrEqual(1.0001);
    });

    it('un asa de arriba ajusta el ancho manteniendo el centro', () => {
      const inicio = { x: 0.2, y: 0.2, ancho: 0.6, alto: 0.6 };
      const nuevo = redimensionar(inicio, 'n', 0, 0.2, 1);
      expect(casi(nuevo.ancho)).toBe(casi(nuevo.alto));
      // El centro horizontal no se ha movido.
      expect(casi(nuevo.x + nuevo.ancho / 2)).toBe(casi(inicio.x + inicio.ancho / 2));
    });
  });

  it('la proporción en píxeles no es la misma que en fracciones', () => {
    // Un recuadro cuadrado sobre una foto apaisada (2:1) ocupa el doble de
    // fracción de alto que de ancho. Confundirlo es el error clásico.
    expect(enFracciones(1, 2)).toBe(0.5);
    expect(enFracciones(16 / 9, 16 / 9)).toBe(1);
  });

  it('el recuadro inicial de una proporción cabe entero y va centrado', () => {
    const cuadrado = centradoCon(0.5);
    expect(casi(cuadrado.ancho)).toBe(0.5);
    expect(casi(cuadrado.alto)).toBe(1);
    expect(casi(cuadrado.x)).toBe(0.25);
    expect(casi(cuadrado.y)).toBe(0);
  });

  describe('el puntero, de la pantalla a la imagen', () => {
    // Es la conversión que se desvía en silencio: si se equivoca, arrastrar en
    // recto mueve el recuadro en diagonal y nada falla.
    it('sin girar no cambia nada', () => {
      expect(enEspacioImagen(10, 4, 0)).toEqual([10, 4]);
    });

    it('a 90° la derecha de la pantalla es hacia arriba en la imagen', () => {
      expect(enEspacioImagen(10, 0, 90)).toEqual([0, -10]);
      expect(enEspacioImagen(0, 10, 90)).toEqual([10, 0]);
    });

    it('a 180° se invierten los dos ejes', () => {
      expect(enEspacioImagen(10, 4, 180)).toEqual([-10, -4]);
    });

    it('a 270° es al revés que a 90°', () => {
      expect(enEspacioImagen(10, 0, 270)).toEqual([0, 10]);
      expect(enEspacioImagen(0, 10, 270)).toEqual([-10, 0]);
    });

    it('el espejo invierte sólo la horizontal, y después del giro', () => {
      expect(enEspacioImagen(10, 4, 0, true)).toEqual([-10, 4]);
      expect(enEspacioImagen(0, 10, 90, true)).toEqual([-10, 0]);
    });

    it('deshacer el giro devuelve el desplazamiento original', () => {
      for (const giro of [0, 90, 180, 270]) {
        const [x, y] = enEspacioImagen(7, -3, giro);
        // Girar en sentido contrario tiene que dejarlo como estaba.
        expect(enEspacioImagen(x, y, -giro)).toEqual([7, -3]);
      }
    });
  });

  it('dice cuántos píxeles va a tener el recorte', () => {
    expect(enPixeles(MITAD, 800, 600)).toEqual([400, 300]);
  });
});
