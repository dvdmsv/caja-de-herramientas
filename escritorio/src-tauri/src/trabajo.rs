//! El *job object* de Windows en el que va el backend, y con él todo lo que
//! lance: LibreOffice, ocrmypdf, Ghostscript…
//!
//! Hace en Windows lo que en la web hacen los límites de cada proceso
//! (`gunicorn.trabajos.conf.py`), que aquí no existen:
//!
//! - **Muere con la aplicación**, aunque se la cierre de golpe.
//! - **Prioridad por debajo de lo normal.** El OCR usa todos los núcleos; así
//!   sigue usando toda la CPU libre pero cede en cuanto el usuario hace otra
//!   cosa, y el equipo no va a tirones mientras dura. Es lo que hacen los
//!   compresores y los antivirus.
//! - **Un tope de memoria para el conjunto.** Sin él, un documento muy pesado
//!   podía comerse la RAM entera y dejar el equipo paginando al disco. Con él,
//!   Windows le deniega la memoria al que se pasa, y el backend lo traduce a un
//!   mensaje (`limites.es_falta_de_memoria`, `conversion.murio_por_fallo`).
//!
//! Se hace con `windows-sys` y no con `win32job`, que no expone el tope de
//! memoria del job: su límite de *working set* sólo hace que Windows pagine
//! antes, no impide comerse la RAM.

use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_JOB_MEMORY,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PRIORITY_CLASS,
};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::BELOW_NORMAL_PRIORITY_CLASS;

/// Qué parte de la RAM del equipo puede usar el backend con todo lo que lance.
/// El resto es para Windows y para lo que el usuario tenga abierto.
const PARTE_DE_LA_RAM: f64 = 0.60;

/// Por debajo de esto no se baja aunque el equipo tenga poca RAM: LibreOffice
/// solo necesita unos 384 MB (medido con `ulimit -d`), pdf2docx 768, y el
/// backend en reposo ronda los 300. Con menos, fallaría lo normal y no sólo lo
/// desmesurado.
const MINIMO_MB: u64 = 1536;

/// El job. Al soltarse cierra su handle y Windows mata todo lo que hay dentro.
pub struct Trabajo(HANDLE);

// El handle de un job se puede usar desde cualquier hilo.
unsafe impl Send for Trabajo {}
unsafe impl Sync for Trabajo {}

impl Drop for Trabajo {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// El tope en bytes: `CAJA_TOPE_MEMORIA_MB` si está (0 = sin tope, para
/// medir), o el 60 % de la RAM con un mínimo.
pub fn tope_de_memoria() -> Option<u64> {
    if let Some(megas) = std::env::var("CAJA_TOPE_MEMORIA_MB")
        .ok()
        .and_then(|valor| valor.trim().parse::<u64>().ok())
    {
        return (megas > 0).then_some(megas * 1024 * 1024);
    }
    let total = memoria_total()?;
    let parte = (total as f64 * PARTE_DE_LA_RAM) as u64;
    Some(parte.max(MINIMO_MB * 1024 * 1024).min(total))
}

fn memoria_total() -> Option<u64> {
    let mut estado: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    estado.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let bien = unsafe { GlobalMemoryStatusEx(&mut estado) };
    (bien != 0).then_some(estado.ullTotalPhys)
}

/// Mete el proceso en un job nuevo con los tres límites.
pub fn atar(hijo: &Child, tope: Option<u64>) -> Result<Trabajo, String> {
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(format!("CreateJobObjectW: {}", std::io::Error::last_os_error()));
        }
        let trabajo = Trabajo(handle);

        let mut limites: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limites.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PRIORITY_CLASS;
        limites.BasicLimitInformation.PriorityClass = BELOW_NORMAL_PRIORITY_CLASS;
        if let Some(bytes) = tope {
            limites.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
            limites.JobMemoryLimit = bytes as usize;
        }
        let puesto = SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &limites as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if puesto == 0 {
            return Err(format!("SetInformationJobObject: {}", std::io::Error::last_os_error()));
        }
        if AssignProcessToJobObject(handle, hijo.as_raw_handle() as HANDLE) == 0 {
            return Err(format!("AssignProcessToJobObject: {}", std::io::Error::last_os_error()));
        }
        Ok(trabajo)
    }
}
