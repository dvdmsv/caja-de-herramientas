use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Lo que llega de una vez por «Abrir con…» o por el menú del Explorador.
pub struct Llegada {
    /// La herramienta elegida en el menú; `None` es «Abrir con…» (la portada).
    pub herramienta: Option<String>,
    pub rutas: Vec<PathBuf>,
    cuando: Instant,
}

/// Los archivos que llegan con «Abrir con…» o el menú del Explorador,
/// esperando a que el frontend los recoja, **cada uno para su ventana**.
/// `permitidos` es la lista de lo único que `leer_archivo` puede leer: sin ella,
/// la página podría pedir cualquier archivo del disco.
#[derive(Default)]
pub struct Abiertos {
    /// Por etiqueta de ventana. La ventana puede no existir aún: se crea en otro
    /// hilo (ver `ventanas.rs`) y recoge lo suyo en cuanto arranca su página.
    pendientes: Mutex<HashMap<String, Vec<Llegada>>>,
    pub permitidos: Mutex<HashMap<String, HashSet<PathBuf>>>,
    pub origenes: Mutex<HashMap<String, HashSet<PathBuf>>>,
    /// La carpeta de lo último que ha llegado: «Guardar como» la propone, que
    /// es donde suele querer dejarse el resultado. Lo que se elige con el
    /// selector de la página no trae ruta (el navegador no la da).
    pub carpetas: Mutex<HashMap<String, PathBuf>>,
    /// A qué ventana fue lo último, con qué herramienta y cuándo: lo que llegue
    /// igual y enseguida es de la misma selección y va a la misma ventana.
    ultima: Mutex<Option<(String, Option<String>, Instant)>>,
    /// Sube con cada llegada: sirve para avisar a la página sólo cuando han
    /// dejado de llegar (ver `avisar_cuando_paren`).
    generaciones: Mutex<HashMap<String, u64>>,
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
pub const AVISO_TRAS: Duration = Duration::from_millis(700);

impl Abiertos {
    /// Si lo que llega con esta herramienta es de la misma selección que lo
    /// anterior, la ventana a la que fue aquello.
    pub fn ventana_de_la_seleccion(&self, herramienta: &Option<String>) -> Option<String> {
        match &*self.ultima.lock().unwrap() {
            Some((etiqueta, anterior, cuando)) if anterior == herramienta && cuando.elapsed() < JUNTOS => {
                Some(etiqueta.clone())
            }
            _ => None,
        }
    }

    /// Deja los archivos para la ventana `etiqueta`, sumándolos a su última
    /// llegada si son de la misma selección.
    pub fn anotar(&self, etiqueta: &str, herramienta: Option<String>, rutas: Vec<PathBuf>) {
        if rutas.is_empty() {
            return;
        }
        if let Some(carpeta) = rutas[0].parent() {
            self.carpetas.lock().unwrap().insert(etiqueta.to_owned(), carpeta.to_owned());
        }
        self.permitidos.lock().unwrap().entry(etiqueta.to_owned()).or_default().extend(rutas.iter().cloned());

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
        *self.generaciones.lock().unwrap().entry(etiqueta.to_owned()).or_default() += 1;
    }

    pub fn generacion(&self, ventana: &str) -> Option<u64> {
        self.generaciones.lock().unwrap().get(ventana).copied()
    }

    pub fn recoger(&self, ventana: &str, ahora: Instant) -> Vec<Llegada> {
        let mut pendientes = self.pendientes.lock().unwrap();
        let Some(cola) = pendientes.get_mut(ventana) else { return Vec::new() };
        let (listas, creciendo) = std::mem::take(cola).into_iter()
            .partition(|llegada| ahora.saturating_duration_since(llegada.cuando) >= AVISO_TRAS);
        *cola = creciendo;
        listas
    }

    pub fn carpeta_del_original(&self, ventana: &str, ruta: &Path) -> Option<PathBuf> {
        let origenes = self.origenes.lock().unwrap();
        if origenes.get(ventana)?.contains(ruta) {
            return ruta.parent().map(Path::to_owned);
        }
        None
    }

    pub fn cerrar(&self, ventana: &str) {
        self.pendientes.lock().unwrap().remove(ventana);
        self.generaciones.lock().unwrap().remove(ventana);
        self.carpetas.lock().unwrap().remove(ventana);
        self.permitidos.lock().unwrap().remove(ventana);
        self.origenes.lock().unwrap().remove(ventana);
        let mut ultima = self.ultima.lock().unwrap();
        if ultima.as_ref().is_some_and(|(etiqueta, _, _)| etiqueta == ventana) {
            *ultima = None;
        }
    }
}

/// Cada aviso sólo puede revelar un destino ya guardado por su ventana.
#[derive(Default)]
pub struct Guardados(Mutex<HashMap<String, HashSet<PathBuf>>>);

impl Guardados {
    pub fn anotar(&self, ventana: &str, ruta: PathBuf) {
        self.0.lock().unwrap().entry(ventana.to_owned()).or_default().insert(ruta);
    }

    pub fn contiene(&self, ventana: &str, ruta: &Path) -> bool {
        self.0.lock().unwrap().get(ventana).is_some_and(|rutas| rutas.contains(ruta))
    }

    pub fn cerrar(&self, ventana: &str) {
        self.0.lock().unwrap().remove(ventana);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dos_llegadas_y_sus_avisos_se_aislan_por_ventana() {
        let abiertos = Abiertos::default();
        let guardados = Guardados::default();
        let a = PathBuf::from("A/original.pdf");
        let b = PathBuf::from("B/original.pdf");
        abiertos.anotar("primera", Some("unir".into()), vec![a.clone()]);
        let turno = abiertos.generacion("primera");
        abiertos.anotar("segunda", Some("firmar".into()), vec![b.clone()]);
        assert_eq!(abiertos.generacion("primera"), turno);
        assert!(abiertos.recoger("primera", Instant::now()).is_empty());
        let listas = Instant::now() + AVISO_TRAS;
        for (ventana, origen, ajeno) in [("primera", &a, &b), ("segunda", &b, &a)] {
            assert_eq!(abiertos.recoger(ventana, listas)[0].rutas, [origen.clone()]);
            assert!(abiertos.recoger(ventana, listas).is_empty());
            abiertos.origenes.lock().unwrap().entry(ventana.into()).or_default().insert(origen.clone());
            assert_eq!(abiertos.carpeta_del_original(ventana, origen), origen.parent().map(Path::to_owned));
            assert_eq!(abiertos.carpeta_del_original(ventana, ajeno), None);
            guardados.anotar(ventana, origen.clone());
            assert!(guardados.contiene(ventana, origen));
            assert!(!guardados.contiene(ventana, ajeno));
            abiertos.cerrar(ventana);
            guardados.cerrar(ventana);
            assert!(!guardados.contiene(ventana, origen));
        }
    }
}
