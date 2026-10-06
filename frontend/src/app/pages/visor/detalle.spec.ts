import { MAXIMO_PIXELES, cubre, escalaDelLienzo, parteVisible, trozoDeDetalle } from './detalle';

describe('escalaDelLienzo', () => {
  const A4 = { ancho: 595, alto: 842 };

  it('no recorta mientras la página cabe', () => {
    expect(escalaDelLienzo(A4.ancho, A4.alto, 2, 2)).toBe(2);
  });

  it('cuenta el zoom una sola vez: un A4 al 250 % con densidad 1 va entero', () => {
    // Antes se le pasaban las medidas ya ampliadas y recortaba a partir del 220 %.
    expect(escalaDelLienzo(A4.ancho, A4.alto, 2.5, 1)).toBe(2.5);
  });

  it('pasado el tope, deja el lienzo justo en él', () => {
    const escala = escalaDelLienzo(A4.ancho, A4.alto, 4, 2);
    expect(escala).toBeLessThan(4);
    const pixeles = A4.ancho * A4.alto * (escala * 2) ** 2;
    expect(pixeles).toBeCloseTo(MAXIMO_PIXELES, -2);
  });
});

describe('trozoDeDetalle', () => {
  const pagina = { ancho: 2000, alto: 3000 };

  it('no hace falta si la página va a su escala', () => {
    expect(trozoDeDetalle({ x: 0, y: 0, ancho: 100, alto: 100 }, pagina, 3, 3)).toBeNull();
  });

  it('no hace falta si la página no se ve', () => {
    expect(trozoDeDetalle(null, pagina, 2, 3)).toBeNull();
  });

  it('lo visible más un margen, sin salirse de la página', () => {
    const trozo = trozoDeDetalle({ x: 100, y: 1000, ancho: 800, alto: 400 }, pagina, 2, 3)!;
    expect(trozo).toEqual({ x: 0, y: 900, ancho: 1100, alto: 600 });
  });

  it('pegado a la esquina de abajo, se corta en el borde', () => {
    const trozo = trozoDeDetalle({ x: 1600, y: 2800, ancho: 400, alto: 200 }, pagina, 2, 3)!;
    expect(trozo.x + trozo.ancho).toBe(2000);
    expect(trozo.y + trozo.alto).toBe(3000);
  });
});

describe('cubre', () => {
  const trozo = { x: 0, y: 900, ancho: 1100, alto: 600 };

  it('un desplazamiento pequeño sigue dentro', () => {
    expect(cubre(trozo, { x: 50, y: 950, ancho: 800, alto: 400 })).toBe(true);
  });

  it('salirse por abajo obliga a repintar', () => {
    expect(cubre(trozo, { x: 50, y: 1300, ancho: 800, alto: 400 })).toBe(false);
  });

  it('sin trozo pintado, nada cubre', () => {
    expect(cubre(null, { x: 0, y: 0, ancho: 1, alto: 1 })).toBe(false);
  });
});

describe('parteVisible', () => {
  it('con el origen en la esquina de la página', () => {
    const pagina = { left: 100, top: -500, right: 1100, bottom: 900 };
    const ventana = { left: 0, top: 0, right: 800, bottom: 600 };
    expect(parteVisible(pagina, ventana)).toEqual({ x: 0, y: 500, ancho: 700, alto: 600 });
  });

  it('fuera de la ventana no hay nada', () => {
    expect(parteVisible({ left: 0, top: 700, right: 100, bottom: 800 },
                        { left: 0, top: 0, right: 800, bottom: 600 })).toBeNull();
  });
});
