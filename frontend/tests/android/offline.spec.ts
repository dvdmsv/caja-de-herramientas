import { test, expect } from '@playwright/test';
import * as m from 'mupdf';
import { readFile, readdir } from 'node:fs/promises';

function pdf(nombre: string, texto: string) {
  const doc = new m.PDFDocument(), font = new m.Font('Helvetica');
  const pagina = doc.addPage([0, 0, 300, 400], 0, { Font: { F1: doc.addSimpleFont(font) } },
    `BT /F1 20 Tf 20 350 Td (${texto}) Tj ET`);
  doc.insertPage(-1, pagina);
  const bytes = doc.saveToBuffer('compress');
  const buffer = Buffer.from(bytes.asUint8Array());
  bytes.destroy(); pagina.destroy(); font.destroy(); doc.destroy();
  return { name: nombre, mimeType: 'application/pdf', buffer };
}

test('une, descarga y abre documentos en móvil sin ninguna API ni conexión externa', async ({ page }) => {
  const peticionesProhibidas: string[] = [];
  const errores: string[] = [];
  page.on('pageerror', error => errores.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      peticionesProhibidas.push(url.href); return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Sin conexión.', { exact: false })).toBeVisible();
  await expect(page.locator('main a[href="/herramientas/documento-a-pdf"]').first()).toBeVisible();
  await page.locator('main a[href="/herramientas/unir-pdf"]').first().click();
  await page.locator('app-file-queue input[type=file]').setInputFiles([pdf('uno.pdf', 'Uno'), pdf('dos.pdf', 'Dos')]);
  await page.getByRole('button', { name: /Combinar PDF/ }).click();
  await expect(page.getByText('Tu archivo está listo', { exact: true })).toBeVisible();
  const descargado = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar documento-combinado.pdf/ }).click();
  const download = await descargado;
  const documento = new m.PDFDocument(new Uint8Array(await readFile((await download.path())!)));
  expect(documento.countPages()).toBe(2);
  expect(documento.loadPage(1).toStructuredText().asText()).toContain('Dos');
  documento.destroy();
  await page.getByRole('button', { name: /Ver documento-combinado.pdf/ }).click();
  await page.getByRole('button', { name: 'Abrirlo en el visor' }).click();
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toHaveJSProperty('width', (page.viewportSize()!.width - 20) * 2);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(peticionesProhibidas).toEqual([]);
  expect(errores).toEqual([]);
});

test('el motor de imágenes recorta, gira, convierte y crea PDF con las dimensiones elegidas', async ({ page }) => {
  await page.goto('/');
  const worker = (await readdir('dist/android/browser')).find(n => n.startsWith('worker-') && n.endsWith('.js'))!;
  const resultado = await page.evaluate(async worker => {
    const canvas = new OffscreenCanvas(120, 60), ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 120, 60);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const ejecutar = (slug: string, opciones: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
      const w = new Worker('/' + worker, { type: 'module' });
      w.onerror = () => { w.terminate(); reject(new Error('El worker ha fallado')); };
      w.onmessage = ({ data }) => {
        if (data.tipo === 'progreso') return;
        w.terminate();
        if (data.tipo === 'error') reject(new Error(data.mensaje)); else resolve(data.resultado);
      };
      w.postMessage({ slug, opciones, archivos: [{ name: 'foto.png', blob }] });
    });
    const convertido = await ejecutar('convertir-imagen', { formato: 'JPEG', calidad: 80 });
    const jpeg = await createImageBitmap(convertido.archivos[0].blob);
    const medidasJpeg = [jpeg.width, jpeg.height]; jpeg.close();
    const editado = await ejecutar('editar-imagen', {
      recorte: { x: 0, y: 0, ancho: 0.75, alto: 1 }, giro: 90, espejo: true, calidad: 80,
    });
    const imagen = await createImageBitmap(editado.archivos[0].blob);
    const medidasRecorte = [imagen.width, imagen.height]; imagen.close();
    const pdf = await ejecutar('imagen-a-pdf', { pagina: 'a4', orientacion: 'auto', margen: 10, calidad: 85 });
    return { tipo: convertido.archivos[0].blob.type, medidasJpeg, medidasRecorte,
      pdf: Array.from(new Uint8Array(await pdf.archivos[0].blob.arrayBuffer())) };
  }, worker);
  expect(resultado.tipo).toBe('image/jpeg');
  expect(resultado.medidasJpeg).toEqual([120, 60]);
  expect(resultado.medidasRecorte).toEqual([60, 90]);
  const doc = new m.PDFDocument(new Uint8Array(resultado.pdf));
  expect(doc.countPages()).toBe(1);
  expect(doc.loadPage(0).getBounds()[2]).toBeCloseTo(841.89, 1);
  doc.destroy();
});

