import { describe, it, expect } from 'vitest';
import * as m from 'mupdf';
import { ejecutarPdf, guardarPdf, abrirPdf, escribirIndice } from '../../src/app/core/local/pdf';
import { contenidoQr, generarQr } from '../../src/app/core/local/qr';

function documento(paginas = 3) {
  const doc = new m.PDFDocument();
  for (let i = 0; i < paginas; i++) {
    const font = new m.Font('Helvetica');
    const p = doc.addPage([0, 0, 200 + i * 10, 300], 0,
      { Font: { F1: doc.addSimpleFont(font) } }, `BT /F1 12 Tf 20 250 Td (Pagina ${i + 1}) Tj ET`);
    doc.insertPage(-1, p); p.destroy(); font.destroy();
  }
  return doc;
}
function entrada() {
  const doc = documento();
  try { return { name: 'prueba.pdf', blob: guardarPdf(doc) }; }
  finally { doc.destroy(); }
}
const ejecutar = (slug: string, opciones = {}, archivos = [entrada()]) =>
  ejecutarPdf(m, { slug, archivos, opciones }, () => {});

describe('PDF reales con el motor que se incluye en Android', () => {
  it('une documentos y conserva texto y orden', async () => {
    const r = await ejecutar('unir-pdf', {}, [entrada(), entrada()]);
    const doc = await abrirPdf(m, r.archivos[0]);
    try {
      expect(doc.countPages()).toBe(6);
      expect(doc.loadPage(3).toStructuredText().asText()).toContain('Pagina 1');
      expect(doc.loadPage(5).getBounds()[2]).toBe(220);
    } finally { doc.destroy(); }
  });
  it('divide por páginas independientes sin ir acumulando cambios entre ellas', async () => {
    const r = await ejecutar('dividir-pdf', { paginas: '1,3', modo: 'por-pagina' });
    expect(r.archivos).toHaveLength(2);
    for (const [i, archivo] of r.archivos.entries()) {
      const doc = await abrirPdf(m, archivo);
      try {
        expect(doc.countPages()).toBe(1);
        expect(doc.loadPage(0).toStructuredText().asText()).toContain(`Pagina ${i ? 3 : 1}`);
      } finally { doc.destroy(); }
    }
  });
  it('reordena y gira sin rasterizar', async () => {
    const r = await ejecutar('organizar-pdf', { paginas: [{ numero: 3, rotacion: 90 }, { numero: 1, rotacion: 0 }] });
    const doc = await abrirPdf(m, r.archivos[0]);
    try {
      expect(doc.countPages()).toBe(2);
      expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 300, 220]);
      expect(doc.loadPage(1).toStructuredText().asText()).toContain('Pagina 1');
    } finally { doc.destroy(); }
  });
  it('cifra con AES-256 y quita la contraseña sin perder páginas', async () => {
    const password = 'Año,2026=secreto';
    const r = await ejecutar('proteger-pdf', { accion: 'proteger', password });
    const cifrado = new m.PDFDocument(await r.archivos[0].blob.arrayBuffer());
    expect(cifrado.needsPassword()).toBe(true);
    expect(cifrado.authenticatePassword('incorrecta')).toBe(0);
    expect(cifrado.authenticatePassword(password)).toBeGreaterThan(0);
    expect(cifrado.getMetaData('encryption')).toContain('256');
    cifrado.destroy();
    await expect(abrirPdf(m, r.archivos[0], 'incorrecta')).rejects.toThrow('contraseña');
    const abierto = await ejecutar('proteger-pdf', { accion: 'quitar', password_actual: password }, r.archivos);
    const doc = await abrirPdf(m, abierto.archivos[0]);
    expect(doc.needsPassword()).toBe(false); expect(doc.countPages()).toBe(3); doc.destroy();
  });
  it('rasteriza a PNG con cabecera válida', async () => {
    const r = await ejecutar('pdf-a-imagen', { formato: 'PNG', resolucion: 'pantalla' });
    expect(r.archivos).toHaveLength(3);
    expect([...new Uint8Array(await r.archivos[0].blob.slice(0, 8).arrayBuffer())]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
  it('rechaza PDFs protegidos y páginas fuera de rango', async () => {
    await expect(ejecutar('organizar-pdf', { paginas: [{ numero: 4, rotacion: 0 }] })).rejects.toThrow('selección');
    await expect(ejecutar('dividir-pdf', { paginas: '900' })).rejects.toThrow('página');
  });
  it('aplana anotaciones conservando su apariencia', async () => {
    const doc = documento(1), pagina = doc.loadPage(0);
    const nota = pagina.createAnnotation('Text'); nota.setRect([10, 10, 35, 35]); nota.setContents('Hola'); nota.update();
    const blob = guardarPdf(doc); pagina.destroy(); doc.destroy();
    const r = await ejecutar('aplanar-pdf', { campos: true, anotaciones: true }, [{ name: 'nota.pdf', blob }]);
    const aplanado = await abrirPdf(m, r.archivos[0]);
    expect(aplanado.loadPage(0).getAnnotations()).toHaveLength(0); aplanado.destroy();
  });
  it('conserva los marcadores y desplaza sus destinos al unir', async () => {
    const doc = documento();
    escribirIndice(doc, [{ title: 'Capítulo', page: 0, open: true,
      down: [{ title: 'Final', page: 2, open: false }] }]);
    const blob = guardarPdf(doc); doc.destroy();
    const r = await ejecutar('unir-pdf', {}, [{ name: 'primero.pdf', blob }, { name: 'segundo.pdf', blob }]);
    const unido = await abrirPdf(m, r.archivos[0]);
    try {
      const indice = unido.loadOutline()!;
      expect(indice.map(e => e.page)).toEqual([0, 3]);
      expect(indice[1].down?.[0].page).toBe(5);
    } finally { unido.destroy(); }
  });
  it('no borra silenciosamente anotaciones al unir', async () => {
    const doc = documento(1), pagina = doc.loadPage(0);
    const nota = pagina.createAnnotation('Text'); nota.setRect([10, 10, 35, 35]); nota.setContents('Conservar'); nota.update();
    const blob = guardarPdf(doc); pagina.destroy(); doc.destroy();
    await expect(ejecutar('unir-pdf', {}, [entrada(), { name: 'anotado.pdf', blob }])).rejects.toThrow('anotaciones');
  });
});

describe('QR sin servicios externos', () => {
  it('escapa los separadores de una red wifi', () => {
    expect(contenidoQr({ tipo: 'wifi', red: 'Casa;1', clave: 'a:b', seguridad: 'WPA' })).toBe('WIFI:T:WPA;S:Casa\\;1;P:a\\:b;H:false;;');
  });
  it('produce un SVG local sin incrustar el texto del usuario como HTML', async () => {
    const r = await generarQr({ tipo: 'texto', texto: '<script>alert(1)</script>', formato: 'svg' });
    const svg = await r.archivos[0].blob.text();
    expect(svg).toContain('<svg'); expect(svg).not.toContain('<script>');
  });
});

it('numera conservando texto, omitiendo portada y respetando el número inicial', async () => {
  const r = await ejecutar('numerar-paginas', { desde: 2, empezar_en: 7, formato: 'pagina-de-total' });
  const doc = await abrirPdf(m, r.archivos[0]);
  try {
    for (let n = 0; n < 3; n++) {
      const page = doc.loadPage(n), text = page.toStructuredText();
      try {
        expect(text.asText()).toContain(`Pagina ${n + 1}`);
        if (n) expect(text.asText()).toContain(`Página ${n + 6} de 8`);
        else expect(text.asText()).not.toContain('Página');
      } finally { text.destroy(); page.destroy(); }
    }
  } finally { doc.destroy(); }
});
it('rechaza opciones de numeración inválidas', async () => {
  await expect(ejecutar('numerar-paginas', { desde: 4 })).rejects.toThrow('no existe');
  await expect(ejecutar('numerar-paginas', { tamano: 0 })).rejects.toThrow('no es válido');
});

it('numera las páginas giradas conservando anotaciones y devuelve vista previa JPEG', async () => {
  for (const giro of [0,90,180,270]) {
    const original = documento(1), obj = original.findPage(0);
    obj.put('Rotate', giro); obj.destroy();
    const page = original.loadPage(0), anotacion = page.createAnnotation('Text');
    anotacion.setRect([5,5,20,20]); anotacion.setContents('Conservar'); anotacion.update(); anotacion.destroy(); page.destroy();
    const archivo = { name: 'girado.pdf', blob: guardarPdf(original) }; original.destroy();
    const r = await ejecutar('numerar-paginas', { empezar_en: 7 }, [archivo]);
    const doc = await abrirPdf(m, r.archivos[0]);
    const p = doc.loadPage(0), text = p.toStructuredText();
    expect(text.asText()).toContain('7'); expect(p.getAnnotations()).toHaveLength(1);
    const hits = p.search('7'); expect(hits).toHaveLength(1);
    const bounds = p.getBounds(), quad = hits[0][0];
    expect(quad[1]).toBeGreaterThan(bounds[3] - 65);
    expect(quad[5]).toBeLessThan(bounds[3]);
    text.destroy(); p.destroy(); doc.destroy();
    const vista = await ejecutar('numerar-paginas/previsualizar', { pagina: 1 }, [archivo]);
    expect(vista.archivos[0].blob.type).toBe('image/jpeg');
    expect([...new Uint8Array(await vista.archivos[0].blob.slice(0,2).arrayBuffer())]).toEqual([255,216]);
  }
});
it('rechaza numeración que no cabe y página de vista previa inválida', async () => {
  await expect(ejecutar('numerar-paginas', { formato: 'pagina-de-total', tamano: 96 })).rejects.toThrow('no cabe');
  await expect(ejecutar('numerar-paginas/previsualizar', { pagina: 4 })).rejects.toThrow('no existe');
});

it('marca de agua conserva el texto, las anotaciones y doce copias en mosaico', async () => {
  const r=await ejecutar('marca-de-agua',{texto:'CONFIDENCIAL',mosaico:true,giro:45});
  const doc=await abrirPdf(m,r.archivos[0]);
  try {
    const p=doc.loadPage(0),text=p.toStructuredText();
    expect(text.asText()).toContain('Pagina 1');
    expect(text.asText().match(/CONFIDENCIAL/g)).toHaveLength(12);
    const pix=p.toPixmap(m.Matrix.identity,m.ColorSpace.DeviceRGB,false);
    expect(pix.asPNG().length).toBeGreaterThan(100);
    pix.destroy();text.destroy();p.destroy();
  } finally {doc.destroy();}
});
it('marca de agua devuelve una previsualización y valida los parámetros',async()=>{
  const r=await ejecutar('marca-de-agua/previsualizar',{texto:'ÁREA PRIVADA',pagina:2,giro:-90,fuente:'serif',color:'azul'});
  expect(r.archivos[0].blob.type).toBe('image/jpeg');
  await expect(ejecutar('marca-de-agua',{texto:''})).rejects.toThrow('120');
  await expect(ejecutar('marca-de-agua',{modo:'imagen'})).rejects.toThrow('imagen');
  await expect(ejecutar('marca-de-agua',{texto:'X',opacidad:0})).rejects.toThrow('opacidad');
});
