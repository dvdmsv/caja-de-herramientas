/// Los comandos propios de la aplicación (los de `generate_handler!` en
/// main.rs) no se pueden llamar desde la página si no tienen un permiso que la
/// capacidad conceda: la página la sirve el backend en 127.0.0.1, y para Tauri
/// eso es un origen remoto. Sin esto, Tauri los rechazaba («not allowed by
/// ACL») y el frontend caía en silencio a lo del navegador: «Guardar» iba a
/// Descargas y «Abrir con…» no llegaba nunca. Cada comando de aquí genera un
/// permiso `allow-<comando>` (con guiones), que hay que añadir a
/// `capabilities/escritorio.json`; `tauri-build` falla si no existe.
const COMANDOS: &[&str] = &[
    "guardar_como",
    "mostrar_guardado",
    "archivos_pendientes",
    "leer_archivo",
    "menu_contextual",
    "aplicar_menu_contextual",
    "progreso_tarea",
    "avisar_fin",
    "resultado_autoprueba",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMANDOS)),
    )
    .expect("no se han podido generar los permisos de la aplicación");
}
