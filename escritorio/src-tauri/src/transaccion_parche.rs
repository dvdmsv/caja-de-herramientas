//! Respaldo de los archivos afectados y punto de recuperación del parche.
//! Hasta que el diario está publicado no se toca ningún archivo instalado.

use crate::{guardado, parche_plan::{self, Operacion}};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

pub const DIARIO: &str = "recuperar.txt";

fn copiar(origen: &Path, destino: &Path) -> io::Result<()> {
    fs::create_dir_all(destino.parent().ok_or(io::ErrorKind::InvalidInput)?)?;
    guardado::reemplazar(destino, |salida| io::copy(&mut File::open(origen)?, salida).map(|_| ()))
}

fn quitar(ruta: &Path) -> io::Result<()> {
    match fs::remove_file(ruta) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        resultado => resultado,
    }
}

fn con_reintento(mut accion: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    let hasta = Instant::now() + Duration::from_secs(20);
    loop {
        match accion() {
            Err(e) if matches!(e.raw_os_error(), Some(5 | 32)) && Instant::now() < hasta => {
                thread::sleep(Duration::from_millis(300));
            }
            resultado => return resultado,
        }
    }
}

pub fn preparar(carpeta: &Path, instalacion: &Path, operaciones: &[Operacion]) -> io::Result<()> {
    let mut diario = String::from("1\n");
    for operacion in operaciones {
        let ruta = match operacion { Operacion::Poner(ruta) | Operacion::Quitar(ruta) => ruta };
        if !parche_plan::ruta_valida(ruta) || ruta.chars().any(char::is_control) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "ruta del parche no válida"));
        }
        let origen = instalacion.join(ruta);
        if origen.try_exists()? {
            copiar(&origen, &carpeta.join("respaldo").join(ruta))?;
            diario.push('+');
        } else {
            diario.push('-');
        }
        diario.push_str(ruta);
        diario.push('\n');
    }
    guardado::reemplazar(&carpeta.join(DIARIO), |f| f.write_all(diario.as_bytes()))
}

pub fn instalar(carpeta: &Path, instalacion: &Path, operacion: &Operacion) -> io::Result<()> {
    match operacion {
        Operacion::Poner(ruta) => con_reintento(|| copiar(&carpeta.join("nuevos").join(ruta), &instalacion.join(ruta))),
        Operacion::Quitar(ruta) => con_reintento(|| quitar(&instalacion.join(ruta))),
    }
}

/// Es idempotente, incluso si el proceso vuelve a interrumpirse en la recuperación.
pub fn recuperar(carpeta: &Path, instalacion: &Path) -> io::Result<()> {
    let diario = fs::read_to_string(carpeta.join(DIARIO))?;
    let mut lineas = diario.lines();
    if lineas.next() != Some("1") {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "no se reconoce el diario del parche"));
    }
    for linea in lineas.rev() {
        if let Some(ruta) = linea.strip_prefix('+').filter(|r| parche_plan::ruta_valida(r)) {
            con_reintento(|| copiar(&carpeta.join("respaldo").join(ruta), &instalacion.join(ruta)))?;
        } else if let Some(ruta) = linea.strip_prefix('-').filter(|r| parche_plan::ruta_valida(r)) {
            con_reintento(|| quitar(&instalacion.join(ruta)))?;
        } else {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "entrada de recuperación no válida"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pasos() -> [Operacion; 3] {
        [Operacion::Poner(parche_plan::EJECUTABLE.into()), Operacion::Poner("backend/alta".into()),
            Operacion::Quitar("backend/obsoleto".into())]
    }

    // El padre corta este proceso con kill/TerminateProcess después del paso
    // indicado. El disco es lo único que comparte con la recuperación.
    #[test]
    fn aplicador_hijo_para_prueba() {
        let Some(raiz) = std::env::var_os("CAJA_PRUEBA_PARAR_PARCHE") else { return };
        let trabajo = Path::new(&raiz);
        let instalacion = trabajo.join("instalacion");
        let paquete = trabajo.join("paquete");
        let hechos: usize = fs::read_to_string(trabajo.join("pasos")).unwrap().parse().unwrap();
        preparar(&paquete, &instalacion, &pasos()).unwrap();
        for paso in &pasos()[..hechos] {
            instalar(&paquete, &instalacion, paso).unwrap();
        }
        fs::write(trabajo.join("listo"), b"").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn restaurar_tras_cada_paso_y_repetir_la_recuperacion() {
        for hechos in 0..=3 {
            let trabajo = std::env::temp_dir().join(format!("transaccion-caja-{}-{hechos}", std::process::id()));
            let instalacion = trabajo.join("instalacion");
            let paquete = trabajo.join("paquete");
            fs::create_dir_all(instalacion.join("backend")).unwrap();
            fs::create_dir_all(paquete.join("nuevos/backend")).unwrap();
            fs::write(instalacion.join(parche_plan::EJECUTABLE), "anterior").unwrap();
            fs::write(instalacion.join("backend/obsoleto"), "guardar").unwrap();
            fs::write(paquete.join("nuevos").join(parche_plan::EJECUTABLE), "nueva").unwrap();
            fs::write(paquete.join("nuevos/backend/alta"), "alta").unwrap();
            fs::write(trabajo.join("pasos"), hechos.to_string()).unwrap();
            let mut hijo = std::process::Command::new(std::env::current_exe().unwrap())
                .arg("aplicador_hijo_para_prueba").env("CAJA_PRUEBA_PARAR_PARCHE", &trabajo)
                .stdout(std::process::Stdio::null()).spawn().unwrap();
            let hasta = Instant::now() + Duration::from_secs(15);
            while !trabajo.join("listo").is_file() {
                assert!(hijo.try_wait().unwrap().is_none(), "el aplicador terminó antes de tiempo");
                assert!(Instant::now() < hasta, "el aplicador no alcanzó el paso");
                thread::sleep(Duration::from_millis(10));
            }
            hijo.kill().unwrap();
            hijo.wait().unwrap();
            for _ in 0..2 {
                recuperar(&paquete, &instalacion).unwrap();
                assert_eq!(fs::read(instalacion.join(parche_plan::EJECUTABLE)).unwrap(), b"anterior");
                assert_eq!(fs::read(instalacion.join("backend/obsoleto")).unwrap(), b"guardar");
                assert!(!instalacion.join("backend/alta").exists());
            }
            fs::remove_dir_all(trabajo).unwrap();
        }
    }
}
