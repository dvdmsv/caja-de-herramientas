//! El envoltorio de escritorio: arranca el backend, enseña su página en una
//! ventana y se asegura de que el backend muera con ella.
//!
//! Aquí hay lo mínimo a propósito. Dónde está cada programa externo, qué
//! variables necesita y qué se borra al arrancar lo sabe el backend
//! (`backend/escritorio.py`): así se prueba con el barrido de la CI sin pasar
//! por Rust, y esto sólo cambia si cambia la forma de lanzarlo.
//!
//! El orden de las cosas:
//!
//! 1. Se abre la ventana con la pantalla de arranque (`arranque/index.html`),
//!    para que haya algo en cuanto se hace doble clic.
//! 2. Se lanza `backend/merge-pdf-backend.exe` con un token aleatorio y dentro
//!    de un *job object* de Windows que lo mata —a él y a todo lo que lance:
//!    LibreOffice, ocrmypdf…— en cuanto este proceso termine, **aunque termine
//!    de golpe**. Sin eso, cerrar la aplicación desde el Administrador de tareas
//!    dejaría un Python y quizá un LibreOffice vivos y sin ventana.
//! 3. Cuando el backend escribe `LISTO <puerto>`, la ventana navega a
//!    `http://127.0.0.1:<puerto>/?t=<token>`. El backend cambia el token por una
//!    cookie y redirige a la URL limpia.
//! 4. La ventana sólo puede navegar a ese origen. Cualquier otro enlace (la
//!    ayuda, la descarga de AutoFirma, el protocolo `afirma://`) se abre fuera,
//!    con el programa que Windows tenga para él.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const VENTANA: &str = "principal";

/// Lo que tiene que vivir mientras viva la aplicación.
struct Backend {
    hijo: Mutex<Option<Child>>,
    /// Al soltarse cierra el job y Windows mata todo lo que haya dentro.
    #[cfg(windows)]
    _trabajo: Option<win32job::Job>,
}