test('genera un QR PNG y lo conserva en el almacenamiento privado', async ({ page }) => {
  await page.goto('/herramientas/generar-qr');
  await page.locator('#texto').fill('Hola desde Android sin conexión');
  await page.getByRole('button', { name: /Generar el código/ }).click();
  await expect(page.getByText('Tu archivo está listo', { exact: true })).toBeVisible();
  const descargado = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar codigo-qr.png/ }).click();
  const download = await descargado;
  expect((await readFile((await download.path())!)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await page.reload();
  await page.getByRole('button', { name: /^Espacio en el teléfono/ }).click();
  await expect(page.getByText('Tus archivos permanecen en este teléfono', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Vaciar ahora', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, vaciar', exact: true }).click();
  await expect(page.getByText('No tienes archivos guardados.', { exact: true })).toBeVisible();
});

test('numera y previsualiza localmente antes de descargar', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/herramientas/numerar-paginas');
  await page.locator('app-file-queue input[type=file]').setInputFiles(pdf('numeros.pdf','Texto conservado'));
  await expect(page.locator('app-vista-pagina img')).toBeVisible();
  await page.getByRole('button',{name:/Numerar el PDF/}).click();
  await expect(page.getByText('Tu archivo está listo',{exact:true})).toBeVisible();
  const descarga=page.waitForEvent('download');
  await page.getByRole('button',{name:/Descargar numeros-numerado.pdf/}).click();
  const d=await descarga, doc=new m.PDFDocument(new Uint8Array(await readFile((await d.path())!)));
  const p=doc.loadPage(0), text=p.toStructuredText();
  expect(text.asText()).toContain('Texto conservado'); expect(text.asText()).toContain('1');
  text.destroy();p.destroy();doc.destroy();
});

