//! Los ajustes de la aplicación: `%LOCALAPPDATA%\merge-pdf\ajustes.json`.
//!
//! Es el único que lee y escribe ese archivo. Lo del menú del Explorador sigue
//! en los mismos campos de primer nivel de siempre (`activo`, `acciones`…), así
//! que un archivo de una versión anterior se lee igual: lo que no traiga sale
//! con su valor de serie (`#[serde(default)]`).
//!
//! **Todo se recorta a su rango al leerlo** (`recortar`): un archivo editado a
//! mano, o de una versión con otros rangos, no puede dejar la aplicación sin
//! arrancar ni con un tope de memoria absurdo.
//!
//! Los valores de serie de «Avanzado» no se guardan: `None` es «el de serie», y
//! quien lo sabe es el backend (`escritorio.preparar_entorno`) o `trabajo.rs`.
//! Así sólo hay un sitio para cada número.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default)]
pub struct Ajustes {
    // --- el menú del Explorador (ver `menu.rs`) ---
    /// Si está puesto en el registro.
    pub activo: bool,
    /// Las acciones marcadas, aunque esté desactivado: al volver a activarlo
    /// salen las mismas.
    pub acciones: Vec<String>,
    /// Dónde se escribió la última vez, para poder borrarlo todo después.
    pub extensiones_escritas: Vec<String>,

    /// La versión que se ha pedido saltar en el aviso de actualización.
    pub version_saltada: Option<String>,

