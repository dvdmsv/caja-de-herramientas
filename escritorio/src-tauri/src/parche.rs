//! Actualizar por paquetes: bajar sólo los archivos que cambian y ponerlos en
//! su sitio, sin el instalador.
//!
//! Una versión normal cambia unos 30 MB de los 1270 que ocupa la instalación
//! (nuestro backend, el frontend y este ejecutable), y el instalador completo
//! son 310 MB de descarga que reescriben todo. Cada release publica, para cada
//! una de las versiones anteriores, un paquete con lo que cambia desde ella
//! (`escritorio/scripts/paquetes.py`), y `latest.json` los lista en `paquetes`.
//! Si hay uno para la versión instalada, se usa; si no, o si algo falla antes
//! de tocar la instalación, el instalador de siempre (`main.rs`, `instalar`).
//!
//! Los pasos:
//!
//! 1. **Bajar** el paquete a `%LOCALAPPDATA%\merge-pdf\actualizacion\` y
//!    comprobar su firma con la clave pública del actualizador, mientras llega.
//! 2. **Extraer** lo que trae, comprobando el SHA-256 de cada archivo contra
//!    `cambios.json`, que viene el primero.
//! 3. **Aplicar** no lo puede hacer este proceso: el backend y sus DLL están
//!    abiertos, y este mismo ejecutable también. Así que se copia a la carpeta
//!    de la actualización y se lanza desde allí con `--aplicar-actualizacion`
//!    (`aplicar_si_se_pide`, lo primero de `main()`, antes de crear Tauri), y
//!    esta aplicación sale. Esa copia espera a que salga, pone los archivos
//!    nuevos guardando los que sustituye, quita lo que sobra y abre la versión
//!    nueva. **Si algo falla a mitad, devuelve lo guardado** y abre la de antes,
//!    que ofrecerá el instalador completo.
//!
//! Y lo que no puede pasar es que algo de esto se quede ocupando sitio: al
//! arrancar, `limpiar_restos` borra la carpeta de la actualización entera y los
//! instaladores que deja en `%TEMP%` el actualizador de Tauri.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::parche_plan::{self as plan, Operacion, EJECUTABLE, FORMATO};

/// Lo que dice `latest.json` del paquete para una versión.
#[derive(Clone, serde::Deserialize)]
pub struct Paquete {
    pub url: String,
    pub firma: String,
    pub tamano: u64,
}

/// `cambios.json`, el primero del paquete. Lo escribe `paquetes.py`, `cambios()`.
#[derive(serde::Deserialize)]
struct Cambios {
    formato: u32,
    desde: String,
    hasta: String,
    /// Los que vienen en el paquete, con su SHA-256.
    archivos: BTreeMap<String, String>,
    /// La lista entera de la versión nueva.
    todos: Vec<String>,
}

/// Lo que deja `aplicar` para la aplicación que abre después.
#[derive(serde::Serialize, serde::Deserialize)]
struct Resultado {
    version: String,
    error: Option<String>,
}

/// Una actualización ya bajada y comprobada, lista para aplicar.
pub struct Preparada {
    carpeta: PathBuf,
}

const RESULTADO: &str = "resultado.json";
/// Lo tiene abierto la copia que aplica, sin compartir: mientras exista y no se
/// pueda borrar, hay una actualización a medias y no se limpia nada.
const APLICANDO: &str = "aplicando";

/// `%LOCALAPPDATA%\merge-pdf\actualizacion`.
pub fn carpeta_de_actualizacion(app: &AppHandle) -> Option<PathBuf> {
    Some(crate::soporte::carpeta_de_datos(app)?.join("actualizacion"))
}

/// El paquete para la versión instalada, si `latest.json` trae uno.
pub fn paquete_para(nueva: &tauri_plugin_updater::Update) -> Option<Paquete> {
    let paquete = nueva.raw_json.get("paquetes")?.get(&nueva.current_version)?;
    serde_json::from_value(paquete.clone()).ok()
}