test('efecto escáner previsualiza y exporta PNG sin API', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/herramientas/efecto-escaner');
  const bytes=await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(200,300),ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#ccc5ad';ctx.fillRect(0,0,200,300);
    ctx.fillStyle='#222';ctx.fillRect(30,80,140,3);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()));
  });
  await page.locator('app-file-queue input[type=file]').setInputFiles({name:'papel.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.locator('app-vista-pagina img')).toBeVisible();
  await page.getByRole('button',{name:/Limpiar las fotos/}).click();
  await expect(page.getByText('Tu archivo está listo',{exact:true})).toBeVisible();
  const descarga=page.waitForEvent('download');
  await page.getByRole('button',{name:/Descargar papel-escaneada.png/}).click();
  const d=await descarga;
  expect((await readFile((await d.path())!)).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
});

test('firma manuscrita y lectura QR usan recursos locales', async ({ page }) => {
  const externas:string[]=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/api/')){externas.push(u.href);return route.abort();}
    return route.continue();
  });
  await page.goto('/');
  const worker=(await readdir('dist/android/browser')).find(n=>n.startsWith('worker-')&&n.endsWith('.js'))!;
  const entrada=pdf('original.pdf','Texto que permanece');
  const result=await page.evaluate(async ({worker,bytes})=>{
    const ejecutar=(p:any)=>new Promise<any>((resolve,reject)=>{
      const w=new Worker('/'+worker,{type:'module'});
      w.onerror=()=>{w.terminate();reject(new Error('Worker fallido'));};
      w.onmessage=({data})=>{if(data.tipo==='progreso')return;w.terminate();if(data.tipo==='error')reject(new Error(data.mensaje));else resolve(data.resultado);};
      w.postMessage(p);
    });
    const canvas=new OffscreenCanvas(120,60),ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,120,60);ctx.fillStyle='blue';ctx.fillRect(20,20,80,5);
    const blob=await canvas.convertToBlob({type:'image/png'});
    const recursos={firma_id:{name:'firma.png',blob}},opciones={quitar_fondo:true,umbral:240};
    const preparado=await ejecutar({slug:'firmar/preparar',archivos:[],recursos,opciones});
    const bitmap=await createImageBitmap(preparado.archivos[0].blob);
    const medidas=[bitmap.width,bitmap.height];bitmap.close();
    const firmado=await ejecutar({slug:'firmar',archivos:[{name:'original.pdf',blob:new Blob([new Uint8Array(bytes)],{type:'application/pdf'})}],recursos,opciones:{...opciones,rotacion:35}});
    const qr=await ejecutar({slug:'generar-qr',archivos:[],opciones:{tipo:'texto',texto:'https://example.com/local',formato:'png'}});
    const leido=await ejecutar({slug:'leer-codigo/inspeccionar',archivos:qr.archivos,opciones:{file_ids:['qr']}});
    const marca=await ejecutar({slug:'marca-de-agua',archivos:[{name:'original.pdf',blob:new Blob([new Uint8Array(bytes)],{type:'application/pdf'})}],recursos:{imagen_id:{name:'logo.png',blob}},opciones:{modo:'imagen',opacidad:50,giro:30,mosaico:true}});
    return {medidas,firmado:Array.from(new Uint8Array(await firmado.archivos[0].blob.arrayBuffer())),informe:leido.datos,marca:Array.from(new Uint8Array(await marca.archivos[0].blob.arrayBuffer()))};
  },{worker,bytes:Array.from(entrada.buffer)});
  expect(result.medidas).toEqual([80,5]);
  for(const bytes of [result.firmado,result.marca]) {
    const doc=new m.PDFDocument(new Uint8Array(bytes)),p=doc.loadPage(0),text=p.toStructuredText();
    expect(text.asText()).toContain('Texto que permanece');
    text.destroy();p.destroy();doc.destroy();
  }
  expect(result.informe.informes[0].codigos[0].contenido).toBe('https://example.com/local');
  expect(externas).toEqual([]);
});

test('visor Markdown local muestra tablas y descarga el PDF del texto pegado',async({page})=>{
  const externas:string[]=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/api/')){externas.push(u.href);return route.abort();}
    return route.continue();
  });
  await page.goto('/herramientas/visor-markdown');
  await page.locator('label[for="modo-texto"]').click();
  await page.locator('#texto-md').fill('# Informe local\n\n| Producto | Precio |\n|---|---|\n| Pan | 2 € |\n\n- [x] Hecho');
  const frame=page.frameLocator('iframe');
  await expect(frame.getByRole('heading',{name:'Informe local'})).toBeVisible();
  await expect(frame.getByRole('cell',{name:'Pan',exact:true})).toBeVisible();
  const descarga=page.waitForEvent('download');
  await page.getByRole('button',{name:'Descargar como PDF',exact:true}).click();
  const archivo=await descarga;
  const doc=new m.PDFDocument(new Uint8Array(await readFile((await archivo.path())!))),p=doc.loadPage(0),texto=p.toStructuredText();
  expect(texto.asText()).toContain('Informe local');expect(texto.asText()).toContain('Pan');
  texto.destroy();p.destroy();doc.destroy();
  expect(externas).toEqual([]);
});

