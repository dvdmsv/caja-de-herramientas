import { calcularDisposicion } from './disposicion';
import { anclar, factorDeRueda, factorPermitido } from './zoom';

const medidas = Array.from({ length: 5 }, (_, i) => ({ numero: i + 1, ancho: 600, alto: 800 }));
const disponer = (escala: number, columnas = 1) =>
  calcularDisposicion(medidas, { escala, columnas, anchoDisponible: 1000, separacion: 16 });

describe('anclar', () => {
  it('el mismo sitio de la misma página, a otro zoom', () => {
    const antes = disponer(1);
    const despues = disponer(2);
    // El centro de la tercera página.
    const fila = antes.filas[2];
    const pagina = fila.paginas[0];
    const p = { x: pagina.izquierda + pagina.ancho / 2, y: fila.top + fila.alto / 2 };

    const q = anclar(antes, despues, p);
    const nueva = despues.filas[2];
    expect(q.y).toBeCloseTo(nueva.top + nueva.alto / 2);
    expect(q.x).toBeCloseTo(nueva.paginas[0].izquierda + nueva.paginas[0].ancho / 2);
  });

  it('no se desvía por la separación entre páginas, que no crece con el zoom', () => {
    const antes = disponer(1);
    const despues = disponer(3);
    const fila = antes.filas[4];
    const q = anclar(antes, despues, { x: 500, y: fila.top + 10 });
    // 10 px dentro de la página a escala 1 son 30 a escala 3.
    expect(q.y).toBeCloseTo(despues.filas[4].top + 30);
  });

  it('en dos columnas, la página de la derecha sigue siendo la de la derecha', () => {
    const antes = disponer(0.5, 2);
    const despues = disponer(1, 2);
    const derecha = antes.filas[0].paginas[1];
    const q = anclar(antes, despues, { x: derecha.izquierda + 1, y: antes.filas[0].top + 1 });
    expect(q.x).toBeGreaterThanOrEqual(despues.filas[0].paginas[1].izquierda);
  });
});

describe('factorDeRueda', () => {
  it('acercar y alejar lo mismo deja el zoom igual', () => {
    expect(factorDeRueda(100, 0) * factorDeRueda(-100, 0)).toBeCloseTo(1);
  });

  it('hacia arriba acerca; las líneas cuentan como píxeles', () => {
    expect(factorDeRueda(-100, 0)).toBeGreaterThan(1);
    expect(factorDeRueda(-3, 1)).toBeCloseTo(factorDeRueda(-48, 0));
  });
});

describe('factorPermitido', () => {
  it('se queda en el tope', () => {
    expect(factorPermitido(5, 2, 0.2, 6)).toBeCloseTo(1.2);
    expect(factorPermitido(0.3, 0.1, 0.2, 6)).toBeCloseTo(0.2 / 0.3);
  });
});
