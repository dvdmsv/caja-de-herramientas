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
//!    para que haya algo en cuanto se hace doble clic. Puede haber más ventanas
//!    (`ventanas.rs`), todas contra el mismo backend.
//! 2. Se lanza `backend/merge-pdf-backend.exe` con un token aleatorio y dentro
//!    de un *job object* de Windows que lo mata —a él y a todo lo que lance:
//!    LibreOffice, ocrmypdf…— en cuanto este proceso termine, **aunque termine
//!    de golpe**. Sin eso, cerrar la aplicación desde el Administrador de tareas
//!    dejaría un Python y quizá un LibreOffice vivos y sin ventana.
//! 3. Cuando el backend escribe `LISTO <puerto>`, las ventanas navegan a
//!    `http://127.0.0.1:<puerto>/?t=<token>`. El backend cambia el token por una
//!    cookie y redirige a la URL limpia.
//! 4. Las ventanas sólo pueden navegar a ese origen. Cualquier otro enlace (la
//!    ayuda, la descarga de AutoFirma, el protocolo `afirma://`) se abre fuera,
//!    con el programa que Windows tenga para él.
//!
//! Y los comandos que el frontend llama cuando va dentro de la aplicación
//! (`frontend/src/app/core/escritorio.ts`; la lista, en `generate_handler!` más
//! abajo). Los de siempre: `guardar_como`, que enseña el diálogo de Windows en
//! vez de dejar el archivo en Descargas, y `archivos_pendientes` /
//! `leer_archivo`, por los que entra lo que se abre con «Abrir con…». Los
//! demás son de módulos propios: ventanas (`ventanas.rs`), ajustes
//! (`ajustes.rs`), menú del Explorador (`menu.rs`), soporte (`soporte.rs`) y
//! actualizaciones (aquí y en `parche.rs`).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ajustes;
mod bandeja;
mod menu;
mod parche;
mod parche_plan;
mod soporte;
#[cfg(windows)]
mod trabajo;
mod ventanas;

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use ventanas::{Servidor, PRINCIPAL};

/// Lo que tiene que vivir mientras viva la aplicación.
struct Backend {
    hijo: Mutex<Option<Child>>,
    /// Al soltarse cierra el job y Windows mata todo lo que haya dentro.
    #[cfg(windows)]
    _trabajo: Option<trabajo::Trabajo>,
}

/// Lo que llega de una vez por «Abrir con…» o por el menú del Explorador.
struct Llegada {
    /// La herramienta elegida en el menú; `None` es «Abrir con…» (la portada).
    herramienta: Option<String>,
    rutas: Vec<PathBuf>,
    cuando: Instant,
}

/// Lo que se le devuelve al frontend por cada llegada.
#[derive(serde::Serialize)]
struct LlegadaParaLaPagina {
    herramienta: Option<String>,
    rutas: Vec<String>,
}

/// Los archivos que llegan con «Abrir con…» o el menú del Explorador,
/// esperando a que el frontend los recoja, **cada uno para su ventana**.
/// `permitidos` es la lista de lo único que `leer_archivo` puede leer: sin ella,
/// la página podría pedir cualquier archivo del disco.
#[derive(Default)]
struct Abiertos {
    /// Por etiqueta de ventana. La ventana puede no existir aún: se crea en otro
    /// hilo (ver `ventanas.rs`) y recoge lo suyo en cuanto arranca su página.
    pendientes: Mutex<HashMap<String, Vec<Llegada>>>,
    permitidos: Mutex<HashSet<PathBuf>>,
    /// La carpeta de lo último que ha llegado: «Guardar como» la propone, que
    /// es donde suele querer dejarse el resultado. Lo que se elige con el
    /// selector de la página no trae ruta (el navegador no la da).
    carpeta: Mutex<Option<PathBuf>>,
    /// A qué ventana fue lo último, con qué herramienta y cuándo: lo que llegue
    /// igual y enseguida es de la misma selección y va a la misma ventana.
    ultima: Mutex<Option<(String, Option<String>, Instant)>>,
    /// Sube con cada llegada: sirve para avisar a la página sólo cuando han
    /// dejado de llegar (ver `avisar_cuando_paren`).
    generacion: AtomicU64,
}

/// Cuánto se espera a que lleguen los demás archivos de una misma selección.
/// Con varios archivos seleccionados, el Explorador lanza un proceso por cada
/// uno, y llegan uno detrás de otro por `single-instance`: «Unir PDF» con tres
/// archivos tiene que abrirse una vez, en una ventana, con los tres; no en tres
/// ventanas con uno.
const JUNTOS: Duration = Duration::from_millis(1500);
/// Cuánto tiene que llevar quieta una llegada para entregarla. Con ventanas que
/// se abren con el backend ya listo, la página puede pedir lo suyo antes de que
/// llegue el resto de la selección, y el resto llegaría como otra llegada que
/// sustituiría a la primera.
const AVISO_TRAS: Duration = Duration::from_millis(700);

/// Los archivos y la herramienta (`--herramienta`, del menú del Explorador) que
/// traen unos argumentos. El primero es el propio ejecutable.
fn leer_argumentos<I: IntoIterator<Item = String>>(argumentos: I) -> (Option<String>, Vec<PathBuf>) {
    let mut herramienta = None;
    let mut rutas = Vec::new();
    let mut argumentos = argumentos.into_iter().skip(1);
    while let Some(argumento) = argumentos.next() {
        if argumento == "--herramienta" {
            herramienta = argumentos.next().filter(|slug| menu::es_slug(slug));
            continue;
        }
        let ruta = PathBuf::from(argumento);
        if ruta.is_file() {
            rutas.push(ruta);
        }
    }
    (herramienta, rutas)
}

impl Abiertos {
    /// Si lo que llega con esta herramienta es de la misma selección que lo
    /// anterior, la ventana a la que fue aquello.
    fn ventana_de_la_seleccion(&self, herramienta: &Option<String>) -> Option<String> {
        match &*self.ultima.lock().unwrap() {
            Some((etiqueta, anterior, cuando)) if anterior == herramienta && cuando.elapsed() < JUNTOS => {
                Some(etiqueta.clone())
            }
            _ => None,
        }
    }

