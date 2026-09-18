import { avance, EstadoTrabajo, textoTranscurrido, TOPE_ESTIMADO } from './progreso';

const pasos = (hechos: number, total: number, etapa = 'Convirtiendo páginas'): EstadoTrabajo =>
  ({ modo: 'pasos', etapa, desde: 0, cancelable: true, hechos, total });
const estimado = (segundos: number, etapa = 'Reconociendo el texto'): EstadoTrabajo =>
  ({ modo: 'estimado', etapa, desde: 0, cancelable: true, estimado: segundos });

describe('leer el parte de un trabajo', () => {
  it('sin parte, el trabajo está en la cola y se dice', () => {
    // Que no haya nada no es un hueco: es que aún no ha empezado, y eso es
    // exactamente lo que no se sabía antes.
    const leido = avance(null, 3000);

    expect(leido.indeterminado).toBe(true);
    expect(leido.etapa).toBe('Esperando turno');
  });

  it('con pasos, el porcentaje es de verdad y el detalle los cuenta', () => {
    const leido = avance(pasos(7, 40), 12_000);

    expect(leido.porcentaje).toBe(18);
    expect(leido.indeterminado).toBe(false);
    expect(leido.etapa).toBe('Convirtiendo páginas');
    expect(leido.detalle).toBe('7 de 40 · lleva 12 s');
  });

  it('lo estimado no pasa del tope aunque el reloj se pase', () => {
    // El 100 % lo pone la respuesta del servidor, no el reloj: una barra
    // clavada en el 100 miente más que una clavada en el 95.
    expect(avance(estimado(40), 20_000).porcentaje).toBe(50);
    expect(avance(estimado(40), 39_000).porcentaje).toBe(TOPE_ESTIMADO);
    expect(avance(estimado(40), 400_000).porcentaje).toBe(TOPE_ESTIMADO);
  });

  it('una etapa sin pasos —maquetar, guardar— sale indeterminada', () => {
    const leido = avance(pasos(0, 0, 'Maquetando el informe'), 5000);

    expect(leido.indeterminado).toBe(true);
    expect(leido.etapa).toBe('Maquetando el informe');
    expect(leido.detalle).toBe('lleva 5 s');
  });

  it('ningún texto predice lo que queda', () => {
    const textos = [avance(null, 1000), avance(pasos(1, 10), 1000), avance(estimado(30), 1000)]
      .flatMap(leido => [leido.etapa, leido.detalle]);

    expect(textos.some(texto => /quedan?|falta/i.test(texto))).toBe(false);
  });

  it('aguanta un parte con cifras imposibles', () => {
    expect(avance(pasos(-3, 10), 0).porcentaje).toBe(0);
    expect(avance(pasos(99, 10), 0).porcentaje).toBe(100);
    expect(avance({ ...estimado(0), estimado: 0 }, 500).porcentaje).toBeLessThanOrEqual(TOPE_ESTIMADO);
    expect(avance(pasos(1, 3), -5000).detalle).toBe('1 de 3 · lleva 0 s');
  });

  it('el tiempo transcurrido se lee como lo diría una persona', () => {
    expect(textoTranscurrido(0)).toBe('lleva 0 s');
    expect(textoTranscurrido(59_900)).toBe('lleva 59 s');
    expect(textoTranscurrido(60_000)).toBe('lleva 1 min');
    expect(textoTranscurrido(72_000)).toBe('lleva 1 min 12 s');
    expect(textoTranscurrido(3_600_000)).toBe('lleva 60 min');
  });
});
