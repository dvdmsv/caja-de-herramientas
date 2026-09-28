//! «Ayuda y diagnóstico», en Ajustes: el texto de «Copiar información para
//! soporte» y la carpeta de datos.
//!
//! Cuando alguien escribe con un fallo, lo que hace falta saber es qué versión
//! tiene, en qué Windows, con cuánta memoria y qué dijo el backend. Todo eso está
//! en su equipo y no en el correo; esto lo junta en un texto para pegar.
//!
//! **No lleva nombres de archivos ni su contenido**, y la página lo dice antes
//! de copiar. El registro del backend tampoco los apunta: registra errores y
//! rutas de la API, no lo que se sube.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::ajustes::Avanzado;

/// Cuántas líneas del final del registro del backend van en el texto.
const LINEAS_DEL_REGISTRO: usize = 40;

/// `%LOCALAPPDATA%\merge-pdf`: registros, ajustes y archivos de trabajo.
pub fn carpeta_de_datos(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().local_data_dir().ok()?.join("merge-pdf"))
}

pub fn informacion(app: &AppHandle, aplicado: &Avanzado) -> String {
    let mut texto = vec![
        format!("Caja de herramientas {}", app.package_info().version),
        format!("Windows: {}", version_de_windows()),
        format!("Memoria: {}", memoria()),
        format!("Núcleos: {}", std::thread::available_parallelism().map_or(0, |n| n.get())),
    ];
    let cambiados = ajustes_cambiados(aplicado);
    texto.push(if cambiados.is_empty() {
        "Ajustes avanzados: los de serie".into()
    } else {
        format!("Ajustes avanzados: {}", cambiados.join(", "))
    });

    let carpeta = carpeta_de_datos(app);
    for (titulo, archivo, lineas) in [("Registro del backend", "backend.log", LINEAS_DEL_REGISTRO),
                                     ("Registro del job", "backend.job.log", 10)] {
        let Some(contenido) = carpeta.as_ref().and_then(|c| fs::read_to_string(c.join(archivo)).ok()) else {
            continue;
        };
        let todas: Vec<&str> = contenido.lines().collect();
        texto.push(String::new());
        texto.push(format!("--- {titulo} (últimas {} líneas) ---", lineas.min(todas.len())));
        texto.extend(todas[todas.len().saturating_sub(lineas)..].iter().map(|linea| linea.to_string()));
    }
    texto.join("\n")
}

fn ajustes_cambiados(avanzado: &Avanzado) -> Vec<String> {
    let mut cambiados = Vec::new();
    if let Some(porcentaje) = avanzado.memoria_porcentaje {
        cambiados.push(if porcentaje == 0 { "memoria sin tope".into() } else { format!("memoria {porcentaje} %") });
    }
    if avanzado.prioridad_baja == Some(false) {
        cambiados.push("prioridad normal".into());
    }
    if let Some(mb) = avanzado.subida_max_mb {
        cambiados.push(format!("subida {mb} MB"));
    }
    if let Some(mb) = avanzado.cuota_mb {
        cambiados.push(format!("espacio por ventana {mb} MB"));
    }
    if avanzado.sello_tiempo.is_some() {
        cambiados.push("otro servidor de sello de tiempo".into());
    }
    cambiados
}

#[cfg(windows)]
fn memoria() -> String {
    let total = crate::trabajo::memoria_total().map_or("?".into(), |bytes| format!("{:.1} GB", bytes as f64 / 1e9));
    let tope = crate::trabajo::tope_de_memoria(None)
        .map_or("sin tope".into(), |bytes| format!("tope de serie {:.1} GB", bytes as f64 / 1e9));
    format!("{total} ({tope})")
}

#[cfg(not(windows))]
fn memoria() -> String {
    "?".into()
}

/// «Windows 11 Pro 24H2 (26100)», del registro, que es lo que dice la verdad:
/// las API de versión mienten a los programas sin manifiesto.
#[cfg(windows)]
fn version_de_windows() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let Ok(clave) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
    else {
        return "?".into();
    };
    let leer = |nombre: &str| clave.get_value::<String, _>(nombre).unwrap_or_default();
    let compilacion = leer("CurrentBuild");
    // El registro sigue diciendo «Windows 10» en Windows 11: lo distingue la
    // compilación, a partir de la 22000.
    let mut producto = leer("ProductName");
    if compilacion.parse::<u32>().is_ok_and(|n| n >= 22000) {
        producto = producto.replace("Windows 10", "Windows 11");
    }
    format!("{producto} {} ({compilacion})", leer("DisplayVersion")).trim().to_string()
}

#[cfg(not(windows))]
fn version_de_windows() -> String {
    std::env::consts::OS.into()
}