    /// Deja los archivos para la ventana `etiqueta`, sumándolos a su última
    /// llegada si son de la misma selección.
    fn anotar(&self, etiqueta: &str, herramienta: Option<String>, rutas: Vec<PathBuf>) {
        if rutas.is_empty() {
            return;
        }
        *self.carpeta.lock().unwrap() = rutas[0].parent().map(PathBuf::from);
        self.permitidos.lock().unwrap().extend(rutas.iter().cloned());

        let mut pendientes = self.pendientes.lock().unwrap();
        let de_la_ventana = pendientes.entry(etiqueta.to_string()).or_default();
        match de_la_ventana.last_mut() {
            Some(ultima) if ultima.herramienta == herramienta && ultima.cuando.elapsed() < JUNTOS => {
                ultima.rutas.extend(rutas);
                ultima.cuando = Instant::now();
            }
            _ => de_la_ventana.push(Llegada { herramienta: herramienta.clone(), rutas, cuando: Instant::now() }),
        }
        *self.ultima.lock().unwrap() = Some((etiqueta.to_string(), herramienta, Instant::now()));
        self.generacion.fetch_add(1, Ordering::SeqCst);
    }
}

/// Otro arranque de la aplicación con ella ya abierta (el menú Inicio, «Abrir
/// con…», el menú del Explorador): una ventana nueva con lo que traiga. Salvo si
/// es otro archivo de la misma selección, que se suma a la ventana del primero,
/// o si no trae nada y hay ventanas escondidas junto al reloj: entonces se
/// enseñan ésas, que es lo que se buscaba al abrirla.
fn otro_arranque(app: &AppHandle, argumentos: Vec<String>) {
    let (herramienta, rutas) = leer_argumentos(argumentos);
    if rutas.is_empty() && herramienta.is_none() && bandeja::mostrar_escondidas(app) {
        return;
    }
    let abiertos = app.state::<Abiertos>();
    if !rutas.is_empty() {
        if let Some(etiqueta) = abiertos.ventana_de_la_seleccion(&herramienta) {
            abiertos.anotar(&etiqueta, herramienta, rutas);
            avisar_cuando_paren(app, etiqueta);
            return;
        }
    }
    // La etiqueta se reserva antes de crearla y los archivos se dejan a su
    // nombre en seguida: el siguiente de la selección puede llegar mientras la
    // ventana aún se está creando.
    let etiqueta = app.state::<Servidor>().nueva_etiqueta();
    abiertos.anotar(&etiqueta, herramienta, rutas);
    ventanas::crear_aparte_como(app, etiqueta.clone(), None);
    avisar_cuando_paren(app, etiqueta);
}

/// Avisa a la página cuando llevan un momento sin llegar archivos, para que una
/// selección de varios se recoja entera y no a trozos. Si la ventana aún no
/// existe no hace falta: su página los pide al arrancar.
fn avisar_cuando_paren(app: &AppHandle, etiqueta: String) {
    let generacion = app.state::<Abiertos>().generacion.load(Ordering::SeqCst);
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(AVISO_TRAS);
        if app.state::<Abiertos>().generacion.load(Ordering::SeqCst) == generacion {
            if let Some(ventana) = app.get_webview_window(&etiqueta) {
                avisar_de_abiertos(&ventana);
            }
        }
    });
}

