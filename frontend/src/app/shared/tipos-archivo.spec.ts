import { describirFormatos, encaja, explicarRechazo, extensionDe, queElegir, tipoDeVistaPrevia } from './tipos-archivo';

describe('tipoDeVistaPrevia', () => {
  it('reconoce los PDF', () => {
    expect(tipoDeVistaPrevia('documento-combinado.pdf')).toBe('pdf');
  });

  it('reconoce las imágenes que el navegador sabe pintar', () => {
    ['foto.jpg', 'foto.jpeg', 'foto.png', 'foto.webp', 'foto.gif', 'foto.bmp', 'foto.avif',
     'codigo-qr.svg']
      .forEach(nombre => expect(tipoDeVistaPrevia(nombre), nombre).toBe('imagen'));
  });

  it('reconoce el texto plano', () => {
    ['notas.md', 'notas.txt', 'datos.csv', 'datos.json', 'datos.xml', 'pagina.html', 'pagina.htm']
      .forEach(nombre => expect(tipoDeVistaPrevia(nombre), nombre).toBe('texto'));
  });

  it('no ofrece vista previa de lo que el navegador no sabe abrir', () => {
    // .tiff lo genera "Convertir imagen", pero ningún navegador lo pinta.
    ['informe.docx', 'escaneado.tiff', 'resultados.zip', 'sinextension'].forEach(
      nombre => expect(tipoDeVistaPrevia(nombre), nombre).toBeNull());
  });

  it('no distingue mayúsculas de minúsculas', () => {
    expect(tipoDeVistaPrevia('FOTO.PNG')).toBe('imagen');
    expect(tipoDeVistaPrevia('Informe.Pdf')).toBe('pdf');
  });

  it('se queda con la última extensión', () => {
    expect(tipoDeVistaPrevia('informe.final.pdf')).toBe('pdf');
    expect(tipoDeVistaPrevia('copia.pdf.docx')).toBeNull();
  });

  it('no confunde un nombre oculto con una extensión', () => {
    // ".perfil" empieza por punto: es el nombre entero, no una extensión.
    expect(tipoDeVistaPrevia('.pdf')).toBeNull();
  });
});

describe('extensionDe', () => {
  it('devuelve la extensión en minúsculas y con punto', () => {
    expect(extensionDe('Informe.PDF')).toBe('.pdf');
  });

  it('devuelve cadena vacía si no hay extensión', () => {
    expect(extensionDe('sinextension')).toBe('');
    expect(extensionDe('.oculto')).toBe('');
  });
});

describe('encaja', () => {
  const pdf = { name: 'Informe.PDF', type: 'application/pdf' };
  const foto = { name: 'foto.jpg', type: 'image/jpeg' };
  const sinTipo = { name: 'foto.webp', type: '' };
  const docx = { name: 'carta.docx', type: '' };

  it('un accept vacío lo admite todo', () => {
    expect(encaja(docx, '')).toBe(true);
  });

  it('compara extensiones sin distinguir mayúsculas', () => {
    expect(encaja(pdf, '.pdf')).toBe(true);
    expect(encaja(docx, '.pdf')).toBe(false);
  });

  it('reconoce imágenes por tipo y, si no lo traen, por extensión', () => {
    expect(encaja(foto, 'image/*')).toBe(true);
    expect(encaja(sinTipo, 'image/*')).toBe(true);
    expect(encaja(pdf, 'image/*')).toBe(false);
  });

  it('con varios patrones basta con que encaje uno', () => {
    expect(encaja(foto, '.pdf,image/*')).toBe(true);
    expect(encaja(docx, '.pdf, image/*')).toBe(false);
  });
});

describe('cómo se nombran los formatos', () => {
  it('describirFormatos', () => {
    expect(describirFormatos('.pdf')).toBe('PDF');
    expect(describirFormatos('image/*')).toBe('imágenes');
    expect(describirFormatos('.pdf,image/*')).toBe('PDF o imágenes');
    expect(describirFormatos('.docx,.doc,.txt')).toBe('DOCX, DOC o TXT');
  });

  it('queElegir', () => {
    expect(queElegir('.pdf')).toBe('un PDF');
    expect(queElegir('image/*')).toBe('una imagen');
    expect(queElegir('.pdf,image/*')).toBe('un PDF o una imagen');
    expect(queElegir('.pdf,.docx,.xlsx,.pptx')).toBe('un archivo');
    expect(queElegir('')).toBe('un archivo');
  });
});

describe('explicarRechazo', () => {
  it('no dice nada si no se ha descartado nada', () => {
    expect(explicarRechazo({ noAdmitidos: [], repetidos: [] }, '.pdf')).toBeNull();
  });

  it('nombra el archivo cuando es uno y cuenta cuando son varios', () => {
    expect(explicarRechazo({ noAdmitidos: ['carta.docx'], repetidos: [] }, '.pdf'))
      .toBe('«carta.docx» no vale aquí: esta herramienta admite PDF.');
    expect(explicarRechazo({ noAdmitidos: ['a.docx', 'b.xlsx'], repetidos: [] }, '.pdf'))
      .toBe('2 archivos no valen aquí: esta herramienta admite PDF.');
  });

  it('avisa de repetidos y de los que sobran en herramientas de un solo archivo', () => {
    expect(explicarRechazo({ noAdmitidos: [], repetidos: ['a.pdf'], conservado: 'b.pdf' }, '.pdf'))
      .toBe('«a.pdf» ya estaba en la lista. Esta herramienta trabaja con un archivo cada vez: se ha quedado «b.pdf».');
  });
});
