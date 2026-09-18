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
import threading
import time
import uuid
from dataclasses import dataclass, asdict

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
    descarga; en disco todo se llama ``<uuid><ext>``.
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
    stored_name: str   # nombre en disco, siempre <id><ext>
    size: int
    ext: str           # extensión en minúsculas, con punto
    generated: bool    # True si lo produjo una herramienta, False si lo subió el usuario

    def to_json(self) -> dict:
        return {'id': self.id, 'name': self.name, 'size': self.size, 'generated': self.generated}


def new_id() -> str:
    return uuid.uuid4().hex


def validate_session_id(session_id: str | None) -> str:
    if not session_id or not ID_RE.match(session_id):
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
        if not ID_RE.match(file_id or ''):
            raise ApiError('Identificador de archivo no válido.', 400)
        meta_path = os.path.join(self.session_dir(session_id, create=False), f'{file_id}.json')
        if not os.path.isfile(meta_path):
            raise ApiError('El archivo ya no está disponible. Vuelve a subirlo.', 404)
        with open(meta_path, 'r', encoding='utf-8') as fh:
            record = FileRecord(**json.load(fh))
        binary_path = os.path.join(os.path.dirname(meta_path), record.stored_name)
        if not os.path.isfile(binary_path):
            raise ApiError('El archivo ya no está disponible. Vuelve a subirlo.', 404)
        return record, binary_path

    # --- espacio ----------------------------------------------------------

    def tamano_sesion(self, session_id: str) -> int:
        """Lo que ocupa una sesión, contando subidas y resultados."""
        path = self.session_dir(session_id, create=False)
        total = 0
        try:
            with os.scandir(path) as entradas:
                for entrada in entradas:
                    if entrada.is_file():
                        total += entrada.stat().st_size
        except FileNotFoundError:
            return 0
        return total

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

    def _comprobar_disco(self, necesarios: int) -> None:
        """Que quede sitio en el disco, desalojando sesiones viejas si hace falta.

        La reserva no es para esta aplicación: el volumen comparte disco con
        todo lo demás de la máquina, y llenarlo se lleva por delante a los
        vecinos.
        """
        reserva = config.DISK_RESERVE_MB * 1024 * 1024
        if self.espacio_libre() - necesarios >= reserva:
            return
        self.liberar_espacio(reserva + necesarios - self.espacio_libre())
        if self.espacio_libre() - necesarios < reserva:
            raise ApiError('El servidor se ha quedado sin espacio. Inténtalo más tarde.', 507)

    def liberar_espacio(self, necesarios: int) -> int:
        """Desaloja sesiones, de la más vieja a la más nueva, hasta tener sitio.

        Nunca toca las que han tenido actividad reciente: puede que alguien esté
        a mitad de un trabajo. Si con las viejas no llega, se queda como esté y
        quien pidió el sitio recibe el error.
        """
        protegidas = time.time() - config.SESION_PROTEGIDA_SEGUNDOS
        candidatas = []
        try:
            nombres = os.listdir(self.root)
        except FileNotFoundError:
            return 0
        for nombre in nombres:
            path = os.path.join(self.root, nombre)
            if not os.path.isdir(path):
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
            liberados += _tamano_arbol(path)
            shutil.rmtree(path, ignore_errors=True)
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
        self._comprobar_disco(anunciado or 1)

        file_id = new_id()
        stored_name = f'{file_id}{ext}'
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
        self._comprobar_disco(1)

        file_id = new_id()
        name = nombre_seguro(name)
        ext = os.path.splitext(name)[1].lower()
        stored_name = f'{file_id}{ext}'
        path = os.path.join(self.session_dir(session_id), stored_name)
        record = FileRecord(id=file_id, name=name, stored_name=stored_name, size=0, ext=ext, generated=True)
        return path, record

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
        meta_path = os.path.join(self.session_dir(session_id), f'{record.id}.json')
        with open(meta_path, 'w', encoding='utf-8') as fh:
            json.dump(asdict(record), fh)
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

    def clear_session(self, session_id: str) -> None:
        path = self.session_dir(session_id, create=False)
        shutil.rmtree(path, ignore_errors=True)

    def purge_expired(self) -> int:
        """Borra las sesiones sin actividad desde hace más de ``ttl_seconds``."""
        limite = time.time() - self.ttl_seconds
        borradas = 0
        try:
            nombres = os.listdir(self.root)
        except FileNotFoundError:
            return 0
        for nombre in nombres:
            path = os.path.join(self.root, nombre)
            if not os.path.isdir(path):
                continue
            try:
                if os.path.getmtime(path) < limite:
                    shutil.rmtree(path, ignore_errors=True)
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