/// Baja el paquete, comprueba su firma y lo extrae. `progreso(descargado, total)`.
pub async fn preparar(
    app: &AppHandle,
    paquete: &Paquete,
    instalada: &str,
    nueva: &str,
    mut progreso: impl FnMut(u64, u64),
) -> Result<Preparada, String> {
    let clave = clave_publica(app)?;
    let firma = decodificar(&paquete.firma)
        .and_then(|texto| minisign_verify::Signature::decode(&texto).map_err(|error| error.to_string()))
        .map_err(|error| format!("la firma del paquete no se entiende ({error})"))?;

    // Una por proceso: así la limpieza del arranque, que sólo borra lo que
    // encontró al empezar, no puede llevarse una descarga que empieza después.
    let carpeta = carpeta_de_actualizacion(app)
        .ok_or("no se encuentra la carpeta de datos")?
        .join(format!("{nueva}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&carpeta);
    fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
    let resultado = bajar_y_abrir(paquete, &carpeta, &clave, &firma, instalada, nueva, &mut progreso).await;
    if resultado.is_err() {
        // Lo que se haya bajado no sirve: no se queda ocupando sitio hasta el
        // próximo arranque.
        let _ = fs::remove_dir_all(&carpeta);
    }
    resultado.map(|()| Preparada { carpeta })
}

async fn bajar_y_abrir(
    paquete: &Paquete,
    carpeta: &Path,
    clave: &minisign_verify::PublicKey,
    firma: &minisign_verify::Signature,
    instalada: &str,
    nueva: &str,
    progreso: &mut impl FnMut(u64, u64),
) -> Result<(), String> {
    let mut comprobador = clave.verify_stream(firma).map_err(|error| format!("la firma no es de esta aplicación ({error})"))?;
    let ruta_del_paquete = carpeta.join("paquete.tar.gz");

    let cliente = reqwest::Client::builder()
        .user_agent(concat!("caja-de-herramientas/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let mut respuesta = cliente
        .get(&paquete.url)
        .send()
        .await
        .and_then(|respuesta| respuesta.error_for_status())
        .map_err(|error| format!("no se ha podido bajar ({error})"))?;
    let mut archivo = File::create(&ruta_del_paquete).map_err(|error| error.to_string())?;
    let mut descargado: u64 = 0;
    while let Some(trozo) = respuesta.chunk().await.map_err(|error| format!("la descarga se ha cortado ({error})"))? {
        descargado += trozo.len() as u64;
        // Un paquete que no para de crecer no es el que se anunció.
        if descargado > paquete.tamano.saturating_add(1 << 20) {
            return Err("el paquete es más grande de lo anunciado".into());
        }
        comprobador.update(&trozo);
        archivo.write_all(&trozo).map_err(|error| error.to_string())?;
        progreso(descargado, paquete.tamano);
    }
    archivo.flush().map_err(|error| error.to_string())?;
    drop(archivo);
    comprobador.finalize().map_err(|_| "la firma del paquete no es válida".to_string())?;

    let (instalada, nueva, carpeta) = (instalada.to_string(), nueva.to_string(), carpeta.to_path_buf());
    tauri::async_runtime::spawn_blocking(move || extraer(&ruta_del_paquete, &carpeta, &instalada, &nueva))
        .await
        .map_err(|error| error.to_string())?
}

/// La clave pública del actualizador (`plugins.updater.pubkey` de
/// `tauri.conf.json`): la misma que firma el instalador completo.
fn clave_publica(app: &AppHandle) -> Result<minisign_verify::PublicKey, String> {
    let codificada = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|clave| clave.as_str())
        .ok_or("falta la clave pública del actualizador")?;
    minisign_verify::PublicKey::decode(&decodificar(codificada)?).map_err(|error| error.to_string())
}

/// La clave y las firmas van en base64 sobre el texto de minisign, como las
/// del actualizador de Tauri.
fn decodificar(base64: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim()).map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

/// Saca el paquete a `<carpeta>/nuevos/`, comprobando cada archivo, y deja
/// `cambios.json` en `<carpeta>`. Un paquete para otra versión, con rutas que
/// se salen o con un archivo que no es el que dice, no se usa.
fn extraer(paquete: &Path, carpeta: &Path, instalada: &str, nueva: &str) -> Result<(), String> {
    let error_de_lectura = |error: io::Error| format!("el paquete está dañado ({error})");
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(File::open(paquete).map_err(error_de_lectura)?));
    let mut entradas = tar.entries().map_err(error_de_lectura)?;

    let mut primera = entradas.next().ok_or("el paquete está vacío")?.map_err(error_de_lectura)?;
    if primera.path().map_err(error_de_lectura)?.as_os_str() != "cambios.json" {
        return Err("el paquete no empieza por cambios.json".into());
    }
    let mut texto = String::new();
    primera.read_to_string(&mut texto).map_err(error_de_lectura)?;
    let cambios: Cambios = serde_json::from_str(&texto).map_err(|error| format!("cambios.json no se entiende ({error})"))?;
    if cambios.formato != FORMATO {
        return Err(format!("el paquete es de un formato que esta versión no conoce ({})", cambios.formato));
    }
    if cambios.desde != instalada || cambios.hasta != nueva {
        return Err(format!("el paquete es de la {} a la {}, no de la {instalada} a la {nueva}", cambios.desde, cambios.hasta));
    }
    // Todas las rutas, antes de escribir nada.
    let nuevos: Vec<String> = cambios.archivos.keys().cloned().collect();
    plan::plan(&nuevos, &cambios.todos, &cambios.todos)?;
    fs::write(carpeta.join("cambios.json"), &texto).map_err(|error| error.to_string())?;

    let mut pendientes = cambios.archivos;
    for entrada in entradas {
        let mut entrada = entrada.map_err(error_de_lectura)?;
        let nombre = entrada.path().map_err(error_de_lectura)?.to_string_lossy().replace('\\', "/");
        let ruta = nombre.strip_prefix("archivos/").unwrap_or(&nombre).to_string();
        let esperado = pendientes.remove(&ruta).ok_or_else(|| format!("el paquete trae algo que no anuncia: {nombre}"))?;
        if !entrada.header().entry_type().is_file() {
            return Err(format!("{ruta} no es un archivo"));
        }
        let destino = en(&carpeta.join("nuevos"), &ruta);
        fs::create_dir_all(destino.parent().unwrap()).map_err(|error| error.to_string())?;
        let mut salida = File::create(&destino).map_err(|error| error.to_string())?;
        let mut resumen = Sha256::new();
        let mut bufer = vec![0u8; 1 << 16];
        loop {
            let leidos = entrada.read(&mut bufer).map_err(error_de_lectura)?;
            if leidos == 0 {
                break;
            }
            resumen.update(&bufer[..leidos]);
            salida.write_all(&bufer[..leidos]).map_err(|error| error.to_string())?;
        }
        if format!("{:x}", resumen.finalize()) != esperado {
            return Err(format!("{ruta} no es el archivo que tenía que ser"));
        }
    }
    if let Some((falta, _)) = pendientes.into_iter().next() {
        return Err(format!("al paquete le falta {falta}"));
    }
    let _ = fs::remove_file(paquete);
    Ok(())
}

/// Una ruta del paquete (ya validada, con `/`) dentro de `raiz`.
fn en(raiz: &Path, ruta: &str) -> PathBuf {
    ruta.split('/').fold(raiz.to_path_buf(), |camino, parte| camino.join(parte))
}

/// Lanza la copia que aplica la actualización y devuelve; quien llama tiene que
/// salir enseguida, que es a lo que espera la copia. Si la instalación no se
/// puede tocar desde aquí (una instalación para todos los usuarios, o esto no
/// es una instalación), falla antes de salir y se usa el instalador.
pub fn lanzar(preparada: &Preparada) -> Result<(), String> {
    let actual = std::env::current_exe().map_err(|error| error.to_string())?;
    let instalacion = actual.parent().ok_or("no se sabe dónde está instalada")?;
    if actual.file_name().and_then(|nombre| nombre.to_str()) != Some(EJECUTABLE) {
        return Err("esto no es una instalación".into());
    }
    let prueba = instalacion.join(".se-puede-escribir");
    File::create(&prueba).map_err(|_| "no se puede escribir en la carpeta de la instalación".to_string())?;
    let _ = fs::remove_file(&prueba);

    let aplicador = preparada.carpeta.join("aplicador.exe");
    fs::copy(&actual, &aplicador).map_err(|error| error.to_string())?;
    let argumentos = [
        "--aplicar-actualizacion".into(),
        preparada.carpeta.clone().into_os_string(),
        "--instalacion".into(),
        instalacion.as_os_str().to_owned(),
        "--esperar".into(),
        std::process::id().to_string().into(),
    ];
    lanzar_suelto(&aplicador, &argumentos).map_err(|error| format!("no se ha podido lanzar ({error})"))
}

/// Un proceso que no muera con éste. Fuera de cualquier job en el que se haya
/// arrancado la aplicación, si se puede: hay lanzadores que meten lo suyo en un
/// job que mata todo al salir.
fn lanzar_suelto(programa: &Path, argumentos: &[std::ffi::OsString]) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS};
        let suelto = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        return Command::new(programa)
            .args(argumentos)
            .creation_flags(suelto | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
            .or_else(|_| Command::new(programa).args(argumentos).creation_flags(suelto).spawn())
            .map(|_| ());
    }
    #[allow(unreachable_code)]
    Command::new(programa).args(argumentos).spawn().map(|_| ())
}

