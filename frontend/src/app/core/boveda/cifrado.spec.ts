import {
  BovedaIlegible, ContrasenaIncorrecta, aBase64, cifrar, deBase64, derivarClave, descifrar, leerBovedaCifrada,
  parametrosNuevos,
} from './cifrado';

/** El WebCrypto de Node, que también tiene `subtle`. Pocas iteraciones: el test no mide la lentitud. */
const subtle = globalThis.crypto.subtle;
const aleatorio = (bytes: number) => globalThis.crypto.getRandomValues(new Uint8Array(bytes));
const parametros = () => parametrosNuevos(aleatorio, 1000);

describe('cifrado de la bóveda', () => {
  it('lo cifrado con una contraseña se descifra con ella', async () => {
    const p = parametros();
    const clave = await derivarClave(subtle, 'correcta caballo pila grapa', p);
    const contenido = { certificados: [{ id: 'a', nombre: 'Mío' }], firmas: [] };

    const boveda = await cifrar(subtle, clave, p, contenido, aleatorio);
    const leida = leerBovedaCifrada(JSON.stringify(boveda));

    expect(await descifrar(subtle, clave, leida)).toEqual(contenido);
  });

  it('con otra contraseña no se abre, y lo dice', async () => {
    const p = parametros();
    const boveda = await cifrar(subtle, await derivarClave(subtle, 'buena', p), p, { a: 1 }, aleatorio);

    await expect(descifrar(subtle, await derivarClave(subtle, 'mala', p), boveda))
      .rejects.toBeInstanceOf(ContrasenaIncorrecta);
  });

  it('no deja nada legible en el archivo: ni nombres ni el certificado', async () => {
    const p = parametros();
    const clave = await derivarClave(subtle, 'x', p);
    const p12 = 'MIIKpAIBAzCCCm4GCSqGSIb3DQEHAaCCCl8Egg';
    const texto = JSON.stringify(await cifrar(subtle, clave, p,
      { certificados: [{ nombre: 'Certificado de Pepa', titular: 'PEPA PÉREZ', p12 }] }, aleatorio));

    expect(texto).not.toContain('Pepa');
    expect(texto).not.toContain('PÉREZ');
    expect(texto).not.toContain('MII');
  });

  it('cada guardado lleva un IV nuevo: lo mismo dos veces no se parece', async () => {
    const p = parametros();
    const clave = await derivarClave(subtle, 'x', p);
    const una = await cifrar(subtle, clave, p, { a: 1 }, aleatorio);
    const otra = await cifrar(subtle, clave, p, { a: 1 }, aleatorio);

    expect(una.iv).not.toBe(otra.iv);
    expect(una.datos).not.toBe(otra.datos);
  });

  it('tocar la cabecera hace fallar el descifrado: va autenticada', async () => {
    const p = parametros();
    const clave = await derivarClave(subtle, 'x', p);
    const boveda = await cifrar(subtle, clave, p, { a: 1 }, aleatorio);

    const tocada = { ...boveda, clave: { ...boveda.clave, iteraciones: boveda.clave.iteraciones + 1 } };
    await expect(descifrar(subtle, clave, tocada)).rejects.toBeInstanceOf(ContrasenaIncorrecta);
  });

  it('un archivo que no es una bóveda, o de un formato que no se conoce, se dice como tal', () => {
    expect(() => leerBovedaCifrada('no es json')).toThrow(BovedaIlegible);
    expect(() => leerBovedaCifrada('{}')).toThrow(BovedaIlegible);
    expect(() => leerBovedaCifrada(JSON.stringify({ formato: 2, clave: {}, iv: '', datos: '' })))
      .toThrow(BovedaIlegible);
  });

  it('el base64 va y vuelve también con algo grande', () => {
    const grande = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256);
    expect(deBase64(aBase64(grande))).toEqual(grande);
  });

  it('la sal es nueva cada vez y lleva las iteraciones de verdad de serie', () => {
    const una = parametrosNuevos(aleatorio);
    expect(una.iteraciones).toBe(600_000);
    expect(una.sal).not.toBe(parametrosNuevos(aleatorio).sal);
  });
});
