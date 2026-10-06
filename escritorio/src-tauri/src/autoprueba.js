// La autoprueba del puente: la ejecuta main.rs dentro de la página cuando la
// aplicación se arranca con CAJA_AUTOPRUEBA=<archivo> (lo hace la CI).
//
// Comprueba desde la propia página, por el camino de verdad, que llega a los
// comandos de la aplicación: durante tres versiones no llegaba («not allowed by
// ACL») y «Guardar» y «Abrir con…» fallaron en silencio sin que nada lo viera.
// La CI no puede mirarlo desde fuera (su WebView2 no abre el puerto de
// depuración), así que la página se lo cuenta a Rust y Rust lo escribe.
(async function autoprueba() {
  // Puede llegar antes que la página del backend: se espera a estar en ella.
  if (location.hostname !== '127.0.0.1' || document.readyState !== 'complete') {
    setTimeout(autoprueba, 500);
    return;
  }
  const t = window.__TAURI_INTERNALS__;
  if (!t) {
    return; // sin puente no hay a quién contárselo: la CI verá que no llega nada
  }
  const probar = async fn => {
    try { return { ok: await fn() }; } catch (e) { return { error: String((e && e.message) || e) }; }
  };
  // Un enlace externo no lo puede cancelar ningún script inyectado: el del
  // plugin opener lo hacía para pedir un comando sin permiso, y los enlaces de
  // «Acerca de» no abrían nada. Se mira después de todos los demás oyentes y se
  // cancela aquí mismo, para no lanzar un navegador en la CI.
  const enlaceCancelado = () => new Promise(resolver => {
    const enlace = Object.assign(document.createElement('a'),
      { href: 'https://example.invalid/', target: '_blank' });
    window.addEventListener('click', e => {
      resolver(e.defaultPrevented);
      e.preventDefault();
    }, { once: true });
    setTimeout(() => resolver('el clic no llegó'), 2000);
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
  });
  const resultado = {
    url: location.href,
    enlaceCancelado: await enlaceCancelado(),
    version: await probar(() => t.invoke('plugin:app|version')),
    pendientes: await probar(() => t.invoke('archivos_pendientes')),
    // Una ruta que no ha llegado por «Abrir con…»: tiene que contestar nuestro
    // comando con su error, no Tauri con un rechazo por permisos.
    leer: await probar(() => t.invoke('leer_archivo', { ruta: 'C:\\no-existe.pdf' })),
    menu: await probar(() => t.invoke('menu_contextual')),
    // Sin versión nueva contesta `null`; lo que importa es que conteste él.
    actualizacion: await probar(() => t.invoke('actualizacion_pendiente')),
    ajustes: await probar(() => t.invoke('leer_ajustes')),
  };
  await t.invoke('resultado_autoprueba', { resultado: JSON.stringify(resultado) });
})();