// --- La copia que aplica ------------------------------------------------------

/// Si se ha arrancado para aplicar una actualización, la aplica y devuelve el
/// código de salida; si no, `None` y `main()` sigue como siempre.
pub fn aplicar_si_se_pide() -> Option<i32> {
    let argumentos: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let valor = |nombre: &str| {
        argumentos.iter().position(|argumento| argumento == nombre).and_then(|i| argumentos.get(i + 1)).cloned()
    };
    let carpeta = PathBuf::from(valor("--aplicar-actualizacion")?);
    let Some(instalacion) = valor("--instalacion").map(PathBuf::from) else {
        return Some(2);
    };
    let esperar = valor("--esperar").and_then(|pid| pid.to_str()?.parse::<u32>().ok());
    let abrir = !argumentos.iter().any(|argumento| argumento == "--sin-abrir");

    if let Some(pid) = esperar {
        esperar_a(pid);
    }
    let raiz = carpeta.parent().unwrap_or(&carpeta).to_path_buf();
    let cerrojo = cerrojo(&raiz.join(APLICANDO));

    let resultado = aplicar(&carpeta, &instalacion);
    let (version, error) = match resultado {
        Ok(version) => (version, None),
        Err((version, error)) => (version, Some(error)),
    };
    let _ = fs::write(raiz.join(RESULTADO), serde_json::to_vec(&Resultado { version, error: error.clone() }).unwrap_or_default());
    // Soltado antes de abrir la aplicación: si no, su limpieza lo encontraría
    // cogido, creería que aún se está aplicando y no borraría nada.
    drop(cerrojo);
    let _ = fs::remove_file(raiz.join(APLICANDO));
    if abrir {
        // La nueva, o la de antes si se ha devuelto todo a su sitio.
        let _ = lanzar_suelto(&instalacion.join(EJECUTABLE), &[]);
    }
    Some(if error.is_some() { 1 } else { 0 })
}

