// Comprueba que la página de la aplicación instalada puede hablar con Tauri.
//
// Existe porque durante tres versiones no podía y nadie se enteró: los comandos
// propios de main.rs no tenían permiso («not allowed by ACL»), y el frontend caía
// en silencio a lo del navegador —«Guardar» iba a Descargas y «Abrir con…» no
// llegaba—. Los tests de Rust y de Angular no lo ven; sólo se ve con la
// aplicación de verdad.
//
// Se conecta por CDP al WebView2 de la aplicación, que tiene que haberse
// arrancado con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
// Necesita playwright-core (sin navegador: usa el de la aplicación).
//
//   node escritorio/scripts/comprobar-puente.js [versión esperada]
const { chromium } = require('playwright-core');

const esperada = process.argv[2];

(async () => {
  let navegador;
  for (let intento = 0; intento < 60 && !navegador; intento++) {
    try {
      navegador = await chromium.connectOverCDP('http://127.0.0.1:9222');
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (!navegador) throw new Error('El WebView2 de la aplicación no abre el puerto de depuración.');

  // La página del backend, no la de arranque: puede tardar unos segundos.
  let pagina;
  for (let intento = 0; intento < 60 && !pagina; intento++) {
    pagina = navegador.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://127.0.0.1'));
    if (!pagina) await new Promise(r => setTimeout(r, 1000));
  }
  if (!pagina) throw new Error('La aplicación no ha llegado a cargar la página del backend.');
  console.log('Página:', pagina.url());

  const r = await pagina.evaluate(async () => {
    const t = window.__TAURI_INTERNALS__;
    if (!t) return { puente: false };
    const probar = async fn => { try { return { ok: await fn() }; } catch (e) { return { error: String(e?.message ?? e) }; } };
    return {
      puente: true,
      version: await probar(() => t.invoke('plugin:app|version')),
      pendientes: await probar(() => t.invoke('archivos_pendientes')),
      // Una ruta que no ha llegado por «Abrir con…»: tiene que contestar nuestro
      // comando con su error, no Tauri con un rechazo por permisos.
      leer: await probar(() => t.invoke('leer_archivo', { ruta: 'C:\\no-existe.pdf' })),
    };
  });
  console.log(JSON.stringify(r, null, 1));

  const fallos = [];
  if (!r.puente) fallos.push('la página no ve window.__TAURI_INTERNALS__');
  if (r.version?.error) fallos.push('plugin:app|version: ' + r.version.error);
  if (esperada && r.version?.ok !== esperada) fallos.push(`versión ${r.version?.ok}, se esperaba ${esperada}`);
  if (!Array.isArray(r.pendientes?.ok)) fallos.push('archivos_pendientes: ' + (r.pendientes?.error ?? 'no devuelve una lista'));
  if (!/no se ha abierto con la aplicación/.test(r.leer?.error ?? '')) fallos.push('leer_archivo: ' + JSON.stringify(r.leer));
  await navegador.close();

  if (fallos.length) {
    console.error('El puente con Tauri no funciona:\n - ' + fallos.join('\n - '));
    process.exit(1);
  }
  console.log('El puente con Tauri funciona: la página puede llamar a los comandos de la aplicación.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