fn main() {
    // El puerto no se sabe hasta que el backend lo dice, y la regla de
    // navegación se crea antes. Mientras sea `None`, sólo vale la pantalla de
    // arranque.
    let puerto: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));

    let aplicacion = tauri::Builder::default()
        // Abrir la aplicación con ella ya abierta trae la ventana al frente en
        // vez de arrancar un segundo backend.
        .plugin(tauri_plugin_single_instance::init(|app, _argumentos, _carpeta| {
            if let Some(ventana) = app.get_webview_window(VENTANA) {
                let _ = ventana.unminimize();
                let _ = ventana.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup({
            let puerto = puerto.clone();
            move |app| {
                let permitido = puerto.clone();
                let ventana = WebviewWindowBuilder::new(app, VENTANA, WebviewUrl::App("index.html".into()))
                    .title("Caja de herramientas")
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(720.0, 540.0)
                    .on_navigation(move |url| navegacion_permitida(url, &permitido))
                    .build()?;

                let backend = arrancar_backend(app.handle(), ventana, puerto)?;
                app.manage(backend);
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("no se ha podido crear la aplicación");

    aplicacion.run(|app, evento| {
        if let RunEvent::Exit = evento {
            // El job ya lo mataría al salir; esto es por no depender sólo de él.
            if let Some(backend) = app.try_state::<Backend>() {
                if let Some(mut hijo) = backend.hijo.lock().unwrap().take() {
                    let _ = hijo.kill();
                }
            }
        }
    });
}

/// La pantalla de arranque y el backend se ven dentro; lo demás, fuera.
fn navegacion_permitida(url: &Url, puerto: &Arc<Mutex<Option<u16>>>) -> bool {
    let propia = match url.scheme() {
        // La pantalla de arranque: `tauri://localhost` o, en Windows,
        // `http://tauri.localhost`.
        "tauri" => true,
        "http" if url.host_str() == Some("tauri.localhost") => true,
        // Sólo el puerto del backend, y sólo cuando ya se sabe: antes de LISTO
        // no hay ninguno bueno (y `None == None` dejaría pasar el 80).
        "http" => match *puerto.lock().unwrap() {
            Some(numero) => url.host_str() == Some("127.0.0.1") && url.port() == Some(numero),
            None => false,
        },
        // Lo que el propio frontend crea: vistas previas y descargas.
        "blob" | "data" | "about" => true,
        _ => false,
    };
    if !propia {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
    propia
}

fn arrancar_backend(
    app: &tauri::AppHandle,
    ventana: WebviewWindow,
    puerto: Arc<Mutex<Option<u16>>>,
) -> Result<Backend, Box<dyn std::error::Error>> {
    let ejecutable = app
        .path()
        .resource_dir()?
        .join("backend")
        .join("merge-pdf-backend.exe");
    let registro = ruta_del_registro(app)?;
    let token = token_aleatorio()?;

    let mut orden = Command::new(&ejecutable);
    orden
        .env("ESCRITORIO_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        // Lo que el backend escribe en su registro va a un archivo: es lo único
        // que hay para saber qué pasó cuando algo falla en el equipo de otro.
        .stderr(File::create(&registro)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // El backend es una aplicación de consola (tiene que escribir LISTO);
        // sin esto abriría una ventana negra al lado de la nuestra.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        orden.creation_flags(CREATE_NO_WINDOW);
    }

    let mut hijo = orden.spawn().map_err(|error| {
        format!("No se ha podido lanzar {}: {error}", ejecutable.display())
    })?;

    #[cfg(windows)]
    let trabajo = atar_al_proceso(&hijo);

    let salida = hijo.stdout.take().expect("la salida del backend va por tubería");
    let registro_texto = registro.display().to_string();
    thread::spawn(move || esperar_listo(salida, ventana, puerto, token, registro_texto));

    Ok(Backend {
        hijo: Mutex::new(Some(hijo)),
        #[cfg(windows)]
        _trabajo: trabajo,
    })
}

/// Lee la salida del backend hasta que diga LISTO, y la sigue leyendo después:
/// si nadie vacía la tubería, el backend se bloquearía al escribir en ella.
fn esperar_listo(
    salida: std::process::ChildStdout,
    ventana: WebviewWindow,
    puerto: Arc<Mutex<Option<u16>>>,
    token: String,
    registro: String,
) {
    let mut listo = false;
    for linea in BufReader::new(salida).lines().map_while(Result::ok) {
        if listo {
            continue;
        }
        if let Some(numero) = linea.strip_prefix("LISTO ") {
            if let Ok(numero) = numero.trim().parse::<u16>() {
                *puerto.lock().unwrap() = Some(numero);
                listo = true;
                if let Ok(url) = Url::parse(&format!("http://127.0.0.1:{numero}/?t={token}")) {
                    let _ = ventana.navigate(url);
                }
            }
        }
    }
    if !listo {
        // La salida se ha cerrado sin LISTO: el backend ha muerto al arrancar.
        // Lo que dijo está en el registro; se enseña el final.
        let detalle = fs::read_to_string(&registro)
            .map(|texto| {
                let lineas: Vec<&str> = texto.lines().collect();
                lineas[lineas.len().saturating_sub(25)..].join("\n")
            })
            .unwrap_or_default();
        // Reintentando: si el backend muere enseguida, esto puede llegar antes
        // de que la pantalla de arranque haya definido `mostrarError`.
        let _ = ventana.eval(&format!(
            "(function f(d, r) {{ if (window.mostrarError) window.mostrarError(d, r); \
             else setTimeout(function () {{ f(d, r); }}, 100); }})({}, {})",
            serde_json::to_string(&detalle).unwrap_or_default(),
            serde_json::to_string(&registro).unwrap_or_default(),
        ));
    }
}

/// `%LOCALAPPDATA%\merge-pdf\backend.log`, la misma carpeta de datos que usa el
/// backend (`escritorio.carpeta_de_datos`). Se sobrescribe en cada arranque.
fn ruta_del_registro(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let carpeta = app.path().local_data_dir()?.join("merge-pdf");
    fs::create_dir_all(&carpeta)?;
    Ok(carpeta.join("backend.log"))
}

/// 32 bytes al azar del generador del sistema, en hexadecimal.
fn token_aleatorio() -> Result<String, Box<dyn std::error::Error>> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("sin azar del sistema: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Mete el backend en un job que muere con este proceso. Si falla, se sigue sin
/// él: la aplicación funciona igual, sólo que un cierre forzado dejaría el
/// backend vivo.
#[cfg(windows)]
fn atar_al_proceso(hijo: &Child) -> Option<win32job::Job> {
    use std::os::windows::io::AsRawHandle;

    let mut limites = win32job::ExtendedLimitInfo::new();
    limites.limit_kill_on_job_close();
    let trabajo = win32job::Job::create_with_limit_info(&limites).ok()?;
    trabajo.assign_process(hijo.as_raw_handle() as isize).ok()?;
    Some(trabajo)
}
