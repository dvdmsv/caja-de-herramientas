import { ayudaTactil } from './tactil';

describe('ayudaTactil', () => {
  it('cambia el gesto y quita el «haz clic» de la ayuda por defecto', () => {
    expect(ayudaTactil('Arrastra tus archivos aquí o haz clic para elegirlos'))
      .toBe('Toca para elegir tus archivos');
    expect(ayudaTactil('Arrastra tu PDF aquí o haz clic para elegirlo')).toBe('Toca para elegir tu PDF');
    expect(ayudaTactil('Arrastra tus imágenes aquí o haz clic para elegirlas'))
      .toBe('Toca para elegir tus imágenes');
  });

  it('quita el «aquí» del principio', () => {
    expect(ayudaTactil('Arrastra aquí el PDF escaneado')).toBe('Toca para elegir el PDF escaneado');
    expect(ayudaTactil('Arrastra aquí tus documentos: PDF, Word, Excel, PowerPoint…'))
      .toBe('Toca para elegir tus documentos: PDF, Word, Excel, PowerPoint…');
  });

  it('conserva el resto de la frase tal cual', () => {
    expect(ayudaTactil('Arrastra el pantallazo, la foto o el PDF con el código'))
      .toBe('Toca para elegir el pantallazo, la foto o el PDF con el código');
    expect(ayudaTactil('Arrastra la foto que quieras recortar'))
      .toBe('Toca para elegir la foto que quieras recortar');
  });

  it('deja en paz lo que no habla de arrastrar', () => {
    expect(ayudaTactil('Una foto de tu firma sobre papel vale perfectamente'))
      .toBe('Una foto de tu firma sobre papel vale perfectamente');
  });
});
