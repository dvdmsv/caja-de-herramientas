//! Lo que se decide al aplicar un paquete de actualización, sin tocar el disco:
//! qué rutas son aceptables, qué hay que poner y qué hay que quitar.
//!
//! Aparte de `parche.rs` y **sólo con `std`** para poder probarlo con `rustc
//! --test` suelto, sin compilar Tauri (como se hace en la CI).

use std::collections::BTreeSet;

/// El ejecutable de Tauri, en la raíz de la instalación.
pub const EJECUTABLE: &str = "caja-de-herramientas.exe";

/// Las carpetas que quedan **exactamente** como dice el paquete: lo que haya
/// dentro y no esté en su lista, se borra. Son las que el instalador llena con
/// `bundle.resources` (`tauri.conf.json`), y nada escribe en ellas mientras la
/// aplicación funciona: el perfil de LibreOffice va a una carpeta temporal y
/// PyInstaller no escribe junto a sí. Lo mismo que `CARPETAS_GESTIONADAS` en
/// `escritorio/scripts/paquetes.py`.
pub const CARPETAS: [&str; 2] = ["backend/", "vendor/"];

/// El formato de `cambios.json` que se sabe aplicar (`FORMATO` en paquetes.py).
pub const FORMATO: u32 = 1;

/// Una ruta del paquete, relativa a la instalación y con `/`, que se puede
/// escribir o borrar: el ejecutable o algo dentro de las carpetas gestionadas,
/// y nada que se salga de ellas. El paquete va firmado, pero un fallo al
/// generarlo no puede acabar escribiendo fuera de la instalación.
pub fn ruta_valida(ruta: &str) -> bool {
    if ruta.is_empty() || ruta.contains(['\\', ':', '\0']) || ruta.starts_with('/') {
        return false;
    }
    if ruta.split('/').any(|parte| parte.is_empty() || parte == "." || parte == ".." || parte.ends_with(['.', ' '])) {
        return false;
    }
    ruta == EJECUTABLE || CARPETAS.iter().any(|carpeta| ruta.starts_with(carpeta))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Operacion {
    /// Poner el archivo del paquete, sustituyendo al que haya.
    Poner(String),
    /// Quitar un archivo que la versión nueva ya no tiene.
    Quitar(String),
}

/// Qué hacer para que la instalación quede como la versión nueva.
///
/// - `nuevos`: los archivos que trae el paquete.
/// - `todos`: la lista entera de la versión nueva.
/// - `existentes`: lo que hay ahora en la instalación (el ejecutable y lo de
///   las carpetas gestionadas).
///
/// Se quita **todo lo que sobre en las carpetas gestionadas**, no sólo lo que
/// cambió entre las dos versiones: así la primera actualización por paquetes se
/// lleva también los restos de las que se hicieron con el instalador, que nunca
/// borraba nada. Y si falta algo que el paquete da por instalado —porque
/// alguien lo borró, o la instalación no es la que se cree—, no se aplica: sólo
/// el instalador completo sabe dejarla bien.
pub fn plan(nuevos: &[String], todos: &[String], existentes: &[String]) -> Result<Vec<Operacion>, String> {
    if let Some(mala) = nuevos.iter().chain(todos).find(|ruta| !ruta_valida(ruta)) {
        return Err(format!("el paquete trae una ruta no válida: {mala}"));
    }
    let todos: BTreeSet<&str> = todos.iter().map(String::as_str).collect();
    let nuevos_: BTreeSet<&str> = nuevos.iter().map(String::as_str).collect();
    if let Some(suelto) = nuevos_.iter().find(|ruta| !todos.contains(*ruta)) {
        return Err(format!("el paquete trae un archivo que no es de la versión nueva: {suelto}"));
    }
    let existentes: BTreeSet<&str> = existentes.iter().map(String::as_str).collect();
    if let Some(falta) = todos.iter().find(|ruta| !nuevos_.contains(*ruta) && !existentes.contains(*ruta)) {
        return Err(format!("falta un archivo de la instalación: {falta}"));
    }

    let mut operaciones: Vec<Operacion> = nuevos_.iter().map(|ruta| Operacion::Poner(ruta.to_string())).collect();
    operaciones.extend(
        existentes
            .iter()
            .filter(|ruta| !todos.contains(*ruta) && CARPETAS.iter().any(|carpeta| ruta.starts_with(carpeta)))
            .map(|ruta| Operacion::Quitar(ruta.to_string())),
    );
    Ok(operaciones)
}

/// Si una carpeta de `%TEMP%` es de las que deja el actualizador de Tauri al
/// bajar el instalador completo: `"<producto>-<versión>-updater-XXXX"`
/// (`tauri-plugin-updater`, `updater.rs`). El proceso sale para que corra el
/// instalador y ya no puede borrarla.
pub fn es_resto_del_actualizador(nombre: &str, producto: &str) -> bool {
    nombre.strip_prefix(producto).and_then(|resto| resto.strip_prefix('-')).is_some_and(|resto| resto.contains("-updater-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(rutas: &[&str]) -> Vec<String> {
        rutas.iter().map(|ruta| ruta.to_string()).collect()
    }

    #[test]
    fn rutas_aceptables_y_las_que_se_salen() {
        for buena in [EJECUTABLE, "backend/merge-pdf-backend.exe", "vendor/libreoffice/program/soffice.exe"] {
            assert!(ruta_valida(buena), "{buena}");
        }
        for mala in [
            "", "/backend/a", "backend/../uninstall.exe", "backend/./a", "backend//a", "C:/Windows/a",
            "backend\\a", "uninstall.exe", "otra/a", "backend", "backend/", "backend/a.", "backend/a ",
            "backend/a:flujo",
        ] {
            assert!(!ruta_valida(mala), "{mala}");
        }
    }

    #[test]
    fn pone_lo_que_trae_y_quita_lo_que_sobra_en_las_carpetas_gestionadas() {
        let operaciones = plan(
            &v(&["backend/_internal/frontend/main-B.js", EJECUTABLE]),
            &v(&[EJECUTABLE, "backend/_internal/frontend/main-B.js", "backend/merge-pdf-backend.exe", "vendor/a"]),
            &v(&[EJECUTABLE, "backend/_internal/frontend/main-A.js", "backend/merge-pdf-backend.exe", "vendor/a",
                 "vendor/basura.tmp"]),
        )
        .unwrap();
        assert_eq!(operaciones, vec![
            Operacion::Poner("backend/_internal/frontend/main-B.js".into()),
            Operacion::Poner(EJECUTABLE.into()),
            Operacion::Quitar("backend/_internal/frontend/main-A.js".into()),
            Operacion::Quitar("vendor/basura.tmp".into()),
        ]);
    }

    #[test]
    fn sin_cambios_no_hace_nada() {
        let todos = v(&[EJECUTABLE, "backend/a"]);
        assert_eq!(plan(&[], &todos, &todos).unwrap(), vec![]);
    }

    #[test]
    fn no_aplica_si_falta_algo_que_da_por_instalado() {
        let error = plan(&[], &v(&["backend/a", "vendor/b"]), &v(&["backend/a"])).unwrap_err();
        assert!(error.contains("vendor/b"), "{error}");
    }

    #[test]
    fn no_aplica_con_rutas_que_se_salen_o_archivos_sueltos() {
        assert!(plan(&v(&["../fuera"]), &v(&["../fuera"]), &[]).is_err());
        assert!(plan(&v(&["backend/a"]), &v(&["backend/b"]), &v(&["backend/b"])).is_err());
    }

    #[test]
    fn restos_del_actualizador_de_tauri() {
        let producto = "Caja de herramientas";
        assert!(es_resto_del_actualizador("Caja de herramientas-0.2.4-updater-aB3xY9", producto));
        assert!(!es_resto_del_actualizador("Caja de herramientas-0.2.4", producto));
        assert!(!es_resto_del_actualizador("Otra app-0.2.4-updater-aB3xY9", producto));
        assert!(!es_resto_del_actualizador("Caja de herramientas", producto));
    }
}