    pub guardado: Guardado,
    pub avisos: Avisos,
    pub actualizaciones: Actualizaciones,
    pub avanzado: Avanzado,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ModoGuardado {
    /// El diálogo de «Guardar como» cada vez.
    #[default]
    Preguntar,
    /// En la carpeta del archivo que entró por «Abrir con…», el menú del
    /// Explorador o «Añadir una carpeta». Si no se sabe, se pregunta.
    Junto,
    /// Siempre en `carpeta`.
    Carpeta,
}

#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default)]
pub struct Guardado {
    pub modo: ModoGuardado,
    /// Sólo la pone el diálogo de `elegir_carpeta_de_guardado`, nunca la página.
    pub carpeta: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Avisos {
    /// La notificación de Windows al terminar un trabajo largo.
    pub activos: bool,
    /// A partir de cuántos segundos de trabajo.
    pub desde_segundos: u32,
}

impl Default for Avisos {
    fn default() -> Self {
        Avisos { activos: true, desde_segundos: 10 }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Actualizaciones {
    /// Buscar una versión nueva al abrir la aplicación.
    pub al_abrir: bool,
}

impl Default for Actualizaciones {
    fn default() -> Self {
        Actualizaciones { al_abrir: true }
    }
}

/// Lo de «Avanzado». `None` es el valor de serie; se aplica al volver a abrir.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default)]
pub struct Avanzado {
    /// Parte de la RAM para el backend y lo que lance, en %; `Some(0)` es sin tope.
    pub memoria_porcentaje: Option<u32>,
    /// Trabajos con prioridad por debajo de lo normal (de serie, sí).
    pub prioridad_baja: Option<bool>,
    /// Lo más que se puede subir de una vez, en MB (`MAX_CONTENT_LENGTH_MB`).
    pub subida_max_mb: Option<u32>,
    /// Lo más que pueden ocupar los archivos de una ventana, en MB (`SESSION_QUOTA_MB`).
    pub cuota_mb: Option<u32>,
    /// El servidor de sello de tiempo de «Firmar con certificado» (`TSA_URL`).
    pub sello_tiempo: Option<String>,
}

pub const AVISOS_DESDE: (u32, u32) = (5, 3600);
pub const MEMORIA: (u32, u32) = (30, 90);
pub const SUBIDA_MB: (u32, u32) = (100, 8192);
pub const CUOTA_MB: (u32, u32) = (1024, 102_400);

fn en(valor: u32, (minimo, maximo): (u32, u32)) -> u32 {
    valor.clamp(minimo, maximo)
}

impl Ajustes {
    /// Todo dentro de su rango; lo que no tiene arreglo, a su valor de serie.
    pub fn recortar(mut self) -> Self {
        self.avisos.desde_segundos = en(self.avisos.desde_segundos, AVISOS_DESDE);
        let avanzado = &mut self.avanzado;
        avanzado.memoria_porcentaje = avanzado.memoria_porcentaje.map(|p| if p == 0 { 0 } else { en(p, MEMORIA) });
        avanzado.subida_max_mb = avanzado.subida_max_mb.map(|mb| en(mb, SUBIDA_MB));
        avanzado.cuota_mb = avanzado.cuota_mb.map(|mb| en(mb, CUOTA_MB));
        avanzado.sello_tiempo = avanzado.sello_tiempo.take().filter(|url| es_url_segura(url));
        if self.guardado.modo == ModoGuardado::Carpeta && self.guardado.carpeta.is_none() {
            self.guardado.modo = ModoGuardado::Preguntar;
        }
        self
    }

    /// Las variables de entorno con las que arrancar el backend: sólo las que
    /// no están en su valor de serie, que es el que pone `escritorio.py`.
    pub fn entorno_del_backend(&self) -> Vec<(&'static str, String)> {
        let mut entorno = Vec::new();
        if let Some(mb) = self.avanzado.subida_max_mb {
            entorno.push(("MAX_CONTENT_LENGTH_MB", mb.to_string()));
        }
        if let Some(mb) = self.avanzado.cuota_mb {
            entorno.push(("SESSION_QUOTA_MB", mb.to_string()));
        }
        if let Some(url) = &self.avanzado.sello_tiempo {
            entorno.push(("TSA_URL", url.clone()));
        }
        entorno
    }
}

/// Un `https://` con algo detrás y sin espacios ni caracteres de control. Va a
/// una variable de entorno y de ahí a una petición: no se admite otra cosa.
pub fn es_url_segura(url: &str) -> bool {
    url.len() <= 300
        && url.strip_prefix("https://").is_some_and(|resto| !resto.is_empty())
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

pub fn ruta(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().local_data_dir().ok()?.join("merge-pdf").join("ajustes.json"))
}

pub fn leer(app: &AppHandle) -> Ajustes {
    ruta(app)
        .and_then(|ruta| fs::read_to_string(ruta).ok())
        .and_then(|texto| serde_json::from_str::<Ajustes>(&texto).ok())
        .unwrap_or_default()
        .recortar()
}

pub fn guardar(app: &AppHandle, ajustes: &Ajustes) -> Result<(), String> {
    let ruta = ruta(app).ok_or("sin carpeta de datos")?;
    if let Some(carpeta) = ruta.parent() {
        fs::create_dir_all(carpeta).map_err(|e| e.to_string())?;
    }
    let texto = serde_json::to_string_pretty(ajustes).map_err(|e| e.to_string())?;
    fs::write(ruta, texto).map_err(|e| e.to_string())
}

/// Mezcla en los ajustes lo que manda la página y guarda.
///
/// **La página sólo puede tocar lo suyo**: avisos, actualizaciones, avanzado,
/// el modo de guardado y borrar la versión saltada. El menú del Explorador va
/// por `menu::aplicar`, que es quien escribe en el registro, y la carpeta fija
/// sólo la pone el diálogo de `elegir_carpeta_de_guardado`: si la página
/// pudiera decir una ruta, decidiría dónde escribe «Guardar».
pub fn mezclar(app: &AppHandle, cambios: serde_json::Value) -> Result<Ajustes, String> {
    let actuales = leer(app);
    let mut valor = serde_json::to_value(&actuales).map_err(|e| e.to_string())?;
    let serde_json::Value::Object(cambios) = cambios else {
        return Err("Los cambios no son válidos.".into());
    };
    for (clave, nuevo) in cambios {
        match clave.as_str() {
            "avisos" | "actualizaciones" | "avanzado" => mezclar_objeto(&mut valor[clave.as_str()], nuevo),
            "guardado" => {
                if let Some(modo) = nuevo.get("modo") {
                    valor["guardado"]["modo"] = modo.clone();
                }
            }
            "version_saltada" if nuevo.is_null() => valor["version_saltada"] = serde_json::Value::Null,
            _ => return Err(format!("El ajuste «{clave}» no se puede cambiar desde aquí.")),
        }
    }
    let ajustes = serde_json::from_value::<Ajustes>(valor).map_err(|e| format!("Ajuste no válido: {e}"))?.recortar();
    guardar(app, &ajustes)?;
    Ok(ajustes)
}

fn mezclar_objeto(destino: &mut serde_json::Value, nuevo: serde_json::Value) {
    match (destino, nuevo) {
        (serde_json::Value::Object(destino), serde_json::Value::Object(nuevo)) => {
            for (clave, valor) in nuevo {
                destino.insert(clave, valor);
            }
        }
        (destino, nuevo) => *destino = nuevo,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_archivo_viejo_se_lee_con_los_valores_de_serie() {
        let viejo = r#"{"activo": true, "acciones": ["unir-pdf"], "extensiones_escritas": ["pdf"]}"#;
        let ajustes = serde_json::from_str::<Ajustes>(viejo).unwrap().recortar();
        assert!(ajustes.activo);
        assert_eq!(ajustes.avisos, Avisos::default());
        assert!(ajustes.actualizaciones.al_abrir);
        assert_eq!(ajustes.guardado.modo, ModoGuardado::Preguntar);
        assert_eq!(ajustes.avanzado, Avanzado::default());
    }

    #[test]
    fn lo_que_se_sale_de_rango_se_recorta() {
        let raro = r#"{"avisos": {"desde_segundos": 1}, "avanzado": {"memoria_porcentaje": 150,
            "subida_max_mb": 1, "cuota_mb": 999999999, "sello_tiempo": "http://inseguro"},
            "guardado": {"modo": "carpeta"}}"#;
        let ajustes = serde_json::from_str::<Ajustes>(raro).unwrap().recortar();
        assert_eq!(ajustes.avisos.desde_segundos, AVISOS_DESDE.0);
        assert_eq!(ajustes.avanzado.memoria_porcentaje, Some(MEMORIA.1));
        assert_eq!(ajustes.avanzado.subida_max_mb, Some(SUBIDA_MB.0));
        assert_eq!(ajustes.avanzado.cuota_mb, Some(CUOTA_MB.1));
        assert_eq!(ajustes.avanzado.sello_tiempo, None);
        // Carpeta fija sin carpeta: se vuelve a preguntar.
        assert_eq!(ajustes.guardado.modo, ModoGuardado::Preguntar);
    }

    #[test]
    fn sin_tope_de_memoria_es_cero_y_se_respeta() {
        let ajustes = serde_json::from_str::<Ajustes>(r#"{"avanzado": {"memoria_porcentaje": 0}}"#)
            .unwrap()
            .recortar();
        assert_eq!(ajustes.avanzado.memoria_porcentaje, Some(0));
    }

    #[test]
    fn al_backend_solo_va_lo_que_no_es_de_serie() {
        let mut ajustes = Ajustes::default();
        assert!(ajustes.entorno_del_backend().is_empty());
        ajustes.avanzado.subida_max_mb = Some(4096);
        ajustes.avanzado.sello_tiempo = Some("https://tsa.example/tsr".into());
        assert_eq!(ajustes.entorno_del_backend(), vec![
            ("MAX_CONTENT_LENGTH_MB", "4096".to_string()),
            ("TSA_URL", "https://tsa.example/tsr".to_string()),
        ]);
    }

    #[test]
    fn la_url_del_sello_tiene_que_ser_https_y_limpia() {
        assert!(es_url_segura("https://freetsa.org/tsr"));
        assert!(!es_url_segura("http://freetsa.org/tsr"));
        assert!(!es_url_segura("https://"));
        assert!(!es_url_segura("https://a b"));
    }
}
