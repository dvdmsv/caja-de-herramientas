import { desglosar } from './codigos';

describe('desglosar el contenido de un código', () => {
  it('saca el nombre de la red y la contraseña de un QR de wifi', () => {
    expect(desglosar('wifi', 'WIFI:S:Oficina;T:WPA;P:clave1234;;')).toEqual([
      { etiqueta: 'Red', valor: 'Oficina' },
      { etiqueta: 'Seguridad', valor: 'WPA/WPA2' },
      { etiqueta: 'Contraseña', valor: 'clave1234' },
    ]);
  });

  it('respeta los caracteres escapados de la sintaxis del wifi', () => {
    // Una contraseña con `;` dentro es legal; partir a lo bruto la cortaría.
    const campos = desglosar('wifi', 'WIFI:S:Casa\\;2;T:WPA;P:a\\;b\\:c;;');
    expect(campos[0].valor).toBe('Casa;2');
    expect(campos[2].valor).toBe('a;b:c');
  });

  it('dice que una red abierta no tiene contraseña', () => {
    expect(desglosar('wifi', 'WIFI:S:Bar;T:nopass;;')).toEqual([
      { etiqueta: 'Red', valor: 'Bar' },
      { etiqueta: 'Seguridad', valor: 'Abierta, sin contraseña' },
    ]);
  });

  it('marca las redes ocultas', () => {
    const campos = desglosar('wifi', 'WIFI:S:Oculta;T:WPA;P:x;H:true;;');
    expect(campos[campos.length - 1]).toEqual({ etiqueta: 'Red oculta', valor: 'Sí' });
  });

  it('separa la dirección, el asunto y el mensaje de un mailto', () => {
    expect(desglosar('correo', 'mailto:ana@ejemplo.es?subject=Hola&body=Qu%C3%A9%20tal')).toEqual([
      { etiqueta: 'Para', valor: 'ana@ejemplo.es' },
      { etiqueta: 'Asunto', valor: 'Hola' },
      { etiqueta: 'Mensaje', valor: 'Qué tal' },
    ]);
  });

  it('lee un mailto pelado', () => {
    expect(desglosar('correo', 'mailto:ana@ejemplo.es'))
      .toEqual([{ etiqueta: 'Para', valor: 'ana@ejemplo.es' }]);
  });

  it('lee un teléfono y un SMS con su mensaje', () => {
    expect(desglosar('telefono', 'tel:+34600123456'))
      .toEqual([{ etiqueta: 'Número', valor: '+34600123456' }]);
    expect(desglosar('telefono', 'SMSTO:600123456:llego tarde')).toEqual([
      { etiqueta: 'Número', valor: '600123456' },
      { etiqueta: 'Mensaje', valor: 'llego tarde' },
    ]);
  });

  it('lee una vCard con parámetros en sus líneas', () => {
    const tarjeta = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ana Ruiz', 'N:Ana Ruiz;;;;',
                     'ORG:Ejemplo SL', 'TEL;TYPE=CELL:600123456',
                     'EMAIL:ana@ejemplo.es', 'END:VCARD'].join('\n');

    expect(desglosar('contacto', tarjeta)).toEqual([
      { etiqueta: 'Nombre', valor: 'Ana Ruiz' },
      { etiqueta: 'Organización', valor: 'Ejemplo SL' },
      { etiqueta: 'Teléfono', valor: '600123456' },
      { etiqueta: 'Correo', valor: 'ana@ejemplo.es' },
    ]);
  });

  it('lee también un MECARD', () => {
    expect(desglosar('contacto', 'MECARD:N:Ana Ruiz;TEL:600123456;;')).toEqual([
      { etiqueta: 'Nombre', valor: 'Ana Ruiz' },
      { etiqueta: 'Teléfono', valor: '600123456' },
    ]);
  });

  it('no desglosa lo que se lee tal cual', () => {
    expect(desglosar('enlace', 'https://ejemplo.es')).toEqual([]);
    expect(desglosar('texto', '5901234123457')).toEqual([]);
  });
});