fn main() {
    // La copia que aplica una actualización por paquete (`parche.rs`): no es
    // la aplicación, no abre ventanas ni cuenta como otra instancia.
    if let Some(codigo) = parche::aplicar_si_se_pide() {
        std::process::exit(codigo);
    }

    let aplicacion = tauri::Builder::default()
        // Abrir la aplicación con ella ya abierta no arranca un segundo backend:
        // abre otra ventana de ésta (ver `ventanas.rs`).
        .plugin(tauri_plugin_single_instance::init(|app, argumentos, _carpeta| {
            otro_arranque(app, argumentos);
        }))
        // Sin su script de enlaces: intercepta los `target="_blank"` y pide
        // `plugin:opener|open_url` desde la página, que la capacidad no permite,
        // así que el clic se cancelaba sin abrir nada. Los enlaces los lleva
        // `ventanas.rs`, que sabe cuáles son de la aplicación.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Abiertos::default())
        .manage(UltimoGuardado::default())
        .manage(Destinos::default())
        .manage(Actualizacion::default())
        .manage(Servidor::default())
        .manage(bandeja::Bandeja::default())
        // La X: con «seguir junto al reloj», la última ventana se esconde.
        .on_window_event(|ventana, evento| {
            if let WindowEvent::CloseRequested { api, .. } = evento {
                bandeja::al_pedir_cierre(ventana, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            guardar_como,
            mostrar_guardado,
            archivos_pendientes,
            leer_archivo,
            menu_contextual,
            aplicar_menu_contextual,
            progreso_tarea,
            avisar_fin,
            resultado_autoprueba,
            nueva_ventana,
            actualizacion_pendiente,
            responder_actualizacion,
            buscar_actualizacion_ahora,
            leer_ajustes,
            guardar_ajustes,
            elegir_carpeta_de_guardado,
            abrir_carpeta_de_datos,
            informacion_de_soporte,
            reiniciar,
            elegir_carpeta,
            elegir_destino,
            guardar_en_destino,
        ])
        .setup(|app| {
            *app.state::<Servidor>().token.lock().unwrap() = token_aleatorio()?;
            // Abierta con archivos desde el principio: el frontend los pedirá
            // en cuanto arranque. Y los demás de la selección llegarán por
            // `otro_arranque` y se sumarán a ésta.
            let (herramienta, rutas) = leer_argumentos(std::env::args());
            app.state::<Abiertos>().anotar(PRINCIPAL, herramienta, rutas);

            ventanas::crear(app.handle(), PRINCIPAL, None)?;
            // Antes que el backend, y sin esperar a nada: lo que haya dejado
            // una actualización no sirve de un arranque a otro.
            let fallo = parche::limpiar_restos(app.handle());
            let volver_a_ofrecer = fallo.is_some();
            *app.state::<Actualizacion>().fallo_anterior.lock().unwrap() = fallo;
            // Los de «Avanzado» se leen una vez, al arrancar: son los que valen
            // hasta volver a abrir, y con ellos se sabe si hay cambios pendientes.
            let ajustes = ajustes::leer(app.handle());
            bandeja::sincronizar(app.handle(), ajustes.ventana.a_la_bandeja);
            let backend = arrancar_backend(app.handle(), &ajustes)?;
            app.manage(backend);
            app.manage(AvanzadoAplicado(ajustes.avanzado.clone()));
            // Si la actualización que se pidió no se pudo aplicar, se vuelve a
            // ofrecer aunque no se busque al abrir: la persona ya dijo que sí.
            if ajustes.actualizaciones.al_abrir || volver_a_ofrecer {
                buscar_actualizacion(app.handle().clone());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se ha podido crear la aplicación");

    aplicacion.run(|app, evento| match evento {
        // Cerrar una ventana no toca las demás; lo que no llegó a recoger se
        // olvida. Al cerrar la última, Tauri sale; con «seguir junto al reloj»
        // la última no se cierra, se esconde (`bandeja.rs`).
        RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } => {
            app.state::<Abiertos>().pendientes.lock().unwrap().remove(&label);
            app.state::<Destinos>().0.lock().unwrap().remove(&label);
        }
        RunEvent::Exit => {
            // El job ya lo mataría al salir; esto es por no depender sólo de él.
            if let Some(backend) = app.try_state::<Backend>() {
                if let Some(mut hijo) = backend.hijo.lock().unwrap().take() {
                    let _ = hijo.kill();
                }
            }
        }
        _ => {}
    });
}

// --- Actualizaciones ---------------------------------------------------------

/// La versión nueva que se ha encontrado, a la espera de que la persona diga
/// qué hacer con ella.
#[derive(Default)]
struct Actualizacion {
    nueva: Mutex<Option<tauri_plugin_updater::Update>>,
    /// Si alguna ventana ya la ha enseñado: con varias abiertas, sólo una
    /// pregunta.
    ensenada: AtomicBool,
    /// Por qué no se pudo aplicar la última actualización por paquete, si
    /// falló (`parche::limpiar_restos`). Entonces esta vez va el instalador
    /// completo, que no depende de cómo esté la instalación.
    fallo_anterior: Mutex<Option<String>>,
}

/// Lo que la página necesita para enseñar el aviso. Las novedades de cada
/// versión las pide ella a GitHub; `notas` son sólo las de la última, las de
/// `latest.json`, para cuando GitHub no conteste.
#[derive(serde::Serialize)]
struct AvisoActualizacion {
    version: String,
    instalada: String,
    notas: Option<String>,
    fecha: Option<String>,
    fallo_anterior: Option<String>,
}

/// Mira si hay una versión nueva en GitHub Releases y, si la hay, avisa a la
/// página, que enseña qué trae y pregunta (`actualizacion_pendiente`).
///
/// Preguntando y no por su cuenta: instalar cierra la aplicación, y alguien
/// puede estar a mitad de un trabajo. Y enseñando las novedades, para que cada
/// uno decida si le compensa ahora o no. Sin red, sin versión nueva o con la
/// versión que se pidió saltar, no se dice nada. La descarga la comprueba el
/// plugin con la clave pública de `tauri.conf.json` antes de ejecutar nada: un
/// instalador que no esté firmado con la privada (que sólo tiene la CI) se
/// rechaza.
///
/// `CAJA_ACTUALIZACIONES` cambia de dónde se lee `latest.json`. Es sólo para
/// probar el aviso sin publicar dos versiones seguidas; la firma se comprueba
/// igual, así que no abre ninguna puerta.
///
/// Instalar (`instalar`) cierra este proceso, con un paquete de lo que cambia
/// o con el instalador completo; el job se lleva el backend por delante.
fn buscar_actualizacion(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(Some(_)) = comprobar_actualizacion(&app, true).await {
            // Las páginas ya cargadas lo recogen ahora; las que aún no, al arrancar.
            for ventana in app.webview_windows().into_values() {
                let _ = ventana.eval("window.dispatchEvent(new Event('escritorio:actualizacion'))");
            }
        }
    });
}

/// Pregunta a GitHub y, si hay versión nueva, la deja lista para el aviso
/// (`actualizacion_pendiente`). Devuelve cuál, o nada si ya está al día.
/// `respetar_saltada`: al abrir, una versión saltada no cuenta; con «Buscar
/// ahora» sí, que para eso se ha pedido.
async fn comprobar_actualizacion(app: &AppHandle, respetar_saltada: bool) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let otra_direccion = std::env::var("CAJA_ACTUALIZACIONES").ok().and_then(|url| Url::parse(&url).ok());
    let actualizador = match otra_direccion {
        Some(url) => app.updater_builder().endpoints(vec![url]).and_then(|builder| builder.build()),
        None => app.updater(),
    }
    .map_err(|error| error.to_string())?;
    let Some(nueva) = actualizador.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    if respetar_saltada && ajustes::leer(app).version_saltada.as_deref() == Some(nueva.version.as_str()) {
        return Ok(None);
    }
    let version = nueva.version.clone();
    let actualizacion = app.state::<Actualizacion>();
    *actualizacion.nueva.lock().unwrap() = Some(nueva);
    actualizacion.ensenada.store(false, Ordering::SeqCst);
    Ok(Some(version))
}

/// «Buscar ahora», en Ajustes. Si hay versión nueva, la página que lo pide la
/// enseña con el aviso de siempre.
#[tauri::command]
async fn buscar_actualizacion_ahora(app: AppHandle) -> Result<Option<String>, String> {
    comprobar_actualizacion(&app, false)
        .await
        .map_err(|error| format!("No se ha podido consultar si hay versión nueva: {error}"))
}

/// La versión nueva, si la hay y ninguna otra ventana la ha enseñado ya.
#[tauri::command]
fn actualizacion_pendiente(actualizacion: tauri::State<'_, Actualizacion>) -> Option<AvisoActualizacion> {
    let nueva = actualizacion.nueva.lock().unwrap().clone()?;
    if actualizacion.ensenada.swap(true, Ordering::SeqCst) {
        return None;
    }
    let fallo_anterior = actualizacion.fallo_anterior.lock().unwrap().clone();
    Some(AvisoActualizacion {
        fallo_anterior,
        fecha: nueva.raw_json.get("pub_date").and_then(|fecha| fecha.as_str()).map(String::from),
        version: nueva.version,
        instalada: nueva.current_version,
        notas: nueva.body,
    })
}

/// Lo que ha decidido la persona: `actualizar`, `saltar` (no volver a avisar
/// de esta versión) o `despues` (preguntar la próxima vez que se abra).
#[tauri::command]
fn responder_actualizacion(app: AppHandle, respuesta: String) -> Result<(), String> {
    let actualizacion = app.state::<Actualizacion>();
    match respuesta.as_str() {
        "actualizar" => {
            let nueva = actualizacion.nueva.lock().unwrap().take().ok_or("No hay ninguna versión nueva.")?;
            tauri::async_runtime::spawn(instalar(app.clone(), nueva));
            Ok(())
        }
        "saltar" => {
            let version = actualizacion.nueva.lock().unwrap().take().map(|nueva| nueva.version);
            match version {
                Some(version) => menu::saltar_version(&app, &version),
                None => Ok(()),
            }
        }
        "despues" => Ok(()),
        otra => Err(format!("Respuesta desconocida: {otra}")),
    }
}

/// El paquete con sólo lo que cambia (`parche.rs`), si `latest.json` trae uno
/// para esta versión y no es el que acaba de fallar.
fn paquete_a_usar(actualizacion: &Actualizacion, nueva: &tauri_plugin_updater::Update) -> Option<parche::Paquete> {
    if actualizacion.fallo_anterior.lock().unwrap().is_some() {
        return None;
    }
    parche::paquete_para(nueva)
}

/// Descarga e instala, enseñando en todo momento qué está pasando.
///
/// Sin esto, tras pulsar «Actualizar» no se veía nada durante la descarga y
/// después la ventana desaparecía de golpe. Ahora hay una capa sobre la página
/// (`actualizacion.js`) y la barra de progreso en el icono de la barra de
/// tareas, que se ve aunque la ventana esté minimizada.
///
/// **Con paquete** (`parche.rs`) se bajan sólo los archivos que cambian, se
/// lanza la copia que los pone en su sitio y esta aplicación sale; esa copia
/// abre la versión nueva. Si algo falla antes de salir —la descarga, la firma,
/// la carpeta de la instalación—, no se ha tocado nada y se sigue con el
/// instalador completo, diciendo por qué.
///
/// **Con el instalador**, al terminar la descarga el plugin lanza NSIS en modo
/// pasivo —con su propia ventana de progreso— y cierra este proceso con
/// `process::exit`; NSIS vuelve a abrir la aplicación al acabar. Por eso aquí no
/// hay un `restart()`: en Windows no llegaría a ejecutarse.
///
/// Con varias ventanas abiertas se pinta en todas: se cierran todas.
async fn instalar(app: AppHandle, nueva: tauri_plugin_updater::Update) {
    let version = nueva.version.clone();

    let mut motivo = None;
    if let Some(paquete) = paquete_a_usar(&app.state::<Actualizacion>(), &nueva) {
        let mut progreso = pintor_de_descarga(app.clone(), version.clone(), None);
        let preparada = parche::preparar(&app, &paquete, &nueva.current_version, &version, |descargado, total| {
            progreso(descargado, Some(total))
        })
        .await;
        let lanzada = preparada.and_then(|preparada| {
            pintar(&app, serde_json::json!({ "fase": "aplicando", "version": version }), ProgressBarState {
                status: Some(ProgressBarStatus::Indeterminate),
                progress: None,
            });
            parche::lanzar(&preparada)
        });
        match lanzada {
            Ok(()) => {
                app.exit(0);
                return;
            }
            Err(error) => motivo = Some(error),
        }
    }

    let mut progreso = pintor_de_descarga(app.clone(), version.clone(), motivo);
    let mut descargado: u64 = 0;
    let para_fin = app.clone();
    let version_fin = version.clone();

    let resultado = nueva
        .download_and_install(
            move |trozo, total| {
                descargado += trozo as u64;
                progreso(descargado, total);
            },
            move || {
                pintar(&para_fin, serde_json::json!({ "fase": "instalando", "version": version_fin }), ProgressBarState {
                    status: Some(ProgressBarStatus::Indeterminate),
                    progress: None,
                });
            },
        )
        .await;

    // Si se llega aquí con éxito es que no se ha cerrado (fuera de Windows);
    // en Windows sólo se llega si ha fallado.
    if let Err(error) = resultado {
        pintar(&app, serde_json::json!({
            "fase": "error",
            "mensaje": format!("La descarga ha fallado ({error})."),
        }), ProgressBarState {
            status: Some(ProgressBarStatus::Error),
            progress: Some(100),
        });
    }
}

/// Pinta el progreso de una descarga. Llega un aviso por cada trozo: se pinta
/// como mucho cada 200 ms, que es fluido y no inunda la página de `eval`.
/// `motivo`: por qué se baja el instalador completo cuando había paquete.
fn pintor_de_descarga(app: AppHandle, version: String, motivo: Option<String>) -> impl FnMut(u64, Option<u64>) + Send {
    let mut ultimo_pintado: Option<Instant> = None;
    move |descargado, total| {
        if ultimo_pintado.is_some_and(|antes| antes.elapsed() < Duration::from_millis(200)) {
            return;
        }
        ultimo_pintado = Some(Instant::now());
        let porcentaje = total.filter(|t| *t > 0).map(|t| (descargado * 100 / t).min(100));
        pintar(&app, serde_json::json!({
            "fase": "descargando", "version": version, "descargado": descargado, "total": total, "motivo": motivo,
        }), ProgressBarState {
            status: Some(if porcentaje.is_some() { ProgressBarStatus::Normal } else { ProgressBarStatus::Indeterminate }),
            progress: porcentaje,
        });
    }
}

/// Llama a la capa de `actualizacion.js` en todas las ventanas, definiéndola
/// si hace falta, y pone la barra del icono.
fn pintar(app: &AppHandle, estado: serde_json::Value, barra: ProgressBarState) {
    let codigo = format!("{}\n;window.__cajaActualizacion({});", include_str!("actualizacion.js"), estado);
    for ventana in app.webview_windows().into_values() {
        let _ = ventana.eval(&codigo);
        // `ProgressBarState` no es `Clone`.
        let _ = ventana.set_progress_bar(ProgressBarState { status: barra.status, progress: barra.progress });
    }
}

// --- Comandos del frontend ----------------------------------------------------

/// Lo último que se ha guardado con «Guardar como» —o la carpeta de «Guardar
/// todo en una carpeta»—, para «Mostrar en la carpeta». Se guarda aquí y no se
/// recibe de la página: así ese comando sólo puede enseñar lo que la persona
/// acaba de guardar, no cualquier ruta.
#[derive(Default)]
struct UltimoGuardado(Mutex<Option<PathBuf>>);

/// Guarda un resultado donde diga «Guardado» en Ajustes. Devuelve dónde ha
/// quedado, o nada si se ha cerrado el diálogo, que no es un error.
///
/// - **Preguntar** (de serie): el diálogo de «Guardar como».
/// - **Junto al original**: en la carpeta de lo que entró por «Abrir con…», el
///   menú del Explorador o «Añadir una carpeta». Si no se sabe cuál —el archivo
///   se eligió desde la página, y el navegador no da su ruta—, se pregunta.
/// - **Siempre en una carpeta**: ahí; si ya no existe, se pregunta.
///
/// Sin diálogo **nunca se sobrescribe** (`escribir_sin_pisar`): quien no ve
/// dónde cae el archivo no puede ver tampoco que pisa otro.
///
/// El contenido llega **en bruto** en el cuerpo de la llamada, no en JSON: un
/// PDF escaneado puede pesar cientos de megas. El nombre va en una cabecera,
/// codificado como en una URL porque las cabeceras sólo admiten ASCII.
#[tauri::command]
async fn guardar_como(
    app: AppHandle,
    ventana: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(datos) = request.body() else {
        return Err("el archivo tiene que llegar en bruto".into());
    };
    let nombre = request
        .headers()
        .get("x-nombre")
        .and_then(|valor| valor.to_str().ok())
        .map(|valor| percent_encoding::percent_decode_str(valor).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "resultado".into());

    let guardado = ajustes::leer(&app).guardado;
    let sin_preguntar = match guardado.modo {
        ajustes::ModoGuardado::Preguntar => None,
        ajustes::ModoGuardado::Junto => app.state::<Abiertos>().carpeta.lock().unwrap().clone(),
        ajustes::ModoGuardado::Carpeta => guardado.carpeta.map(PathBuf::from),
    }
    .filter(|carpeta| carpeta.is_dir());
    if let Some(carpeta) = sin_preguntar {
        let ruta = escribir_sin_pisar(&carpeta, &nombre, datos)?;
        let texto = ruta.display().to_string();
        *app.state::<UltimoGuardado>().0.lock().unwrap() = Some(ruta);
        return Ok(Some(texto));
    }

    let mut dialogo = app.dialog().file().set_file_name(&nombre);
    if let Some(carpeta) = app.state::<Abiertos>().carpeta.lock().unwrap().clone() {
        dialogo = dialogo.set_directory(carpeta);
    }
    // Hijo de la ventana que guarda, no de otra.
    dialogo = dialogo.set_parent(&ventana);
    // Con su tipo como filtro: así Windows no le cambia la extensión al
    // escribir otro nombre.
    if let Some(extension) = PathBuf::from(&nombre).extension().and_then(|e| e.to_str()) {
        dialogo = dialogo.add_filter(extension.to_uppercase(), &[extension]);
    }
    let Some(elegida) = dialogo.blocking_save_file() else {
        return Ok(None);
    };
    let ruta = elegida.into_path().map_err(|error| error.to_string())?;
    fs::write(&ruta, datos).map_err(|error| format!("No se ha podido guardar en {}: {error}", ruta.display()))?;
    let texto = ruta.display().to_string();
    *app.state::<UltimoGuardado>().0.lock().unwrap() = Some(ruta);
    Ok(Some(texto))
}

/// Abre el Explorador con lo último que se ha guardado, seleccionado; si fue
/// una carpeta entera, dentro de ella.
#[tauri::command]
fn mostrar_guardado(guardado: tauri::State<'_, UltimoGuardado>) -> Result<(), String> {
    let ruta = guardado.0.lock().unwrap().clone().ok_or("No se ha guardado nada todavía.")?;
    if ruta.is_dir() {
        tauri_plugin_opener::open_path(ruta, None::<&str>).map_err(|error| error.to_string())
    } else {
        tauri_plugin_opener::reveal_item_in_dir(ruta).map_err(|error| error.to_string())
    }
}

// --- Carpetas ------------------------------------------------------------------

/// Cuántos archivos trae «Añadir carpeta» como mucho. Es para no subir sin
/// querer miles de fotos al elegir una carpeta equivocada; el que quiera más,
/// que añada otra tanda.
const MAXIMO_CARPETA: usize = 500;

/// Lo que se ha encontrado en la carpeta elegida.
#[derive(serde::Serialize)]
struct Carpeta {
    carpeta: String,
    rutas: Vec<String>,
    /// Los que se han quedado fuera por el tope.
    sobran: usize,
}

/// «Añadir carpeta»: la persona elige una carpeta y se devuelven sus archivos
/// con alguna de esas extensiones, **sin entrar en subcarpetas** y por orden de
/// nombre. Quedan permitidos para `leer_archivo`, igual que los de «Abrir
/// con…», y la carpeta pasa a ser la que propone «Guardar como».
///
/// Async, como `guardar_como`: el diálogo bloquea, y un comando síncrono
/// correría en el hilo principal y congelaría todas las ventanas.
#[tauri::command]
async fn elegir_carpeta(
    app: AppHandle,
    ventana: WebviewWindow,
    extensiones: Vec<String>,
) -> Result<Option<Carpeta>, String> {
    let abiertos = app.state::<Abiertos>();
    let mut dialogo = app.dialog().file().set_parent(&ventana).set_title("Elige la carpeta con los archivos");
    if let Some(carpeta) = abiertos.carpeta.lock().unwrap().clone() {
        dialogo = dialogo.set_directory(carpeta);
    }
    let Some(elegida) = dialogo.blocking_pick_folder() else {
        return Ok(None);
    };
    let carpeta = elegida.into_path().map_err(|error| error.to_string())?;
    let extensiones: HashSet<String> = extensiones.iter().map(|ext| ext.to_lowercase()).collect();

    let mut rutas: Vec<PathBuf> = fs::read_dir(&carpeta)
        .map_err(|error| format!("No se ha podido leer {}: {error}", carpeta.display()))?
        .filter_map(Result::ok)
        .map(|entrada| entrada.path())
        .filter(|ruta| ruta.is_file())
        .filter(|ruta| {
            ruta.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| extensiones.contains(&ext.to_lowercase()))
        })
        .collect();
    rutas.sort_by_key(|ruta| ruta.file_name().map(|nombre| nombre.to_string_lossy().to_lowercase()));
    let sobran = rutas.len().saturating_sub(MAXIMO_CARPETA);
    rutas.truncate(MAXIMO_CARPETA);

    abiertos.permitidos.lock().unwrap().extend(rutas.iter().cloned());
    *abiertos.carpeta.lock().unwrap() = Some(carpeta.clone());
    Ok(Some(Carpeta {
        carpeta: carpeta.display().to_string(),
        rutas: rutas.iter().map(|ruta| ruta.to_string_lossy().into_owned()).collect(),
        sobran,
    }))
}

