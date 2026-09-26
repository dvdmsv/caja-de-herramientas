//! El menú del Explorador: «Caja de herramientas» al hacer clic derecho en un
//! archivo, con un submenú de acciones que abren cada una su herramienta con el
//! archivo ya cargado.
//!
//! Desactivado de serie; se activa y se eligen las acciones en la página de
//! Ajustes. Qué acciones hay y sobre qué extensiones sale cada una lo decide el
//! frontend a partir del catálogo (`frontend/src/app/core/menu-contextual.ts`);
//! aquí sólo se valida y se escribe.
//!
//! Va en `HKCU\Software\Classes\SystemFileAssociations\.<ext>\shell`, que añade
//! la entrada sin tocar qué programa abre cada tipo ni desplazar la de nadie.
//! En Windows 11 sale en «Mostrar más opciones»: el menú nuevo sólo admite
//! extensiones con identidad de paquete (MSIX), y esto es un instalador NSIS.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// El nombre de la clave del submenú. Lo borra también el desinstalador
/// (`windows/ganchos.nsh`): si se cambia aquí, allí también.
pub const CLAVE: &str = "CajaDeHerramientas";

/// Lo que se guarda en `%LOCALAPPDATA%\merge-pdf\ajustes.json`.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Ajustes {
    /// Si está puesto en el registro.
    pub activo: bool,
    /// Las acciones marcadas, aunque esté desactivado: al volver a activarlo
    /// salen las mismas.
    pub acciones: Vec<String>,
    /// Dónde se escribió la última vez, para poder borrarlo todo después.
    #[serde(default)]
    pub extensiones_escritas: Vec<String>,
}

/// Una acción tal como la manda el frontend.
#[derive(Deserialize)]
pub struct AccionMenu {
    pub slug: String,
    pub nombre: String,
    pub extensiones: Vec<String>,
}

/// Sólo lo que puede ser un identificador de herramienta. Va dentro de la orden
/// que ejecuta el Explorador, así que no se admite nada más.
pub fn es_slug(texto: &str) -> bool {
    !texto.is_empty() && texto.len() <= 40 && texto.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn es_extension(texto: &str) -> bool {
    !texto.is_empty() && texto.len() <= 10 && texto.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn es_nombre(texto: &str) -> bool {
    !texto.trim().is_empty() && texto.chars().count() <= 60 && !texto.chars().any(char::is_control)
}

fn ruta_ajustes(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().local_data_dir().ok()?.join("merge-pdf").join("ajustes.json"))
}

pub fn leer(app: &AppHandle) -> Ajustes {
    ruta_ajustes(app)
        .and_then(|ruta| fs::read_to_string(ruta).ok())
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .unwrap_or_default()
}

fn guardar(app: &AppHandle, ajustes: &Ajustes) -> Result<(), String> {
    let ruta = ruta_ajustes(app).ok_or("sin carpeta de datos")?;
    if let Some(carpeta) = ruta.parent() {
        fs::create_dir_all(carpeta).map_err(|e| e.to_string())?;
    }
    let texto = serde_json::to_string_pretty(ajustes).map_err(|e| e.to_string())?;
    fs::write(ruta, texto).map_err(|e| e.to_string())
}

/// Pone o quita el menú según `activo`, con las acciones dadas, y lo recuerda.
pub fn aplicar(app: &AppHandle, activo: bool, acciones: Vec<AccionMenu>) -> Result<Ajustes, String> {
    for accion in &acciones {
        if !es_slug(&accion.slug) || !es_nombre(&accion.nombre) || !accion.extensiones.iter().all(|e| es_extension(e)) {
            return Err(format!("Acción no válida: {}", accion.slug));
        }
    }
    let anterior = leer(app);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    // Siempre se borra lo anterior entero y se escribe de nuevo: así una acción
    // desmarcada o una extensión que ya no toca no se quedan en el registro.
    registro::borrar(&anterior.extensiones_escritas);
    let extensiones_escritas = if activo {
        registro::escribir(&exe, &acciones).map_err(|e| format!("No se ha podido escribir en el registro: {e}"))?
    } else {
        Vec::new()
    };
    registro::avisar_al_explorador();

    let ajustes = Ajustes {
        activo,
        acciones: acciones.into_iter().map(|a| a.slug).collect(),
        extensiones_escritas,
    };
    guardar(app, &ajustes)?;
    Ok(ajustes)
}

#[cfg(windows)]
mod registro {
    use super::{AccionMenu, CLAVE};
    use std::collections::BTreeMap;
    use std::path::Path;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    fn ruta(extension: &str) -> String {
        format!(r"Software\Classes\SystemFileAssociations\.{extension}\shell\{CLAVE}")
    }

    /// Escribe el submenú en cada extensión y devuelve en cuáles lo ha hecho.
    pub fn escribir(exe: &Path, acciones: &[AccionMenu]) -> std::io::Result<Vec<String>> {
        let exe = exe.display().to_string();
        // Qué acciones van en cada extensión, en el orden del catálogo.
        let mut por_extension: BTreeMap<&str, Vec<&AccionMenu>> = BTreeMap::new();
        for accion in acciones {
            for extension in &accion.extensiones {
                por_extension.entry(extension.as_str()).or_default().push(accion);
            }
        }

        let raiz = RegKey::predef(HKEY_CURRENT_USER);
        for (extension, acciones) in &por_extension {
            let (menu, _) = raiz.create_subkey(ruta(extension))?;
            menu.set_value("MUIVerb", &"Caja de herramientas")?;
            menu.set_value("Icon", &format!("\"{exe}\",0"))?;
            // `SubCommands` vacío + la subclave `shell` es lo que hace submenú.
            menu.set_value("SubCommands", &"")?;
            for (orden, accion) in acciones.iter().enumerate() {
                // El número delante fija el orden: el Explorador ordena por nombre de clave.
                let (verbo, _) = menu.create_subkey(format!(r"shell\{orden:02}-{}", accion.slug))?;
                verbo.set_value("MUIVerb", &accion.nombre)?;
                let (orden_cmd, _) = verbo.create_subkey("command")?;
                orden_cmd.set_value("", &format!("\"{exe}\" --herramienta {} \"%1\"", accion.slug))?;
            }
        }
        Ok(por_extension.keys().map(|e| e.to_string()).collect())
    }

    pub fn borrar(extensiones: &[String]) {
        let raiz = RegKey::predef(HKEY_CURRENT_USER);
        for extension in extensiones {
            let _ = raiz.delete_subkey_all(ruta(extension));
        }
    }

    /// Que el Explorador se entere sin reiniciar la sesión.
    pub fn avisar_al_explorador() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }
}

#[cfg(not(windows))]
mod registro {
    use super::AccionMenu;
    use std::path::Path;

    pub fn escribir(_exe: &Path, acciones: &[AccionMenu]) -> std::io::Result<Vec<String>> {
        Ok(acciones.iter().flat_map(|a| a.extensiones.clone()).collect())
    }
    pub fn borrar(_extensiones: &[String]) {}
    pub fn avisar_al_explorador() {}
}
