//! La bóveda en el disco: `%LOCALAPPDATA%\merge-pdf\boveda.json`.
//!
//! Aquí sólo se lee, se escribe y se borra un texto que **ya llega cifrado**:
//! cifra y descifra la página (`frontend/src/app/core/boveda/`), y ni la
//! contraseña ni el contenido pasan por Rust. El certificado y su contraseña
//! tienen que estar de todos modos en la página para viajar al backend, así
//! que cifrar aquí no protegería más.
//!
//! Aparte de `main.rs` y **sólo con `std`**, como `parche_plan.rs`, para
//! probarlo con `rustc --test` suelto en la CI, sin compilar Tauri.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const NOMBRE: &str = "boveda.json";

/// Lo más que se acepta guardar. Unos certificados y unas firmas son cientos
/// de kB; esto es sólo que la página no pueda llenar el disco por un fallo.
pub const TOPE: usize = 32 * 1024 * 1024;

/// Lo que hay guardado, o nada si todavía no hay bóveda.
pub fn leer(ruta: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(ruta) {
        Ok(texto) => Ok(Some(texto)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("No se ha podido leer la bóveda: {error}")),
    }
}

/// Sustituye lo guardado **de una vez**: se escribe al lado y se cambia el
/// nombre, así que un cierre a mitad deja la bóveda de antes y no media.
/// `fs::rename` sustituye al que hubiera también en Windows
/// (`MOVEFILE_REPLACE_EXISTING`).
pub fn guardar(ruta: &Path, contenido: &str) -> Result<(), String> {
    if contenido.len() > TOPE {
        return Err("La bóveda no cabe: quita algún certificado o alguna firma.".into());
    }
    if !parece_una_boveda(contenido) {
        return Err("Lo que se quería guardar no es una bóveda.".into());
    }
    if let Some(carpeta) = ruta.parent() {
        fs::create_dir_all(carpeta).map_err(|error| error.to_string())?;
    }
    let temporal = temporal_de(ruta);
    let escrito = (|| -> io::Result<()> {
        let mut archivo = fs::File::create(&temporal)?;
        archivo.write_all(contenido.as_bytes())?;
        archivo.sync_all()
    })();
    if let Err(error) = escrito.and_then(|()| fs::rename(&temporal, ruta)) {
        let _ = fs::remove_file(&temporal);
        return Err(format!("No se ha podido guardar la bóveda: {error}"));
    }
    Ok(())
}

/// Borra la bóveda. Que no exista no es un error: ya está borrada.
pub fn borrar(ruta: &Path) -> Result<(), String> {
    match fs::remove_file(ruta) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("No se ha podido borrar la bóveda: {error}")),
    }
}

fn temporal_de(ruta: &Path) -> PathBuf {
    let mut nombre = ruta.file_name().unwrap_or_default().to_os_string();
    nombre.push(".tmp");
    ruta.with_file_name(nombre)
}

/// Sin `serde`, para seguir sólo con `std`: un objeto JSON que dice su formato.
/// Lo que importa lo comprueba la página al descifrar; esto sólo evita dejar
/// en el disco algo que no se podrá abrir nunca.
fn parece_una_boveda(texto: &str) -> bool {
    let texto = texto.trim();
    texto.starts_with('{') && texto.ends_with('}') && texto.contains("\"formato\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carpeta(nombre: &str) -> PathBuf {
        let carpeta = std::env::temp_dir().join(format!("boveda-{nombre}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&carpeta);
        carpeta
    }

    const BOVEDA: &str = r#"{"formato":1,"datos":"xyz"}"#;

    #[test]
    fn sin_boveda_no_hay_nada_que_leer() {
        let ruta = carpeta("vacia").join(NOMBRE);
        assert_eq!(leer(&ruta), Ok(None));
    }

    #[test]
    fn se_guarda_se_lee_y_se_sustituye_entera() {
        let ruta = carpeta("guardar").join(NOMBRE);
        guardar(&ruta, BOVEDA).unwrap();
        assert_eq!(leer(&ruta), Ok(Some(BOVEDA.to_string())));

        let otra = r#"{"formato":1,"datos":"otra"}"#;
        guardar(&ruta, otra).unwrap();
        assert_eq!(leer(&ruta), Ok(Some(otra.to_string())));
        // Sin restos del temporal.
        assert!(!temporal_de(&ruta).exists());
    }

    #[test]
    fn lo_que_no_es_una_boveda_no_se_guarda_ni_pisa_la_que_hay() {
        let ruta = carpeta("rechazo").join(NOMBRE);
        guardar(&ruta, BOVEDA).unwrap();
        assert!(guardar(&ruta, "").is_err());
        assert!(guardar(&ruta, "hola").is_err());
        assert!(guardar(&ruta, r#"{"datos":"sin formato"}"#).is_err());
        assert_eq!(leer(&ruta), Ok(Some(BOVEDA.to_string())));
    }

    #[test]
    fn lo_demasiado_grande_no_se_guarda() {
        let ruta = carpeta("grande").join(NOMBRE);
        let enorme = format!(r#"{{"formato":1,"datos":"{}"}}"#, "x".repeat(TOPE));
        assert!(guardar(&ruta, &enorme).is_err());
        assert_eq!(leer(&ruta), Ok(None));
    }

    #[test]
    fn borrar_la_que_no_existe_no_es_un_error() {
        let ruta = carpeta("borrar").join(NOMBRE);
        assert_eq!(borrar(&ruta), Ok(()));
        guardar(&ruta, BOVEDA).unwrap();
        assert_eq!(borrar(&ruta), Ok(()));
        assert_eq!(leer(&ruta), Ok(None));
    }
}