/// Aplica `cambios.json` de `carpeta` sobre la instalación. Devuelve la versión
/// que queda y, si falla, por qué.
fn aplicar(carpeta: &Path, instalacion: &Path) -> Result<String, (String, String)> {
    let texto = fs::read_to_string(carpeta.join("cambios.json")).map_err(|error| (String::new(), error.to_string()))?;
    let cambios: Cambios = serde_json::from_str(&texto).map_err(|error| (String::new(), error.to_string()))?;
    let fallo = |error: String| (cambios.desde.clone(), error);

    let nuevos: Vec<String> = cambios.archivos.keys().cloned().collect();
    let operaciones = plan::plan(&nuevos, &cambios.todos, &existentes(instalacion)).map_err(fallo)?;

    let respaldo = carpeta.join("respaldo");
    let nuevos = carpeta.join("nuevos");
    // El proceso anterior acaba de salir, pero su backend (y lo que lanzara)
    // muere con el job un momento después: hasta entonces sus archivos siguen
    // abiertos. Se reintenta un rato; un archivo que siga bloqueado después ya
    // es otra cosa, y se deshace todo.
    let hasta = Instant::now() + Duration::from_secs(20);
    let mut hechas: Vec<&Operacion> = Vec::new();
    for operacion in &operaciones {
        let hecho = match operacion {
            Operacion::Poner(ruta) => {
                let destino = en(instalacion, ruta);
                let guardado = if destino.exists() { mover(&destino, &en(&respaldo, ruta), hasta) } else { Ok(()) };
                guardado.and_then(|()| mover(&en(&nuevos, ruta), &destino, hasta))
            }
            Operacion::Quitar(ruta) => mover(&en(instalacion, ruta), &en(&respaldo, ruta), hasta),
        };
        if let Err(error) = hecho {
            let ruta = match operacion {
                Operacion::Poner(ruta) | Operacion::Quitar(ruta) => ruta,
            };
            // Lo que quedó a medias de la operación que falló también se deshace:
            // `mover` no deja nada por el camino, pero un Poner puede haber
            // guardado ya el viejo.
            hechas.push(operacion);
            deshacer(&hechas, instalacion, &respaldo, &nuevos);
            return Err(fallo(format!("{ruta}: {error}")));
        }
        hechas.push(operacion);
    }

    quitar_carpetas_vacias(instalacion);
    anotar_version(instalacion, &cambios.hasta);
    Ok(cambios.hasta)
}

