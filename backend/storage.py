"""Almacenamiento temporal de archivos, aislado por sesión y con caducidad.

Cada sesión es una carpeta bajo UPLOAD_ROOT nombrada con un identificador que
genera el cliente. Dentro conviven, por cada archivo, el binario ``<id><ext>`` y
un sidecar ``<id>.json`` con sus metadatos (nombre original, tamaño, origen).

Los identificadores se validan contra una expresión regular estricta antes de
tocar el sistema de archivos, así que ningún valor recibido del cliente puede
salirse de su carpeta.
"""
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, asdict
from pathlib import Path

import config
import contenido
from errors import ApiError

# Un identificador válido es exactamente un uuid4 en hexadecimal sin guiones.
ID_RE = re.compile(r'^[0-9a-f]{32}$')

# Caracteres de control y separadores de ruta: fuera de cualquier nombre.
PELIGROSOS_RE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')

LONGITUD_MAXIMA_NOMBRE = 120


def nombre_seguro(nombre: str) -> str:
    """Limpia un nombre de archivo conservando tildes y eñes.

    No se usa ``secure_filename`` de Werkzeug porque destruye los nombres en
    español ("año.pdf" acabaría como "ao.pdf"). Aquí no hace falta su dureza: el
    nombre nunca toca el disco, sólo se guarda como metadato y se devuelve en la
    descarga; en disco se usa el UUID, con un nombre separado para el contenido JSON.
    """
    limpio = PELIGROSOS_RE.sub('', os.path.basename(nombre or '')).strip().strip('.')
    if len(limpio) > LONGITUD_MAXIMA_NOMBRE:
        raiz, ext = os.path.splitext(limpio)
        limpio = raiz[: LONGITUD_MAXIMA_NOMBRE - len(ext)] + ext
    return limpio or 'archivo'


def cambiar_extension(nombre: str, extension: str) -> str:
    """"foto.png" + ".webp" -> "foto.webp"."""
    return os.path.splitext(nombre_seguro(nombre))[0] + extension


@dataclass
class FileRecord:
    """Metadatos de un archivo guardado en una sesión."""
    id: str
    name: str          # nombre original, el que ve el usuario
    stored_name: str   # <id><ext>; JSON usa <id>.contenido.json para no pisar el sidecar
    size: int
    ext: str           # extensión en minúsculas, con punto
    generated: bool    # True si lo produjo una herramienta, False si lo subió el usuario

    def to_json(self) -> dict:
        return {'id': self.id, 'name': self.name, 'size': self.size, 'generated': self.generated}


def new_id() -> str:
    return uuid.uuid4().hex


def validate_session_id(session_id: str | None) -> str:
    if not session_id or not ID_RE.fullmatch(session_id):
        raise ApiError('Sesión no válida. Recarga la página e inténtalo de nuevo.', 400)
    return session_id


