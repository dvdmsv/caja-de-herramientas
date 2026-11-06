import { Aleatorio } from './cifrado';
import { GENERADOR_DE_SERIE, LONGITUD_MAXIMA, LONGITUD_MINIMA, generarContrasena } from './generador';

const aleatorio: Aleatorio = bytes => globalThis.crypto.getRandomValues(new Uint8Array(bytes));

describe('generador de contraseñas', () => {
  it('de serie, 20 caracteres de las cuatro familias', () => {
    for (let i = 0; i < 200; i++) {
      const contrasena = generarContrasena(GENERADOR_DE_SERIE, aleatorio);
      expect(contrasena).toHaveLength(20);
      expect(contrasena).toMatch(/[A-Z]/);
      expect(contrasena).toMatch(/[a-z]/);
      expect(contrasena).toMatch(/[0-9]/);
      expect(contrasena).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('sólo usa las familias elegidas', () => {
    const opciones = { longitud: 40, mayusculas: false, minusculas: false, numeros: true, simbolos: false };
    expect(generarContrasena(opciones, aleatorio)).toMatch(/^[0-9]{40}$/);
  });

  it('sin ninguna elegida usa todas, en vez de salir vacía', () => {
    const opciones = { longitud: 30, mayusculas: false, minusculas: false, numeros: false, simbolos: false };
    expect(generarContrasena(opciones, aleatorio)).toHaveLength(30);
  });

  it('recorta la longitud a lo que admite', () => {
    expect(generarContrasena({ ...GENERADOR_DE_SERIE, longitud: 2 }, aleatorio)).toHaveLength(LONGITUD_MINIMA);
    expect(generarContrasena({ ...GENERADOR_DE_SERIE, longitud: 500 }, aleatorio)).toHaveLength(LONGITUD_MAXIMA);
  });

  it('no lleva comillas ni contrabarras: dan problemas al pegarlas', () => {
    const opciones = { ...GENERADOR_DE_SERIE, longitud: LONGITUD_MAXIMA };
    for (let i = 0; i < 100; i++) {
      expect(generarContrasena(opciones, aleatorio)).not.toMatch(/['"`\\]/);
    }
  });

  it('tira los bytes que darían sesgo en vez de usarlos', () => {
    // Con 10 dígitos, de 250 en adelante no llega a dar una vuelta entera: `255 % 10`
    // saldría más veces el 5. Un azar que empieza por ésos tiene que descartarlos.
    const bytes = [255, 250, 3, 255, 7, 251, 1];
    let i = 0;
    const trucado: Aleatorio = () => new Uint8Array([bytes[i++ % bytes.length]]);
    const opciones = { longitud: 8, mayusculas: false, minusculas: false, numeros: true, simbolos: false };

    const contrasena = generarContrasena(opciones, trucado);

    expect(contrasena).toMatch(/^[0-9]{8}$/);
    expect(contrasena).not.toContain('5');
    expect(contrasena).not.toContain('0');
  });

  it('no sale con todas las veces lo mismo', () => {
    const vistas = new Set(Array.from({ length: 50 }, () => generarContrasena(GENERADOR_DE_SERIE, aleatorio)));
    expect(vistas.size).toBe(50);
  });
});
