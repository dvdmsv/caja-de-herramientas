//! El área de notificación (los iconos junto al reloj): con «Al cerrar, seguir
//! junto al reloj» activo en Ajustes → Ventana, la X de la última ventana a la
//! vista la esconde en vez de cerrar la aplicación. Así el backend sigue en
//! marcha —volver a abrir no cuesta los dos segundos de arranque— y un trabajo
//! largo termina aunque se cierre la ventana; su aviso de fin sale igual
//! (`avisar_fin` sólo calla con la ventana enfocada).
//!
//! Desactivado de serie. **El icono sólo existe mientras el ajuste está
//! activo**: sin él no hay nada que ofrecer ahí. Y al quitarlo se enseña lo que
//! estuviera escondido, o quedaría una ventana sin forma de volver a ella.
//!
//! Con varias ventanas, la X de una que no es la última la cierra como
//! siempre: cada ventana es una página más contra el mismo backend
//! (`ventanas.rs`), no la aplicación.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, CloseRequestApi, Manager, Window};

use crate::ajustes;
use crate::ventanas;

const ID: &str = "bandeja";

/// Si el ajuste está activo. Se guarda aquí para no leer `ajustes.json` en
/// cada cierre de ventana.
#[derive(Default)]
pub struct Bandeja(AtomicBool);

/// Deja el icono como dice el ajuste: lo pone o lo quita. Se llama al arrancar
/// y cada vez que la página guarda los ajustes.
pub fn sincronizar(app: &AppHandle, activa: bool) {
    app.state::<Bandeja>().0.store(activa, Ordering::SeqCst);
    let existe = app.tray_by_id(ID).is_some();
    if activa && !existe {
        if let Err(error) = crear(app) {
            eprintln!("No se ha podido poner el icono junto al reloj: {error}");
            app.state::<Bandeja>().0.store(false, Ordering::SeqCst);
        }
    } else if !activa && existe {
        mostrar_escondidas(app);
        app.remove_tray_by_id(ID);
    }
}

fn crear(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "abrir", "Abrir", true, None::<&str>)?,
        &MenuItem::with_id(app, "nueva", "Nueva ventana", true, None::<&str>)?,
        &MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?,
    ])?;
    let mut icono = TrayIconBuilder::with_id(ID)
        .tooltip("Caja de herramientas")
        .menu(&menu)
        // El clic izquierdo abre; el menú, con el derecho, como en Windows.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => abrir(app),
            "nueva" => {
                ventanas::crear_aparte(app, None);
            }
            // Como cerrar la aplicación antes de esto: `RunEvent::Exit` y el
            // job object se llevan el backend.
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|icono, evento| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evento {
                abrir(icono.app_handle());
            }
        });
    if let Some(imagen) = app.default_window_icon() {
        icono = icono.icon(imagen.clone());
    }
    icono.build(app)?;
    Ok(())
}

/// Enseña lo escondido; si no había nada (se cerró todo menos el icono no
/// puede pasar, pero por si acaso), una ventana nueva.
fn abrir(app: &AppHandle) {
    if !mostrar_escondidas(app) && app.webview_windows().is_empty() {
        ventanas::crear_aparte(app, None);
    }
}

/// Vuelve a enseñar las ventanas escondidas, con el foco en la última. Dice si
/// había alguna.
pub fn mostrar_escondidas(app: &AppHandle) -> bool {
    let mut habia = false;
    for ventana in app.webview_windows().into_values() {
        if !ventana.is_visible().unwrap_or(true) {
            habia = true;
            let _ = ventana.show();
            let _ = ventana.unminimize();
            let _ = ventana.set_focus();
        }
    }
    habia
}

/// La X (o Alt+F4) de una ventana. Con el ajuste activo y sin otra ventana a la
/// vista, se esconde en vez de cerrarse; la primera vez, Windows lo avisa.
pub fn al_pedir_cierre(ventana: &Window, api: &CloseRequestApi) {
    let app = ventana.app_handle();
    if !app.state::<Bandeja>().0.load(Ordering::SeqCst) {
        return;
    }
    let otra_a_la_vista = app
        .webview_windows()
        .into_values()
        .any(|otra| otra.label() != ventana.label() && otra.is_visible().unwrap_or(false));
    if otra_a_la_vista {
        return;
    }
    api.prevent_close();
    let _ = ventana.hide();
    avisar_la_primera_vez(app);
}

/// Sin esto, quien lo activó hace un mes cree que ha cerrado la aplicación y no
/// sabe dónde está. Una vez y no más: luego sería ruido.
fn avisar_la_primera_vez(app: &AppHandle) {
    use tauri_plugin_notification::NotificationExt;

    let mut actuales = ajustes::leer(app);
    if actuales.bandeja_avisada {
        return;
    }
    actuales.bandeja_avisada = true;
    let _ = ajustes::guardar(app, &actuales);
    let _ = app
        .notification()
        .builder()
        .title("Caja de herramientas sigue abierta")
        .body("Está en el área de notificación, junto al reloj. Para salir: clic derecho en su icono → Salir.")
        .show();
}