/// Devuelve cada archivo a su sitio, en orden inverso. Mejor esfuerzo: si algo
/// no vuelve, lo arreglará el instalador completo que se ofrece después.
fn deshacer(hechas: &[&Operacion], instalacion: &Path, respaldo: &Path, nuevos: &Path) {
    let ahora = Instant::now() + Duration::from_secs(5);
    for operacion in hechas.iter().rev() {
        match operacion {
            Operacion::Poner(ruta) => {
                let destino = en(instalacion, ruta);
                let guardado = en(respaldo, ruta);
                if destino.exists() && !en(nuevos, ruta).exists() {
                    let _ = mover(&destino, &en(nuevos, ruta), ahora);
                }
                if guardado.exists() {
                    let _ = mover(&guardado, &destino, ahora);
                }
            }
            Operacion::Quitar(ruta) => {
                let _ = mover(&en(respaldo, ruta), &en(instalacion, ruta), ahora);
            }
        }
    }
}

/// Mueve un archivo creando lo que haga falta. Renombrar y no copiar: es
/// instantáneo y no puede dejar un archivo a medio escribir. Si están en discos
/// distintos, copia y borra.
fn mover(de: &Path, a: &Path, hasta: Instant) -> io::Result<()> {
    if let Some(padre) = a.parent() {
        fs::create_dir_all(padre)?;
    }
    loop {
        match fs::rename(de, a) {
            Ok(()) => return Ok(()),
            // ERROR_NOT_SAME_DEVICE
            Err(error) if error.raw_os_error() == Some(17) => {
                fs::copy(de, a)?;
                return fs::remove_file(de);
            }
            // ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION: aún abierto.
            Err(error) if matches!(error.raw_os_error(), Some(5 | 32)) && Instant::now() < hasta => {
                thread::sleep(Duration::from_millis(300));
            }
            Err(error) => return Err(error),
        }
    }
}

/// El ejecutable y lo que haya en las carpetas gestionadas, con `/`.
fn existentes(instalacion: &Path) -> Vec<String> {
    let mut rutas = Vec::new();
    if instalacion.join(EJECUTABLE).is_file() {
        rutas.push(EJECUTABLE.to_string());
    }
    for carpeta in plan::CARPETAS {
        recorrer(&instalacion.join(carpeta.trim_end_matches('/')), carpeta.trim_end_matches('/'), &mut rutas);
    }
    rutas
}

fn recorrer(carpeta: &Path, prefijo: &str, rutas: &mut Vec<String>) {
    let Ok(entradas) = fs::read_dir(carpeta) else { return };
    for entrada in entradas.flatten() {
        let nombre = format!("{prefijo}/{}", entrada.file_name().to_string_lossy());
        match entrada.file_type() {
            Ok(tipo) if tipo.is_dir() => recorrer(&entrada.path(), &nombre, rutas),
            Ok(_) => rutas.push(nombre),
            Err(_) => {}
        }
    }
}

/// Las carpetas que se han quedado vacías al quitar lo que sobraba (los trozos
/// del frontend van en una carpeta que no cambia, pero una biblioteca de Python
/// que deja de usarse se lleva la suya entera).
fn quitar_carpetas_vacias(instalacion: &Path) {
    fn vaciar(carpeta: &Path) {
        if let Ok(entradas) = fs::read_dir(carpeta) {
            for entrada in entradas.flatten() {
                if entrada.file_type().is_ok_and(|tipo| tipo.is_dir()) {
                    vaciar(&entrada.path());
                    // Sólo se borra si está vacía: `remove_dir` no borra contenido.
                    let _ = fs::remove_dir(entrada.path());
                }
            }
        }
    }
    for carpeta in plan::CARPETAS {
        vaciar(&instalacion.join(carpeta.trim_end_matches('/')));
    }
}

