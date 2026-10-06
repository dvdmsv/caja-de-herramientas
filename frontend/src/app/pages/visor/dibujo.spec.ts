import { Punto } from './cambios';
import {
  camino, fechaDeSello, puntaDeFlecha, simplificar, tamanoDeSello, tamanoSinGirar,
  transformacionDeGiro,
} from './dibujo';

describe('simplificar', () => {
  it('una recta con muchos puntos se queda en los dos extremos', () => {
    const recta: Punto[] = Array.from({ length: 50 }, (_, i) => [i / 49, i / 49]);
    expect(simplificar(recta, 0.001)).toEqual([[0, 0], [1, 1]]);
  });

  it('conserva las esquinas', () => {
    const ele: Punto[] = [[0, 0], [0, 0.5], [0, 1], [0.5, 1], [1, 1]];
    expect(simplificar(ele, 0.01)).toEqual([[0, 0], [0, 1], [1, 1]]);
  });

  it('con menos de tres puntos no hay nada que quitar', () => {
    expect(simplificar([[0.3, 0.3]], 0.1)).toEqual([[0.3, 0.3]]);
  });
});

describe('transformacionDeGiro', () => {
  it('cada giro lleva la esquina de arriba a la izquierda a donde toca', () => {
    // La página sin girar mide 100 × 200; girada 90, se ve 200 × 100.
    expect(transformacionDeGiro(0, 100, 200)).toBe('');
    expect(transformacionDeGiro(90, 200, 100)).toBe('translate(200 0) rotate(90)');
    expect(transformacionDeGiro(180, 100, 200)).toBe('translate(100 200) rotate(180)');
    expect(transformacionDeGiro(-90, 200, 100)).toBe('translate(0 100) rotate(270)');
  });

  it('el tamaño sin girar cambia ancho y alto a 90 y 270', () => {
    expect(tamanoSinGirar(90, 200, 100)).toEqual([100, 200]);
    expect(tamanoSinGirar(180, 100, 200)).toEqual([100, 200]);
  });
});

describe('camino y flecha', () => {
  it('el camino va en píxeles', () => {
    expect(camino([[0, 0], [0.5, 1]], 200, 100)).toBe('M0.0 0.0 L100.0 100.0');
  });

  it('la punta de una flecha hacia la derecha abre hacia atrás', () => {
    const d = puntaDeFlecha(0, 0, 100, 0, 10);
    const numeros = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // Los dos extremos de las alas quedan a la izquierda de la punta.
    expect(numeros[0]).toBeLessThan(100);
    expect(numeros[4]).toBeLessThan(100);
    expect(numeros[2]).toBe(100);
  });
});

describe('sellos', () => {
  it('un texto más largo, un sello más ancho, y nunca más que la página', () => {
    const [corto] = tamanoDeSello('OK', 600, 800);
    const [largo] = tamanoDeSello('RECIBIDO EL 6/10/2026', 600, 800);
    expect(largo).toBeGreaterThan(corto);
    expect(tamanoDeSello('X'.repeat(500), 600, 800)[0]).toBeLessThanOrEqual(0.9);
  });

  it('la fecha, como se escribe aquí', () => {
    expect(fechaDeSello(new Date(2026, 9, 6))).toBe('6/10/2026');
  });
});
