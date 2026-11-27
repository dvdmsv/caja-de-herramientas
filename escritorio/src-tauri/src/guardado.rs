//! Publica el archivo sólo después de escribirlo entero en el mismo volumen.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

struct Temporal(PathBuf);

impl Drop for Temporal {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

static SIGUIENTE: AtomicU64 = AtomicU64::new(0);

fn preparar(carpeta: &Path, escribir: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<Temporal> {
    loop {
        let numero = SIGUIENTE.fetch_add(1, Ordering::Relaxed);
        let ruta = carpeta.join(format!(".caja-{}-{numero}.tmp", std::process::id()));
        match OpenOptions::new().create_new(true).write(true).open(&ruta) {
            Ok(mut salida) => {
                let temporal = Temporal(ruta);
                let resultado = escribir(&mut salida).and_then(|()| salida.sync_all());
                drop(salida);
                resultado?;
                return Ok(temporal);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

pub fn reemplazar(destino: &Path, escribir: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let carpeta = destino.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let completo = preparar(carpeta, escribir)?;
    fs::rename(&completo.0, destino)
}

pub fn sin_pisar(carpeta: &Path, nombre: &str, datos: &[u8]) -> io::Result<PathBuf> {
    let completo = preparar(carpeta, |salida| salida.write_all(datos))?;
    for numero in 0..1000 {
        let destino = carpeta.join(con_numero(nombre, numero));
        match publicar_nuevo(&completo.0, &destino) {
            Ok(()) => return Ok(destino),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "hay demasiados archivos con ese nombre"))
}

#[cfg(windows)]
fn publicar_nuevo(origen: &Path, destino: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileW(origen: *const u16, destino: *const u16) -> i32;
    }
    // canonicalize devuelve en Windows una ruta absoluta con el prefijo de
    // longitud extendida. El nuevo archivo todavía no se puede canonicalizar.
    let carpeta = origen.parent().ok_or(io::ErrorKind::InvalidInput)?.canonicalize()?;
    let ancho = |p: &Path| -> io::Result<Vec<u16>> {
        let ruta = carpeta.join(p.file_name().ok_or(io::ErrorKind::InvalidInput)?);
        Ok(ruta.as_os_str().encode_wide().chain(Some(0)).collect())
    };
    let origen = ancho(origen)?;
    let destino = ancho(destino)?;
    if unsafe { MoveFileW(origen.as_ptr(), destino.as_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn publicar_nuevo(origen: &Path, destino: &Path) -> io::Result<()> {
    fs::hard_link(origen, destino)
}

fn con_numero(nombre: &str, numero: u32) -> String {
    if numero == 0 {
        return nombre.to_string();
    }
    match nombre.rsplit_once('.') {
        Some((base, extension)) if !base.is_empty() => format!("{base} ({numero}).{extension}"),
        _ => format!("{nombre} ({numero})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallo_y_reintento_conservan_el_original() {
        let carpeta = std::env::temp_dir().join(format!("guardado-caja-{}", std::process::id()));
        fs::create_dir_all(&carpeta).unwrap();
        let original = carpeta.join("documento.pdf");
        fs::write(&original, b"original").unwrap();
        let resultado = reemplazar(&original, |f| {
            f.write_all(b"parcial")?;
            Err(io::Error::other("disco lleno"))
        });
        assert!(resultado.is_err());
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert_eq!(carpeta.read_dir().unwrap().count(), 1);
        let nuevo = sin_pisar(&carpeta, "documento.pdf", b"dos").unwrap();
        assert_eq!(nuevo, carpeta.join("documento (1).pdf"));
        assert_eq!(fs::read(nuevo).unwrap(), b"dos");
        reemplazar(&original, |f| f.write_all(b"completo")).unwrap();
        assert_eq!(fs::read(original).unwrap(), b"completo");
        fs::remove_dir_all(carpeta).unwrap();
    }
}