/// La versión que enseña «Aplicaciones instaladas» de Windows, y que el
/// instalador mira para saber qué hay: la escribe NSIS en la clave de
/// desinstalación, y sin esto seguiría diciendo la de antes.
fn anotar_version(instalacion: &Path, version: &str) {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
        use winreg::RegKey;

        let normal = |texto: &str| texto.trim_matches('"').trim_end_matches('\\').to_lowercase();
        let buscada = normal(&instalacion.to_string_lossy());
        let Ok(desinstalar) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Uninstall", KEY_READ)
        else {
            return;
        };
        for nombre in desinstalar.enum_keys().flatten() {
            let Ok(clave) = desinstalar.open_subkey_with_flags(&nombre, KEY_READ | KEY_SET_VALUE) else { continue };
            let ubicacion: String = clave.get_value("InstallLocation").unwrap_or_default();
            let desinstalador: String = clave.get_value("UninstallString").unwrap_or_default();
            if normal(&ubicacion) == buscada || normal(&desinstalador).starts_with(&format!("{buscada}\\")) {
                let _ = clave.set_value("DisplayVersion", &version);
                return;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (instalacion, version);
}

/// Espera a que salga el proceso que lanzó la actualización, como mucho un
/// minuto.
fn esperar_a(pid: u32) {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
        let proceso = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !proceso.is_null() {
            WaitForSingleObject(proceso, 60_000);
            CloseHandle(proceso);
        }
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Un archivo abierto sin compartir: mientras viva, nadie lo puede borrar.
fn cerrojo(ruta: &Path) -> Option<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        return fs::OpenOptions::new().write(true).create(true).truncate(true).share_mode(0).open(ruta).ok();
    }
    #[allow(unreachable_code)]
    File::create(ruta).ok()
}

// --- Limpieza -----------------------------------------------------------------

/// Al arrancar: borra la carpeta de la actualización y los restos del
/// actualizador de Tauri. Devuelve por qué falló la última actualización por
/// paquete, si falló (la ha devuelto a su sitio y ha abierto esta versión).
///
/// Nada de lo que hay en esa carpeta sirve de un arranque a otro: la versión
/// que traía ya está puesta, o se falló y se ofrecerá el instalador, o se quedó
/// a medias y se volverá a bajar. Así que se borra entera.
pub fn limpiar_restos(app: &AppHandle) -> Option<String> {
    limpiar_temporales(&app.package_info().name);

    let carpeta = carpeta_de_actualizacion(app)?;
    let aplicando = carpeta.join(APLICANDO);
    // Otra copia de la aplicación abierta mientras se aplica: no se toca nada.
    if aplicando.exists() && fs::remove_file(&aplicando).is_err() {
        return None;
    }
    let fallo = fs::read(carpeta.join(RESULTADO))
        .ok()
        .and_then(|datos| serde_json::from_slice::<Resultado>(&datos).ok())
        .and_then(|resultado| resultado.error);

    let restos: Vec<PathBuf> = fs::read_dir(&carpeta).ok()?.flatten().map(|entrada| entrada.path()).collect();
    thread::spawn(move || {
        // La copia que aplicó puede estar saliendo todavía: lo que no se deje
        // borrar ahora, dentro de un momento.
        for intento in 0..3 {
            if intento > 0 {
                thread::sleep(Duration::from_secs(5));
            }
            let quedan = restos.iter().filter(|ruta| ruta.exists() && borrar(ruta).is_err()).count();
            if quedan == 0 {
                let _ = fs::remove_dir(&carpeta);
                break;
            }
        }
    });
    fallo
}

fn borrar(ruta: &Path) -> io::Result<()> {
    if ruta.is_dir() {
        fs::remove_dir_all(ruta)
    } else {
        fs::remove_file(ruta)
    }
}

/// Las carpetas que deja en `%TEMP%` el actualizador de Tauri con el instalador
/// completo dentro (~310 MB cada una). Las de hace menos de un minuto no: puede
/// ser el instalador que acaba de volver a abrir esta aplicación, aún saliendo.
fn limpiar_temporales(producto: &str) {
    let Ok(entradas) = fs::read_dir(std::env::temp_dir()) else { return };
    for entrada in entradas.flatten() {
        let nombre = entrada.file_name();
        if !plan::es_resto_del_actualizador(&nombre.to_string_lossy(), producto) {
            continue;
        }
        let reciente = entrada
            .metadata()
            .and_then(|datos| datos.modified())
            .ok()
            .and_then(|cuando| SystemTime::now().duration_since(cuando).ok())
            .is_some_and(|edad| edad < Duration::from_secs(60));
        if !reciente {
            let _ = borrar(&entrada.path());
        }
    }
}
