//! Copiar un secreto de la bóveda sin que se quede en el portapapeles.
//!
//! Desde la página no se puede: `navigator.clipboard` sólo pone texto, y lo copiado
//! entra en el historial de Windows (Win+V) y puede subir a la nube. Y borrarlo
//! después tampoco, porque pide que la ventana tenga el foco, y al pegar la
//! contraseña en otro programa no lo tiene.
//!
//! Es lo único de la bóveda que pasa por Rust ya descifrado, y sólo en memoria.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;
use std::time::Duration;

use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalFree, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

/// Lo que dura en el portapapeles. La página lo dice en su aviso.
const BORRAR_TRAS: Duration = Duration::from_secs(30);

/// Los formatos con los que Windows deja el contenido fuera del historial y de la
/// nube, y fuera de los programas que vigilan el portapapeles. Son los mismos que
/// usan los gestores de contraseñas.
const EXCLUSIONES: [&str; 3] =
    ["ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard"];

/// El número de secuencia de lo último copiado, para vaciarlo al salir.
static ULTIMA_COPIA: AtomicU32 = AtomicU32::new(0);

/// Lo pone en el portapapeles y programa su borrado. Si algo falla a mitad, lo deja
/// vacío: mejor sin copiar que copiado sin las exclusiones.
///
/// `dueno` es la ventana: con `OpenClipboard(NULL)`, `EmptyClipboard` deja el
/// portapapeles sin dueño y `SetClipboardData` falla.
pub fn copiar_protegido(dueno: *mut c_void, texto: &str) -> Result<(), String> {
    let mut bytes: Vec<u8> = texto.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
    let resultado = escribir(dueno, &bytes);
    bytes.fill(0);
    resultado?;

    // Después de cerrarlo: cada cambio sube el número, y hasta aquí no ha acabado.
    let numero = unsafe { GetClipboardSequenceNumber() };
    ULTIMA_COPIA.store(numero, Ordering::SeqCst);
    thread::spawn(move || {
        thread::sleep(BORRAR_TRAS);
        vaciar_si_es(numero);
    });
    Ok(())
}

/// Al salir de la aplicación: el hilo del borrado muere con ella, y cerrarla en esos
/// 30 segundos dejaría la contraseña copiada. Un cierre forzado no llega hasta aquí.
pub fn vaciar_si_sigue() {
    let numero = ULTIMA_COPIA.swap(0, Ordering::SeqCst);
    if numero != 0 {
        vaciar_si_es(numero);
    }
}

/// Sólo si sigue siendo lo nuestro: si se ha copiado otra cosa, no se toca.
fn vaciar_si_es(numero: u32) {
    if unsafe { GetClipboardSequenceNumber() } != numero {
        return;
    }
    if let Ok(_abierto) = abrir(ptr::null_mut()) {
        unsafe { EmptyClipboard() };
    }
}

fn escribir(dueno: *mut c_void, texto: &[u8]) -> Result<(), String> {
    let _abierto = abrir(dueno)?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("No se ha podido vaciar el portapapeles.".into());
    }
    let resultado = poner_todo(texto);
    if resultado.is_err() {
        unsafe { EmptyClipboard() };
    }
    resultado
}

fn poner_todo(texto: &[u8]) -> Result<(), String> {
    poner(CF_UNICODETEXT as u32, texto)?;
    // Un 0 de 32 bits es lo que piden los dos `Can…`; al primero le vale cualquier cosa.
    for nombre in EXCLUSIONES {
        poner(formato(nombre)?, &0u32.to_le_bytes())?;
    }
    Ok(())
}

fn formato(nombre: &str) -> Result<u32, String> {
    let ancho: Vec<u16> = nombre.encode_utf16().chain(std::iter::once(0)).collect();
    match unsafe { RegisterClipboardFormatW(ancho.as_ptr()) } {
        0 => Err(format!("No se ha podido registrar el formato {nombre}.")),
        numero => Ok(numero),
    }
}

/// `SetClipboardData` se queda con la memoria si sale bien; si no, sigue siendo nuestra.
fn poner(formato: u32, bytes: &[u8]) -> Result<(), String> {
    unsafe {
        let memoria = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
        if memoria.is_null() {
            return Err("No hay memoria para copiar.".into());
        }
        let destino = GlobalLock(memoria) as *mut u8;
        if destino.is_null() {
            GlobalFree(memoria);
            return Err("No hay memoria para copiar.".into());
        }
        ptr::copy_nonoverlapping(bytes.as_ptr(), destino, bytes.len());
        GlobalUnlock(memoria);
        if SetClipboardData(formato, memoria).is_null() {
            GlobalFree(memoria);
            return Err("No se ha podido copiar.".into());
        }
    }
    Ok(())
}

/// El portapapeles abierto, que se cierra solo al salir de donde se usa.
struct Abierto;

impl Drop for Abierto {
    fn drop(&mut self) {
        unsafe { CloseClipboard() };
    }
}

/// Con reintentos: otro programa puede tenerlo abierto en este momento, y es lo normal.
fn abrir(dueno: *mut c_void) -> Result<Abierto, String> {
    for _ in 0..20 {
        if unsafe { OpenClipboard(dueno) } != 0 {
            return Ok(Abierto);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err("Otro programa está usando el portapapeles. Vuelve a intentarlo.".into())
}