/// La carpeta de «Guardar todo en una carpeta», por ventana.
#[derive(Default)]
struct Destinos(Mutex<HashMap<String, PathBuf>>);

/// «Guardar todo en una carpeta», primer paso: la persona elige dónde. Se
/// guarda aquí, para esta ventana, y `guardar_en_destino` sólo escribe ahí: la
/// página nunca da una ruta, así que no puede escribir donde quiera.
#[tauri::command]
async fn elegir_destino(app: AppHandle, ventana: WebviewWindow) -> Result<Option<String>, String> {
    let mut dialogo = app.dialog().file().set_parent(&ventana).set_title("Elige dónde guardar los archivos");
    if let Some(carpeta) = app.state::<Abiertos>().carpeta.lock().unwrap().clone() {
        dialogo = dialogo.set_directory(carpeta);
    }
    let Some(elegida) = dialogo.blocking_pick_folder() else {
        return Ok(None);
    };
    let carpeta = elegida.into_path().map_err(|error| error.to_string())?;
    let texto = carpeta.display().to_string();
    *app.state::<UltimoGuardado>().0.lock().unwrap() = Some(carpeta.clone());
    app.state::<Destinos>().0.lock().unwrap().insert(ventana.label().to_string(), carpeta);
    Ok(Some(texto))
}