test('compara dos PDF sin conexión y descarga el informe con los cambios',async({page})=>{
  const externas:string[]=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/api/')){externas.push(u.href);return route.abort();}
    return route.continue();
  });
  await page.goto('/herramientas/comparar-pdf');
  await page.locator('app-file-queue input[type=file]').setInputFiles([pdf('antes.pdf','Precio 100'),pdf('despues.pdf','Precio 200')]);
  await page.getByRole('button',{name:'Comparar',exact:true}).click();
  await expect(page.getByText(/1 páginas cambiadas/)).toBeVisible();
  const descarga=page.waitForEvent('download');
  await page.getByRole('button',{name:'Descargar antes-vs-despues.pdf',exact:true}).click();
  const archivo=await descarga,doc=new m.PDFDocument(new Uint8Array(await readFile((await archivo.path())!)));
  try {
    expect(doc.countPages()).toBeGreaterThan(1);
    const p=doc.loadPage(0),t=p.toStructuredText();
    expect(t.asText()).toContain('Precio 100');expect(t.asText()).toContain('Precio 200');
    t.destroy();p.destroy();
  }finally{doc.destroy();}
  expect(externas).toEqual([]);
});

test('inspecciona datos personales y descarga el PDF con el texto realmente eliminado',async({page})=>{
  const externas:string[]=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/api/')){externas.push(u.href);return route.abort();}
    return route.continue();
  });
  await page.goto('/herramientas/anonimizar-pdf');
  await page.locator('app-file-queue input[type=file]').setInputFiles(pdf('datos.pdf','DNI 12345678Z'));
  await expect(page.getByText('Se van a tachar 1 cosa:',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Tachar los datos',exact:true}).click();
  const boton=page.getByRole('button',{name:'Descargar datos-anonimizado.pdf',exact:true});
  await expect(boton).toBeVisible();
  const descarga=page.waitForEvent('download');await boton.click();
  const archivo=await descarga,doc=new m.PDFDocument(new Uint8Array(await readFile((await archivo.path())!)));
  try {
    const p=doc.loadPage(0),t=p.toStructuredText();
    expect(t.asText()).not.toContain('12345678');expect(t.asText()).toContain('DNI');
    expect(p.getAnnotations()).toHaveLength(0);t.destroy();p.destroy();
  }finally{doc.destroy();}
  expect(externas).toEqual([]);
});

test('el probador de expresiones funciona localmente y corta un patrón atascado sin bloquear la interfaz',async({page})=>{
  const externas:string[]=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1'||u.pathname.startsWith('/api/')){externas.push(u.href);return route.abort();}
    return route.continue();
  });
  await page.goto('/herramientas/anonimizar-pdf');
  await page.getByRole('button',{name:'No sé escribirla: ayúdame',exact:true}).click();
  await page.locator('#anon-patron').fill('^(a+)+$');
  await page.locator('app-constructor-regex textarea').fill('a'.repeat(100)+'!');
  // Esperar al arranque del worker y comprobar que la interfaz sigue atendiendo.
  await page.waitForTimeout(800);
  const blanco=page.getByRole('button',{name:'Un hueco en blanco',exact:true});await blanco.click();
  await expect(blanco).toHaveClass(/btn-primary/);
  await expect(page.locator('app-constructor-regex [role=alert]')).toContainText('diez segundos',{timeout:15_000});
  await page.locator('#anon-patron').fill('EXP\\-\\d{4}');
  await page.locator('app-constructor-regex textarea').fill('🙂 EXP-2026\nEXP-26');
  await expect(page.locator('app-constructor-regex mark')).toHaveText('EXP-2026');
  expect(externas).toEqual([]);
});

test('las trece herramientas portadas abren sus controles sin errores de ejecución', async ({page}) => {
  const errores:string[]=[];
  page.on('pageerror',e=>errores.push(e.message));
  for(const slug of ['comprimir-pdf','correo-a-pdf','limpiar-metadatos','extraer-tablas','pdf-a-epub','a-markdown','pdf-a-word','ocr-pdf','pdf-a-pdfa','comprobar-firmas','firmar-certificado','marca-de-tiempo','documento-a-pdf']) {
    await page.goto('/herramientas/'+slug);
    await expect(page.locator('app-tool-page')).toBeVisible();
    await expect(page.locator('app-file-queue').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/herramientas/'+slug);
  }
  expect(errores).toEqual([]);
});