class Storage:
    """Punto único de acceso al disco. Las herramientas nunca abren rutas a mano."""

    def __init__(self, root: str, ttl_seconds: int):
        self.root = os.path.abspath(root)
        self.ttl_seconds = ttl_seconds
        os.makedirs(self.root, exist_ok=True)

    # --- rutas ------------------------------------------------------------

    def session_dir(self, session_id: str, create: bool = True) -> str:
        validate_session_id(session_id)
        path = os.path.join(self.root, session_id)
        if create:
            os.makedirs(path, exist_ok=True)
        return path

    def path_of(self, session_id: str, file_id: str) -> str:
        """Ruta en disco de un archivo, comprobando que existe."""
        return self._require(session_id, file_id)[1]

    def record_of(self, session_id: str, file_id: str) -> FileRecord:
        return self._require(session_id, file_id)[0]

    def _require(self, session_id: str, file_id: str) -> tuple[FileRecord, str]:
        record = self._leer_meta(session_id, file_id)
        binary_path = os.path.join(self.session_dir(session_id, create=False), record.stored_name)
        if not os.path.isfile(binary_path):
            raise ApiError('El archivo ya no está disponible. Vuelve a subirlo.', 404)
        return record, binary_path

    def _leer_meta(self, session_id: str, file_id: str) -> FileRecord:
        if not ID_RE.fullmatch(file_id or ''):
            raise ApiError('Identificador de archivo no válido.', 400)
        carpeta = self.session_dir(session_id, create=False)
        try:
            with open(os.path.join(carpeta, f'{file_id}.json'), encoding='utf-8') as fichero:
                return FileRecord(**json.load(fichero))
        except FileNotFoundError:
            raise ApiError('El archivo ya no está disponible. Vuelve a subirlo.', 404) from None

    # --- espacio ----------------------------------------------------------

    def tamano_sesion(self, session_id: str) -> int:
        """Lo que ocupa una sesión, contando subidas y resultados."""
        path = self.session_dir(session_id, create=False)
        total = 0
        try:
            with os.scandir(path) as entradas:
                for entrada in entradas:
                    try:
                        if entrada.is_file():
                            total += entrada.stat().st_size
                    except FileNotFoundError:
                        # Puede publicarse un temporal o borrarse un archivo durante el recuento.
                        continue
        except FileNotFoundError:
            return 0
        return total

    def caducidad(self, session_id: str) -> float | None:
        """Desde cuándo la sesión se puede borrar, si nadie la toca antes.

        Es la misma cuenta que hace `purge_expired`: la fecha de la carpeta más
        el tiempo de vida. El borrado de verdad llega con la siguiente pasada
        del recolector. Sin carpeta no hay nada que borrar.
        """
        try:
            return os.path.getmtime(self.session_dir(session_id, create=False)) + self.ttl_seconds
        except FileNotFoundError:
            return None

    def espacio_libre(self) -> int:
        """Bytes libres en el disco donde vive el volumen."""
        return shutil.disk_usage(self.root).free

    def _comprobar_cuota(self, session_id: str, nuevos: int) -> None:
        """Que la sesión no se pase de lo suyo."""
        tope = config.SESSION_QUOTA_MB * 1024 * 1024
        usado = self.tamano_sesion(session_id)
        if usado + nuevos > tope:
            raise ApiError(
                f'Tus archivos de esta sesión ocupan ya {usado / 1024 / 1024:.0f} MB '
                f'y el máximo son {config.SESSION_QUOTA_MB} MB. Borra lo que no '
                'necesites con "Empezar de cero" y vuelve a intentarlo.', 413)

    def _comprobar_disco(self, session_id: str, necesarios: int) -> None:
        """Que quede sitio en el disco, desalojando sesiones viejas si hace falta.

        La reserva no es para esta aplicación: el volumen comparte disco con
        todo lo demás de la máquina, y llenarlo se lleva por delante a los
        vecinos.
        """
        reserva = config.DISK_RESERVE_MB * 1024 * 1024
        if self.espacio_libre() - necesarios >= reserva:
            return
        self.liberar_espacio(reserva + necesarios - self.espacio_libre(), excepto=session_id)
        if self.espacio_libre() - necesarios < reserva:
            raise ApiError('El servidor se ha quedado sin espacio. Inténtalo más tarde.', 507)

    def resumen(self) -> tuple[int, int]:
        """Lo que ocupan todas las sesiones juntas, y cuántas hay."""
        sesiones = list(self._directorios_sesion())
        return sum(_tamano_arbol(path) for path in sesiones), len(sesiones)

    def _directorios_sesion(self):
        try:
            with os.scandir(self.root) as entradas:
                for entrada in entradas:
                    if ID_RE.fullmatch(entrada.name) and entrada.is_dir(follow_symlinks=False):
                        yield entrada.path
        except FileNotFoundError:
            return

    def liberar_espacio(self, necesarios: float, excepto: str | None = None) -> int:
        """Desaloja sesiones, de la más vieja a la más nueva, hasta tener sitio.

        Nunca toca las que han tenido actividad reciente: puede que alguien esté
        a mitad de un trabajo. Tampoco `excepto`, la de quien lo pide. Si con las
        viejas no llega, se queda como esté y quien pidió el sitio recibe el
        error.
        """
        protegidas = time.time() - config.SESION_PROTEGIDA_SEGUNDOS
        candidatas = []
        for path in self._directorios_sesion():
            if os.path.basename(path) == excepto:
                continue
            try:
                visto = os.path.getmtime(path)
            except OSError:
                continue
            if visto < protegidas:
                candidatas.append((visto, path))

        liberados = 0
        for _, path in sorted(candidatas):
            if liberados >= necesarios:
                break
            tamano = _tamano_arbol(path)
            try:
                self._vaciar_carpeta(path)
            except OSError:
                continue
            liberados += tamano
        return liberados

    # --- escritura --------------------------------------------------------

    def save_upload(self, session_id: str, file_storage, allowed_exts: set[str] | None = None,
                    descripcion: str | None = None) -> FileRecord:
        """Guarda un archivo recibido en un formulario multipart.

        `descripcion` es lo que se le enseña a quien sube algo que no se admite:
        la lista cruda pasa de ochenta extensiones y no hay quien la lea.
        """
        original = nombre_seguro(file_storage.filename or '')
        ext = os.path.splitext(original)[1].lower()
        if allowed_exts is not None and ext not in allowed_exts:
            permitidas = descripcion or ', '.join(sorted(allowed_exts))
            raise ApiError(f'"{original}": formato no admitido. Se aceptan {permitidas}.', 400)

        # Lo que dice el navegador que va a mandar, que puede no venir. El tope
        # de la petición completa (`MAX_CONTENT_LENGTH`) ya acota lo que puede
        # llegar a escribirse antes de la comprobación de verdad, la de abajo.
        anunciado = getattr(file_storage, 'content_length', 0) or 0
        self._comprobar_cuota(session_id, anunciado)
        self._comprobar_disco(session_id, anunciado or 1)

        file_id = new_id()
        stored_name = f'{file_id}.contenido.json' if ext == '.json' else f'{file_id}{ext}'
        target = os.path.join(self.session_dir(session_id), stored_name)
        file_storage.save(target)

        # Lo que dice ser por la extensión, ¿lo es por dentro? Se mira ahora y no
        # en cada herramienta: así el aviso llega al subirlo, no tres pantallas
        # después con un «no se ha podido abrir».
        try:
            contenido.comprobar(target, original, ext)
        except ApiError:
            os.unlink(target)
            raise

        # Ahora sí se sabe lo que pesa: el navegador no siempre anuncia el
        # tamaño. Si se pasa, se deshace la subida, que es mejor que dejar la
        # sesión por encima de su cuota.
        escrito = os.path.getsize(target)
        if self.tamano_sesion(session_id) > config.SESSION_QUOTA_MB * 1024 * 1024:
            os.unlink(target)
            raise ApiError(
                f'"{original}" no cabe: con él, tus archivos de esta sesión pasarían '
                f'de los {config.SESSION_QUOTA_MB} MB. Borra lo que no necesites con '
                '"Empezar de cero".', 413)

        return self._write_meta(session_id, FileRecord(
            id=file_id,
            name=original,
            stored_name=stored_name,
            size=escrito,
            ext=ext,
            generated=False,
        ))

    def reserve_output(self, session_id: str, name: str) -> tuple[str, FileRecord]:
        """Reserva una ruta para el resultado de una herramienta.

        Devuelve la ruta donde escribir y el registro, todavía sin tamaño. Hay
        que llamar a ``commit_output`` cuando el archivo esté escrito.
        """
        # No se sabe lo que va a pesar el resultado, así que lo que se comprueba
        # aquí es que quede sitio; la cuota se comprueba al confirmarlo, cuando
        # ya tiene tamaño.
        self._comprobar_disco(session_id, 1)

        file_id = new_id()
        name = nombre_seguro(name)
        ext = os.path.splitext(name)[1].lower()
        stored_name = f'{file_id}.contenido.json' if ext == '.json' else f'{file_id}{ext}'
        path = os.path.join(self.session_dir(session_id), stored_name)
        record = FileRecord(id=file_id, name=name, stored_name=stored_name, size=0, ext=ext, generated=True)
        return path, record

    @contextmanager
    def lote_salidas(self, session_id: str):
        """Descarta las salidas reservadas por este lote si falla antes de terminar."""
        with ExitStack() as pendientes:
            def reservar(nombre: str):
                ruta, registro = self.reserve_output(session_id, nombre)
                pendientes.callback(self.descartar, session_id, registro)
                return ruta, registro

            yield reservar
            pendientes.pop_all()

    def commit_output(self, session_id: str, record: FileRecord) -> FileRecord:
        path = os.path.join(self.session_dir(session_id), record.stored_name)
        if not os.path.isfile(path):
            raise ApiError('La herramienta no generó ningún resultado.', 500)
        record.size = os.path.getsize(path)
        tope = config.SESSION_QUOTA_MB * 1024 * 1024
        if self.tamano_sesion(session_id) > tope:
            # El resultado ya está escrito: se borra y se avisa, en vez de dejar
            # la sesión pasada de cuota.
            os.unlink(path)
            raise ApiError(
                f'El resultado no cabe: tus archivos de esta sesión pasarían de '
                f'los {config.SESSION_QUOTA_MB} MB. Borra lo que no necesites con '
                '"Empezar de cero".', 413)
        return self._write_meta(session_id, record)

    def descartar(self, session_id: str, record: FileRecord) -> None:
        """Quita un resultado reservado o ya confirmado, como si no hubiera existido.

        Para una herramienta que produce varios archivos en una petición: si
        falla el tercero, los dos primeros no se le devuelven a nadie y sólo
        ocuparían cuota. Se puede llamar aunque no se llegara a escribir nada.
        """
        carpeta = self.session_dir(session_id, create=False)
        for nombre in (record.stored_name, f'{record.id}.json'):
            try:
                os.unlink(os.path.join(carpeta, nombre))
            except FileNotFoundError:
                pass

    def rename(self, session_id: str, file_id: str, nombre: str) -> FileRecord:
        """Cambia el nombre con el que se descargará un archivo.

        El binario del disco no se toca —siempre se llama ``<id><ext>``—: sólo
        cambia el metadato que se usa al descargar y al armar un ZIP. La
        extensión se conserva, porque la decide la herramienta que generó el
        archivo y cambiarla sólo serviría para engañar a quien lo abra.
        """
        record = self.record_of(session_id, file_id)
        record.name = cambiar_extension(nombre, record.ext)
        return self._write_meta(session_id, record)

    def _write_meta(self, session_id: str, record: FileRecord) -> FileRecord:
        carpeta = self.session_dir(session_id, create=False)
        temporal = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=carpeta, suffix='.tmp',
                                             encoding='utf-8', delete=False) as fichero:
                temporal = Path(fichero.name)
                json.dump(asdict(record), fichero)
            os.replace(temporal, os.path.join(carpeta, f'{record.id}.json'))
        finally:
            if temporal is not None:
                temporal.unlink(missing_ok=True)
        return record

    # --- borrado ----------------------------------------------------------

    def touch_session(self, session_id: str) -> None:
        """Marca la sesión como activa.

        La limpieza mira la fecha de la carpeta, y el visor trabaja en el
        navegador: se puede pasar horas leyendo sin una sola llamada a la API.
        Sin esto, al ir a guardar los archivos ya no estarían.
        """
        path = self.session_dir(session_id, create=True)
        os.utime(path, None)

    def delete_file(self, session_id: str, file_id: str) -> None:
        # Si sólo queda el sidecar tras un borrado parcial, permite reintentarlo.
        record = self._leer_meta(session_id, file_id)
        self.descartar(session_id, record)

    @staticmethod
    def _vaciar_carpeta(path: str) -> None:
        carpeta = Path(path)
        if carpeta.is_symlink():
            raise OSError('La carpeta de sesión es un enlace.')
        try:
            entradas = list(carpeta.iterdir())
        except FileNotFoundError:
            return
        # Un binario ocupado debe conservar el metadato que permite localizarlo.
        # Los archivos .contenido.json de los usuarios también van primero.
        def es_metadato(entrada):
            return entrada.suffix == '.json' and ID_RE.fullmatch(entrada.stem) is not None

        for entrada in sorted(entradas, key=es_metadato):
            if not entrada.is_symlink() and entrada.is_dir():
                shutil.rmtree(entrada)
            else:
                entrada.unlink(missing_ok=True)
        try:
            carpeta.rmdir()
        except FileNotFoundError:
            pass

    def clear_session(self, session_id: str) -> None:
        self._vaciar_carpeta(self.session_dir(session_id, create=False))

    def purge_expired(self) -> int:
        """Borra las sesiones sin actividad desde hace más de su tiempo de vida."""
        limite = time.time() - self.ttl_seconds
        borradas = 0
        for path in self._directorios_sesion():
            try:
                if os.path.getmtime(path) < limite:
                    self._vaciar_carpeta(path)
                    borradas += 1
            except OSError:
                continue
        return borradas


def _tamano_arbol(path: str) -> int:
    """Lo que ocupa una carpeta de sesión, para saber cuánto se libera al borrarla."""
    total = 0
    for raiz, _, ficheros in os.walk(path):
        for fichero in ficheros:
            try:
                total += os.path.getsize(os.path.join(raiz, fichero))
            except OSError:
                continue
    return total


def start_cleanup_thread(storage: Storage, interval: int, logger) -> None:
    """Lanza el recolector periódico de sesiones caducadas en segundo plano."""

    def loop():
        while True:
            try:
                borradas = storage.purge_expired()
                if borradas:
                    logger.info('Limpieza: %d sesiones caducadas eliminadas.', borradas)
            except Exception:  # el hilo nunca debe morir
                logger.exception('Fallo en la limpieza de sesiones.')
            time.sleep(interval)

    storage.purge_expired()
    threading.Thread(target=loop, daemon=True, name='storage-cleanup').start()


# Instancia compartida por toda la aplicación.
storage = Storage(config.UPLOAD_ROOT, config.SESSION_TTL_SECONDS)
