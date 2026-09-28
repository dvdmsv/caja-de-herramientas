//! Las ventanas de la aplicación. Hay tantas como se quiera, todas del mismo
//! proceso y contra el mismo backend: cada «Abrir con…», cada acción del menú del
//! Explorador, cada arranque desde el menú Inicio y cada Ctrl+N abren una nueva.
//!
//! No son varias copias de la aplicación a propósito: cada copia arrancaría su
//! propio backend (~100 MB y dos segundos más), y la que arrancase después
//! borraría al empezar las sesiones de la otra (`borrar_sesiones_anteriores` en
//! `backend/escritorio.py`). Aquí cada ventana es una página más contra el mismo
//! `127.0.0.1:<puerto>`, y cada una lleva su propia sesión (`SessionService` usa
//! `sessionStorage` dentro de la aplicación).
//!
//! **En Windows, crear una ventana desde un manejador síncrono puede bloquear la
//! aplicación** (lo avisa la documentación de Tauri). Por eso fuera de `setup`
//! se crean siempre con `crear_aparte`, que lo hace desde otro hilo.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// La primera ventana. Es la única en la que corre la autoprueba de la CI.
pub const PRINCIPAL: &str = "principal";

/// Lo que hace falta para abrir una ventana contra el backend.
#[derive(Default)]
pub struct Servidor {
    /// Mientras sea `None`, el backend aún no ha dicho LISTO.
    pub puerto: Mutex<Option<u16>>,
    pub token: Mutex<String>,
    /// Si el backend murió al arrancar: el final del registro y dónde está, para
    /// enseñarlo también en las ventanas que se abran después.
    pub fallo: Mutex<Option<(String, String)>>,
    siguiente: AtomicU32,
}

impl Servidor {
    /// La dirección del backend con el token, o nada si aún no está listo.
    pub fn url(&self) -> Option<Url> {
        let puerto = (*self.puerto.lock().unwrap())?;
        Url::parse(&format!("http://127.0.0.1:{puerto}/?t={}", self.token.lock().unwrap())).ok()
    }

    /// Una etiqueta nueva para una ventana: `ventana-1`, `ventana-2`…
    pub fn nueva_etiqueta(&self) -> String {
        format!("ventana-{}", self.siguiente.fetch_add(1, Ordering::SeqCst) + 1)
    }
}

/// Crea una ventana con todo lo que tiene que llevar. Si el backend ya está
/// listo va directa a él (o a `destino`, una dirección suya); si no, a la
/// pantalla de arranque, y `esperar_listo` la navegará cuando lo esté.
///
/// Sólo desde `setup` o desde otro hilo: ver la nota del módulo.
pub fn crear(app: &AppHandle, etiqueta: &str, destino: Option<Url>) -> tauri::Result<WebviewWindow> {
    let servidor = app.state::<Servidor>();
    let destino = destino.or_else(|| servidor.url());
    let en_arranque = destino.is_none();
    let url = match destino {
        Some(url) => WebviewUrl::External(url),
        None => WebviewUrl::App("index.html".into()),
    };
    let para_navegar = app.clone();
    let para_ventanas = app.clone();
    let ventana = WebviewWindowBuilder::new(app, etiqueta, url)
        .title("Caja de herramientas")
        .inner_size(1280.0, 860.0)
        .min_inner_size(720.0, 540.0)
        // Sin esto, en Windows Tauri se queda con los archivos que se sueltan
        // en la ventana y la página no recibe el `drop`: soltar en la portada o
        // en una cola no hacía nada.
        .disable_drag_drop_handler()
        .on_navigation(move |url| navegacion_permitida(url, &para_navegar))
        .on_new_window(move |url, _caracteristicas| {
            // Un `target="_blank"` a la propia aplicación (el visor en otra
            // ventana) se abre como ventana suya, hecha aquí para que lleve lo
            // mismo que las demás; a cualquier otro sitio, en el navegador.
            if es_propia(&url, &para_ventanas) {
                crear_aparte(&para_ventanas, Some(url));
            } else {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()?;

    // Si el backend ha dicho LISTO mientras se creaba, `esperar_listo` ya no
    // la ha visto: se navega aquí.
    if en_arranque {
        if let Some(url) = servidor.url() {
            let _ = ventana.navigate(url);
        }
    }
    // Si el backend ya murió al arrancar, que esta ventana también lo diga.
    if let Some((detalle, registro)) = servidor.fallo.lock().unwrap().clone() {
        mostrar_fallo(&ventana, &detalle, &registro);
    }
    Ok(ventana)
}

/// Crea una ventana nueva desde otro hilo (ver la nota del módulo) y devuelve
/// su etiqueta, que ya sirve para dejarle archivos antes de que exista.
pub fn crear_aparte(app: &AppHandle, destino: Option<Url>) -> String {
    let etiqueta = app.state::<Servidor>().nueva_etiqueta();
    crear_aparte_como(app, etiqueta.clone(), destino);
    etiqueta
}

/// Lo mismo, con una etiqueta ya reservada con `Servidor::nueva_etiqueta`.
pub fn crear_aparte_como(app: &AppHandle, etiqueta: String, destino: Option<Url>) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(ventana) = crear(&app, &etiqueta, destino) {
            let _ = ventana.set_focus();
        }
    });
}

/// Las ventanas que siguen en la pantalla de arranque.
pub fn en_arranque(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .filter(|ventana| ventana.url().map(|url| es_de_arranque(&url)).unwrap_or(false))
        .collect()
}

/// Enseña en la pantalla de arranque que el backend no ha arrancado. Con
/// reintentos: puede llegar antes de que la página haya definido `mostrarError`.
pub fn mostrar_fallo(ventana: &WebviewWindow, detalle: &str, registro: &str) {
    let _ = ventana.eval(&format!(
        "(function f(d, r) {{ if (window.mostrarError) window.mostrarError(d, r); \
         else setTimeout(function () {{ f(d, r); }}, 100); }})({}, {})",
        serde_json::to_string(detalle).unwrap_or_default(),
        serde_json::to_string(registro).unwrap_or_default(),
    ));
}

fn es_de_arranque(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// La pantalla de arranque y el backend se ven dentro; lo demás, fuera.
fn navegacion_permitida(url: &Url, app: &AppHandle) -> bool {
    let propia = es_propia(url, app);
    if !propia {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
    propia
}

fn es_propia(url: &Url, app: &AppHandle) -> bool {
    match url.scheme() {
        // La pantalla de arranque: `tauri://localhost` o, en Windows,
        // `http://tauri.localhost`.
        "tauri" => true,
        "http" if url.host_str() == Some("tauri.localhost") => true,
        // Sólo el puerto del backend, y sólo cuando ya se sabe: antes de LISTO
        // no hay ninguno bueno (y `None == None` dejaría pasar el 80).
        "http" => match *app.state::<Servidor>().puerto.lock().unwrap() {
            Some(numero) => url.host_str() == Some("127.0.0.1") && url.port() == Some(numero),
            None => false,
        },
        // Lo que el propio frontend crea: vistas previas y descargas.
        "blob" | "data" | "about" => true,
        _ => false,
    }
}
