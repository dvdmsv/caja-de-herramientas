import { alturaDeDestino, destinoDeAccion, urlAbrible } from './enlaces';

describe('alturaDeDestino', () => {
  const pagina = { num: 3, gen: 0 };

  it('XYZ lleva la altura en la cuarta posición', () => {
    expect(alturaDeDestino([pagina, { name: 'XYZ' }, 72, 500, 0])).toBe(500);
  });

  it('XYZ sin altura (null) no fija ninguna', () => {
    expect(alturaDeDestino([pagina, { name: 'XYZ' }, null, null, null])).toBeNull();
  });

  it('FitH y FitBH llevan la altura en la tercera', () => {
    expect(alturaDeDestino([pagina, { name: 'FitH' }, 300])).toBe(300);
    expect(alturaDeDestino([pagina, { name: 'FitBH' }, 120])).toBe(120);
  });

  it('FitR usa el borde de arriba del recuadro', () => {
    expect(alturaDeDestino([pagina, { name: 'FitR' }, 10, 100, 200, 400])).toBe(400);
  });

  it('Fit es la página entera', () => {
    expect(alturaDeDestino([pagina, { name: 'Fit' }])).toBeNull();
  });
});

describe('destinoDeAccion', () => {
  it('siguiente y anterior, sin salirse del documento', () => {
    expect(destinoDeAccion('NextPage', 4, 10)).toBe(5);
    expect(destinoDeAccion('NextPage', 10, 10)).toBe(10);
    expect(destinoDeAccion('PrevPage', 1, 10)).toBe(1);
  });

  it('primera y última', () => {
    expect(destinoDeAccion('FirstPage', 7, 10)).toBe(1);
    expect(destinoDeAccion('LastPage', 2, 10)).toBe(10);
  });

  it('lo que no es de navegar no lleva a ningún sitio', () => {
    expect(destinoDeAccion('Print', 2, 10)).toBeNull();
  });
});

describe('urlAbrible', () => {
  it('web y correo, sí', () => {
    expect(urlAbrible('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(urlAbrible('mailto:alguien@example.com')).toBe('mailto:alguien@example.com');
  });

  it('javascript, file y esquemas de programas, no', () => {
    expect(urlAbrible('javascript:alert(1)')).toBeNull();
    expect(urlAbrible('file:///C:/Windows/system32/calc.exe')).toBeNull();
    expect(urlAbrible('ms-settings:privacy')).toBeNull();
  });

  it('lo que no es una dirección, tampoco', () => {
    expect(urlAbrible('no es una url')).toBeNull();
    expect(urlAbrible(undefined)).toBeNull();
  });
});
