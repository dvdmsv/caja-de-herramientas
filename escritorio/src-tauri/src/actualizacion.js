// La capa que se ve mientras la aplicación se actualiza.
//
// La pinta main.rs (`buscar_actualizacion`) con `eval`, llamando a
// `window.__cajaActualizacion(estado)` en cada cambio. Va sobre la página que
// haya —la sirve el backend, no es de Tauri—, así que no depende de Angular:
// crea la capa si no está (la página puede haber cambiado entretanto) y usa las
// variables de color de Bootstrap que ya tiene la página, para seguir el modo
// claro u oscuro.
//
// Estados:
//   { fase: 'descargando', version, descargado, total, motivo }
//       (bytes; total puede ser null; motivo, por qué se baja el instalador
//       completo cuando había paquete)
//   { fase: 'aplicando', version }   (paquete bajado: se cierra y se abre sola)
//   { fase: 'instalando', version }  (el instalador completo)
//   { fase: 'error', mensaje }
(function () {
  if (window.__cajaActualizacion) {
    return;
  }

  var ID = 'caja-actualizacion';

  // Con un decimal por debajo de 10: un paquete de 0,4 MB no puede salir como «0 de 0 MB».
  function megas(bytes) {
    var cuantos = bytes / (1024 * 1024);
    return cuantos < 10 ? cuantos.toFixed(1).replace('.', ',') : String(Math.round(cuantos));
  }

  function capa() {
    var existente = document.getElementById(ID);
    if (existente) {
      return existente;
    }
    var fondo = document.createElement('div');
    fondo.id = ID;
    fondo.setAttribute('role', 'dialog');
    fondo.setAttribute('aria-modal', 'true');
    fondo.setAttribute('aria-labelledby', ID + '-titulo');
    fondo.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid', 'place-items:center',
      'padding:16px', 'background:rgba(0,0,0,.45)', 'font-family:inherit',
    ].join(';');
    fondo.innerHTML =
      '<div style="width:min(28rem,100%);padding:1.5rem;border-radius:.75rem;' +
      'background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);' +
      'box-shadow:0 1rem 3rem rgba(0,0,0,.3);border:1px solid var(--bs-border-color,#dee2e6)">' +
      '<h2 id="' + ID + '-titulo" style="font-size:1.15rem;font-weight:600;margin:0 0 .75rem"></h2>' +
      '<progress style="width:100%;height:.6rem;accent-color:var(--acento,#0d6efd)" max="100"></progress>' +
      '<p aria-live="polite" style="margin:.75rem 0 0;color:var(--bs-secondary-color,#6c757d)"></p>' +
      '<button type="button" class="btn btn-primary" style="margin-top:1rem;min-height:2.75rem;display:none">Cerrar</button>' +
      '</div>';
    fondo.querySelector('button').addEventListener('click', function () {
      fondo.remove();
    });
    document.body.appendChild(fondo);
    return fondo;
  }

  window.__cajaActualizacion = function (estado) {
    var fondo = capa();
    var titulo = fondo.querySelector('h2');
    var barra = fondo.querySelector('progress');
    var texto = fondo.querySelector('p');
    var boton = fondo.querySelector('button');

    if (estado.fase === 'descargando') {
      titulo.textContent = 'Descargando la versión ' + estado.version + '…';
      boton.style.display = 'none';
      barra.style.display = '';
      // Por qué va el instalador completo si había paquete: si no, la persona
      // ve bajar 300 MB después de que se le dijera cuánto menos.
      var motivo = estado.motivo ? 'La actualización rápida no se ha podido usar (' + estado.motivo +
        '), así que se descarga la versión completa. ' : '';
      if (estado.total) {
        var porcentaje = Math.min(100, Math.round((estado.descargado / estado.total) * 100));
        barra.value = porcentaje;
        texto.textContent = motivo + porcentaje + ' % · ' + megas(estado.descargado) + ' de ' +
          megas(estado.total) + ' MB. No cierres la aplicación mientras tanto.';
      } else {
        // Sin el total, la barra se queda indeterminada: mejor que un 0 % que no se mueve.
        barra.removeAttribute('value');
        texto.textContent = motivo + megas(estado.descargado) + ' MB descargados.';
      }
    } else if (estado.fase === 'aplicando') {
      titulo.textContent = 'Aplicando la versión ' + estado.version;
      boton.style.display = 'none';
      barra.style.display = '';
      barra.removeAttribute('value');
      texto.textContent = 'La aplicación se cerrará y se volverá a abrir ya actualizada en unos segundos.';
    } else if (estado.fase === 'instalando') {
      titulo.textContent = 'Instalando la versión ' + estado.version;
      boton.style.display = 'none';
      barra.style.display = '';
      barra.removeAttribute('value');
      texto.textContent = 'La aplicación se cerrará y se volverá a abrir sola en unos segundos.';
    } else if (estado.fase === 'error') {
      titulo.textContent = 'No se ha podido actualizar';
      barra.style.display = 'none';
      texto.textContent = estado.mensaje + ' Puedes seguir usando esta versión; se volverá a ' +
        'intentar la próxima vez que la abras.';
      boton.style.display = '';
      boton.focus();
    }
  };
})();