/// Escribe un archivo en la carpeta que esta ventana eligió con
/// `elegir_destino`, con su nombre y **sin sobrescribir nada**: si ya hay uno,
/// `nombre (1).pdf`, `nombre (2).pdf`… Como `guardar_como`, en bruto y con el
/// nombre en la cabecera `x-nombre`. Devuelve dónde ha quedado.
#[tauri::command]
async fn guardar_en_destino(
    app: AppHandle,
    ventana: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(datos) = request.body() else {
        return Err("el archivo tiene que llegar en bruto".into());
    };
    let carpeta = app
        .state::<Destinos>()
        .0
        .lock()
        .unwrap()
        .get(ventana.label())
        .cloned()
        .ok_or("No se ha elegido carpeta.")?;
    let nombre = request
        .headers()
        .get("x-nombre")
        .and_then(|valor| valor.to_str().ok())
        .map(|valor| percent_encoding::percent_decode_str(valor).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    escribir_sin_pisar(&carpeta, &nombre, datos).map(|ruta| ruta.display().to_string())
}

/// Escribe en `carpeta` con el nombre dado, reducido a un nombre de archivo, y
/// **sin sobrescribir nada**: si ya hay uno, `nombre (1).pdf`, `(2)`…
fn escribir_sin_pisar(carpeta: &std::path::Path, nombre: &str, datos: &[u8]) -> Result<PathBuf, String> {
    let nombre = nombre_de_archivo(nombre);
    // `create_new` y no mirar antes si existe: entre mirar y escribir podría
    // aparecer uno, y se sobrescribiría.
    for intento in 0..1000 {
        let ruta = carpeta.join(con_numero(&nombre, intento));
        match fs::OpenOptions::new().write(true).create_new(true).open(&ruta) {
            Ok(mut archivo) => {
                use std::io::Write;
                archivo
                    .write_all(datos)
                    .map_err(|error| format!("No se ha podido guardar en {}: {error}", ruta.display()))?;
                return Ok(ruta);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("No se ha podido guardar en {}: {error}", ruta.display())),
        }
    }
    Err(format!("Ya hay demasiados archivos llamados {nombre} en {}.", carpeta.display()))
}

/// Lo que llega de la página, reducido a un nombre de archivo de Windows: sin
/// carpetas delante (ni `..`), sin los caracteres que Windows no admite y sin
/// puntos ni espacios al final, que Windows quita en silencio.
fn nombre_de_archivo(nombre: &str) -> String {
    let ultimo = nombre.rsplit(['/', '\\']).next().unwrap_or_default();
    let limpio: String = ultimo
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let limpio = limpio.trim().trim_end_matches(['.', ' ']).to_string();
    if limpio.is_empty() || limpio == ".." { "resultado".into() } else { limpio }
}

/// `informe.pdf`, `informe (1).pdf`, `informe (2).pdf`…
fn con_numero(nombre: &str, numero: u32) -> String {
    if numero == 0 {
        return nombre.to_string();
    }
    match nombre.rsplit_once('.') {
        Some((base, extension)) if !base.is_empty() => format!("{base} ({numero}).{extension}"),
        _ => format!("{nombre} ({numero})"),
    }
}

/// Lo que ha llegado para esta ventana con «Abrir con…» o el menú del
/// Explorador y aún no se ha recogido, cada llegada con su herramienta. Sólo lo
/// que lleva un momento quieto: lo demás aún puede crecer, y
/// `avisar_cuando_paren` avisará cuando pare.
#[tauri::command]
fn archivos_pendientes(ventana: WebviewWindow, abiertos: tauri::State<'_, Abiertos>) -> Vec<LlegadaParaLaPagina> {
    let mut pendientes = abiertos.pendientes.lock().unwrap();
    let Some(de_la_ventana) = pendientes.get_mut(ventana.label()) else { return Vec::new() };
    let (quietas, creciendo): (Vec<_>, Vec<_>) = std::mem::take(de_la_ventana)
        .into_iter()
        .partition(|llegada| llegada.cuando.elapsed() >= AVISO_TRAS);
    *de_la_ventana = creciendo;
    quietas
        .into_iter()
        .map(|llegada| LlegadaParaLaPagina {
            herramienta: llegada.herramienta,
            rutas: llegada.rutas.iter().map(|ruta| ruta.to_string_lossy().into_owned()).collect(),
        })
        .collect()
}

/// Si el menú del Explorador está puesto y qué acciones lleva.
#[tauri::command]
fn menu_contextual(app: AppHandle) -> ajustes::Ajustes {
    menu::leer(&app)
}

/// Pone o quita el menú del Explorador con las acciones marcadas en Ajustes.
#[tauri::command]
fn aplicar_menu_contextual(
    app: AppHandle,
    activo: bool,
    acciones: Vec<menu::AccionMenu>,
) -> Result<ajustes::Ajustes, String> {
    menu::aplicar(&app, activo, acciones)
}

// --- Ajustes -------------------------------------------------------------------

/// Los de «Avanzado» con los que arrancó la aplicación: los que valen ahora.
struct AvanzadoAplicado(ajustes::Avanzado);

/// Lo que necesita la página de Ajustes.
#[derive(serde::Serialize)]
struct EstadoAjustes {
    ajustes: ajustes::Ajustes,
    /// Hay cambios de «Avanzado» que no valdrán hasta volver a abrir.
    reinicio_pendiente: bool,
}

fn estado_ajustes(app: &AppHandle, ajustes: ajustes::Ajustes) -> EstadoAjustes {
    let reinicio_pendiente = ajustes.avanzado != app.state::<AvanzadoAplicado>().0;
    EstadoAjustes { ajustes, reinicio_pendiente }
}

#[tauri::command]
fn leer_ajustes(app: AppHandle) -> EstadoAjustes {
    estado_ajustes(&app, ajustes::leer(&app))
}

/// Mezcla y guarda lo que cambia la página (ver `ajustes::mezclar`, que dice qué
/// puede tocar y qué no).
#[tauri::command]
fn guardar_ajustes(app: AppHandle, cambios: serde_json::Value) -> Result<EstadoAjustes, String> {
    let ajustes = ajustes::mezclar(&app, cambios)?;
    bandeja::sincronizar(&app, ajustes.ventana.a_la_bandeja);
    Ok(estado_ajustes(&app, ajustes))
}

/// «Siempre en esta carpeta»: la elige la persona con el diálogo de Windows. Es
/// la única forma de poner esa carpeta: la página nunca da una ruta, que sería
/// decidir dónde escribe «Guardar». Nada si se cierra el diálogo.
#[tauri::command]
async fn elegir_carpeta_de_guardado(app: AppHandle, ventana: WebviewWindow) -> Result<Option<EstadoAjustes>, String> {
    let mut actuales = ajustes::leer(&app);
    let mut dialogo = app.dialog().file().set_parent(&ventana).set_title("¿Dónde guardo los archivos?");
    if let Some(carpeta) = actuales.guardado.carpeta.clone() {
        dialogo = dialogo.set_directory(carpeta);
    }
    let Some(elegida) = dialogo.blocking_pick_folder() else {
        return Ok(None);
    };
    let carpeta = elegida.into_path().map_err(|error| error.to_string())?;
    actuales.guardado.carpeta = Some(carpeta.display().to_string());
    actuales.guardado.modo = ajustes::ModoGuardado::Carpeta;
    ajustes::guardar(&app, &actuales)?;
    Ok(Some(estado_ajustes(&app, actuales)))
}

/// Abre en el Explorador la carpeta de datos de la aplicación: los registros,
/// los ajustes y los archivos de trabajo. Sólo ésa; la página no dice cuál.
#[tauri::command]
fn abrir_carpeta_de_datos(app: AppHandle) -> Result<(), String> {
    let carpeta = soporte::carpeta_de_datos(&app).ok_or("No se encuentra la carpeta de datos.")?;
    tauri_plugin_opener::open_path(carpeta, None::<&str>).map_err(|error| error.to_string())
}

/// El texto de «Copiar información para soporte» (ver `soporte.rs`).
#[tauri::command]
fn informacion_de_soporte(app: AppHandle) -> String {
    soporte::informacion(&app, &app.state::<AvanzadoAplicado>().0)
}

/// «Reiniciar ahora», para que valgan los cambios de «Avanzado». Tauri vuelve a
/// lanzar la aplicación y sale; el job se lleva el backend por delante.
#[tauri::command]
fn reiniciar(app: AppHandle) {
    app.restart();
}

/// El contenido de uno de esos archivos, en bruto. Sólo de los que han llegado
/// así, y una vez: la página no puede leer cualquier cosa del disco.
#[tauri::command]
fn leer_archivo(ruta: String, abiertos: tauri::State<'_, Abiertos>) -> Result<tauri::ipc::Response, String> {
    let ruta = PathBuf::from(ruta);
    if !abiertos.permitidos.lock().unwrap().remove(&ruta) {
        return Err("Ese archivo no se ha abierto con la aplicación.".into());
    }
    fs::read(&ruta)
        .map(tauri::ipc::Response::new)
        .map_err(|error| format!("No se ha podido leer {}: {error}", ruta.display()))
}

// --- Trabajos largos ------------------------------------------------------------

/// El progreso de un trabajo en el icono de la barra de tareas, la misma barra
/// que usa la actualización: se ve aunque la ventana esté minimizada o tapada.
/// `porcentaje` sin valor es «no se sabe cuánto falta»; `terminado` la quita.
#[tauri::command]
fn progreso_tarea(ventana: WebviewWindow, porcentaje: Option<u64>, terminado: bool) {
    let estado = if terminado {
        ProgressBarState { status: Some(ProgressBarStatus::None), progress: None }
    } else {
        match porcentaje {
            Some(valor) => ProgressBarState { status: Some(ProgressBarStatus::Normal), progress: Some(valor.min(100)) },
            None => ProgressBarState { status: Some(ProgressBarStatus::Indeterminate), progress: None },
        }
    };
    let _ = ventana.set_progress_bar(estado);
}

/// Una notificación de Windows al terminar un trabajo largo, **sólo si la
/// ventana no tiene el foco**: si se está mirando, ya se ve el resultado y el
/// aviso sobra. Devuelve si la ha enseñado.
#[tauri::command]
fn avisar_fin(ventana: WebviewWindow, titulo: String, cuerpo: String) -> bool {
    use tauri_plugin_notification::NotificationExt;

    if ventana.is_focused().unwrap_or(false) {
        return false;
    }
    ventana.app_handle().notification().builder().title(titulo).body(cuerpo).show().is_ok()
}

/// Abre otra ventana vacía (Ctrl+N o el botón de la barra).
#[tauri::command]
fn nueva_ventana(app: AppHandle) {
    ventanas::crear_aparte(&app, None);
}

/// Lo que ha visto la autoprueba desde la página, al archivo que dice
/// `CAJA_AUTOPRUEBA`. Sin esa variable no hace nada: sólo la pone la CI.
#[tauri::command]
fn resultado_autoprueba(resultado: String) -> Result<(), String> {
    let destino = std::env::var_os("CAJA_AUTOPRUEBA").ok_or("sin autoprueba")?;
    fs::write(destino, resultado).map_err(|error| error.to_string())
}

/// Le dice al frontend que hay archivos nuevos esperando. Con un evento del DOM
/// y no con los de Tauri: así el frontend no necesita su biblioteca.
fn avisar_de_abiertos(ventana: &WebviewWindow) {
    let _ = ventana.eval("window.dispatchEvent(new Event('escritorio:archivos-abiertos'))");
}

/// Arranca el backend con los ajustes de «Avanzado» con los que ha abierto la
/// aplicación: los que van al backend, por variables de entorno (las que ya lee
/// `config.py`); la memoria y la prioridad, en el job.
fn arrancar_backend(app: &AppHandle, ajustes: &ajustes::Ajustes) -> Result<Backend, Box<dyn std::error::Error>> {
    let ejecutable = app
        .path()
        .resource_dir()?
        .join("backend")
        .join("merge-pdf-backend.exe");
    let registro = ruta_del_registro(app)?;
    let token = app.state::<Servidor>().token.lock().unwrap().clone();

    let mut orden = Command::new(&ejecutable);
    orden.envs(ajustes.entorno_del_backend());
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

    // Si no se puede, se sigue sin él: la aplicación funciona igual, sólo que
    // sin tope de memoria ni prioridad baja, y un cierre forzado dejaría el
    // backend vivo. Queda en el registro para saberlo.
    #[cfg(windows)]
    let trabajo = match trabajo::atar(
        &hijo,
        trabajo::tope_de_memoria(ajustes.avanzado.memoria_porcentaje),
        ajustes.avanzado.prioridad_baja.unwrap_or(true),
    ) {
        Ok(trabajo) => Some(trabajo),
        Err(error) => {
            let _ = fs::write(registro.with_extension("job.log"), &error);
            None
        }
    };

    let salida = hijo.stdout.take().expect("la salida del backend va por tubería");
    let registro_texto = registro.display().to_string();
    let para_el_hilo = app.clone();
    thread::spawn(move || esperar_listo(salida, para_el_hilo, registro_texto));

    Ok(Backend {
        hijo: Mutex::new(Some(hijo)),
        #[cfg(windows)]
        _trabajo: trabajo,
    })
}

/// Lee la salida del backend hasta que diga LISTO, y la sigue leyendo después:
/// si nadie vacía la tubería, el backend se bloquearía al escribir en ella.
fn esperar_listo(salida: std::process::ChildStdout, app: AppHandle, registro: String) {
    let servidor = app.state::<Servidor>();
    let mut listo = false;
    for linea in BufReader::new(salida).lines().map_while(Result::ok) {
        if listo {
            continue;
        }
        if let Some(numero) = linea.strip_prefix("LISTO ") {
            if let Ok(numero) = numero.trim().parse::<u16>() {
                // Primero el puerto y después las ventanas: una que se cree
                // entre medias ya va directa al backend.
                *servidor.puerto.lock().unwrap() = Some(numero);
                listo = true;
                let Some(url) = servidor.url() else { continue };
                for ventana in ventanas::en_arranque(&app) {
                    let _ = ventana.navigate(url.clone());
                    // La CI arranca la aplicación con CAJA_AUTOPRUEBA para saber
                    // si la página llega a los comandos (ver autoprueba.js). La
                    // prueba espera sola a que cargue la página del backend.
                    if ventana.label() == PRINCIPAL && std::env::var_os("CAJA_AUTOPRUEBA").is_some() {
                        let _ = ventana.eval(include_str!("autoprueba.js"));
                    }
                }
            }
        }
    }
    if !listo {
        // La salida se ha cerrado sin LISTO: el backend ha muerto al arrancar.
        // Lo que dijo está en el registro; se enseña el final, en todas las
        // ventanas y en las que se abran después.
        let detalle = fs::read_to_string(&registro)
            .map(|texto| {
                let lineas: Vec<&str> = texto.lines().collect();
                lineas[lineas.len().saturating_sub(25)..].join("\n")
            })
            .unwrap_or_default();
        *servidor.fallo.lock().unwrap() = Some((detalle.clone(), registro.clone()));
        for ventana in app.webview_windows().into_values() {
            ventanas::mostrar_fallo(&ventana, &detalle, &registro);
        }
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
