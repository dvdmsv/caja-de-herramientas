"""Topes que protegen la máquina de un solo trabajo.

Existen porque el tamaño del archivo que llega no dice lo que va a costar
procesarlo: un PDF de 200 kB puede tener una página de dos metros que a 300 ppp
son 800 megapíxeles, y un `.docx` de 2 MB puede traer 2 GB dentro. El tope de
subida no ve nada de eso.

Es la capa amable. Debajo hay otra que no negocia: en producción cada petición
corre en un proceso con `RLIMIT_DATA` y `RLIMIT_CPU` (ver
`gunicorn.trabajos.conf.py`), y ahí el trabajo muere sin más. Estas
comprobaciones existen para llegar antes y poder explicar qué ha pasado.
"""
import errno
import functools
import os
import re
import signal
import threading
import zipfile

import config
from errors import ApiError

# Megapíxeles máximos de una sola imagen o página rasterizada. 40 MP son unos
# 160 MB en memoria a cuatro bytes por píxel, y de sobra para una A4 a 600 ppp
# (35 MP). Lo que corta de verdad son las páginas de tamaño cartel.
MEGAPIXELES_MAXIMOS = config.entorno_entero('MAX_IMAGE_MEGAPIXELS', 40)

# Cuánto puede ocupar descomprimido un documento que por dentro es un ZIP
# (.docx, .xlsx, .pptx, .epub). Un archivo pequeño con un ratio absurdo es la
# forma más barata de llenar la memoria de otro.
MAXIMO_DESCOMPRIMIDO_MB = config.entorno_entero('MAX_UNZIPPED_MB', 400)

# Extensiones que son un ZIP por dentro.
EXTENSIONES_COMPRIMIDAS = {'.docx', '.xlsx', '.pptx', '.epub', '.odt', '.ods', '.odp'}


def comprobar_lienzo(ancho_px: float, alto_px: float, que: str = 'La imagen') -> None:
    """Corta antes de rasterizar algo que no cabe en memoria.

    Se mide en megapíxeles y no en bytes porque es lo que se puede saber **antes**
    de pedir la memoria. El mensaje dice las medidas y el tope: sin eso, quien lo
    ve no sabe si el problema es su archivo o el servidor.
    """
    megapixeles = (ancho_px * alto_px) / 1_000_000
    if megapixeles > MEGAPIXELES_MAXIMOS:
        raise ApiError(
            f'{que} mide {int(ancho_px)}×{int(alto_px)} píxeles '
            f'({megapixeles:.0f} megapíxeles) y el máximo son {MEGAPIXELES_MAXIMOS}. '
            'Prueba con menos resolución o con un documento de páginas más pequeñas.',
            413)


def comprobar_descomprimido(ruta: str, nombre: str) -> None:
    """Mira lo que un documento comprimido pesa **por dentro** antes de abrirlo.

    Sólo lee el índice del ZIP, que va al final del archivo: no descomprime nada.
    """
    if os.path.splitext(nombre)[1].lower() not in EXTENSIONES_COMPRIMIDAS:
        return
    tope = MAXIMO_DESCOMPRIMIDO_MB * 1024 * 1024
    try:
        with zipfile.ZipFile(ruta) as paquete:
            total = sum(dato.file_size for dato in paquete.infolist())
    except (zipfile.BadZipFile, OSError):
        # No es un ZIP válido, o no se puede leer: que lo diga la herramienta que
        # lo abra, con su propio mensaje.
        return
    if total > tope:
        raise ApiError(
            f'«{nombre}» ocupa {total / 1024 / 1024:.0f} MB descomprimido y el '
            f'máximo son {MAXIMO_DESCOMPRIMIDO_MB} MB.', 413)


class TiempoAgotado(BaseException):
    """Se acabó el plazo del trabajo.

    Hereda de `BaseException` y no de `Exception` **a propósito**: varias
    herramientas envuelven su trabajo en un `except Exception` para dar un error
    bonito ("no se ha podido abrir el PDF"), y ahí se comerían este aviso y lo
    convertirían en otra cosa. Así atraviesa esos `except` y llega al decorador,
    que es quien lo traduce a una respuesta 504.
    """


class _Plazo:
    """Contexto que corta un trabajo hecho dentro del proceso.

    Los trabajos que se lanzan como programa aparte se cortan con el `timeout`
    de `subprocess` (ver `api/conversion.py`). Los que ocurren aquí dentro
    —rasterizar, maquetar con WeasyPrint, comprimir— no tenían nada, y hasta
    ahora el único freno era el plazo de gunicorn, que mata el worker entero.

    Se usa `setitimer`, que sólo funciona en el hilo principal. En producción lo
    es siempre: cada petición es un proceso `sync` recién forkeado. En
    desarrollo (`python app.py`, con hilos) no se puede armar y se sigue sin
    plazo, que es lo correcto: en desarrollo molesta más un corte que una espera.
    """

    def __init__(self, segundos: int, que: str):
        self.segundos = segundos
        self.que = que
        self.armado = False

    def __enter__(self):
        if self.segundos <= 0 or threading.current_thread() is not threading.main_thread():
            return self
        # Windows no tiene `SIGALRM`: ni se puede armar ni se llega a necesitar,
        # porque la aplicación de escritorio atiende con hilos y ya se habría
        # salido arriba. Está por si algún día se llama desde el hilo principal:
        # el `AttributeError` no lo recoge el `except` de abajo.
        if not hasattr(signal, 'SIGALRM'):
            return self
        try:
            signal.signal(signal.SIGALRM, self._salta)
            signal.setitimer(signal.ITIMER_REAL, self.segundos)
            self.armado = True
        except (ValueError, OSError):
            pass
        return self

    def __exit__(self, *_):
        if self.armado:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, signal.SIG_DFL)
        return False

    def _salta(self, *_):
        raise TiempoAgotado()

    def como_api_error(self) -> ApiError:
        from api.conversion import en_palabras
        return ApiError(
            f'{self.que} ha tardado más de {en_palabras(self.segundos)} y se ha '
            'cancelado. Prueba con un documento más corto o más simple.', 504)


def plazo(segundos: int, que: str) -> _Plazo:
    return _Plazo(segundos, que)


def con_plazo(segundos: int, que: str):
    """El plazo como decorador, para ponérselo a la ruta de una herramienta.

    Así se ve de un vistazo en la propia herramienta cuánto tiempo tiene, sin
    tocar su cuerpo ni su manejo de errores.
    """
    def envoltura(vista):
        @functools.wraps(vista)
        def dentro(*args, **kwargs):
            reloj = plazo(segundos, que)
            try:
                with reloj:
                    return vista(*args, **kwargs)
            except TiempoAgotado:
                raise reloj.como_api_error() from None
        return dentro
    return envoltura


# Cuánto puede llevar esperando una petición antes de que no valga la pena
# atenderla. Tiene que ser menor que el plazo de gunicorn: si se ha pasado tanto
# tiempo en la cola, quien la mandó casi seguro que ya no está.
EDAD_MAXIMA_PETICION = config.entorno_entero('REQUEST_MAX_AGE_SECONDS', 60)


# Plazo de las rutas auxiliares —las que acaban en `/inspeccionar` y que nginx
# manda al servicio `ligeros`—. No es configurable a propósito: sale del perfil
# de ese servicio, así que quien lo estreche o lo ensanche mueve las dos cosas a
# la vez y no pueden quedarse descolgadas.
#
# Por qué hace falta: una inspección recorre el documento entero, y con un PDF
# de mil páginas se pasaría de los segundos de CPU del trabajo. Sin plazo, el
# `RLIMIT_CPU` mata el proceso y nginx contesta un 503 genérico; con él, sale un
# 504 que dice qué ha pasado y qué hacer.
PLAZO_AUXILIAR = max(10, int(config.PERFILES_TRABAJO['ligeros']['cpu_segundos'] * 0.8))


def edad_peticion(cabecera: str | None, ahora: float) -> float | None:
    """Segundos que lleva la petición esperando, según la cabecera de nginx.

    Nginx manda `X-Request-Start` con `$msec`: segundos desde la época con
    milisegundos. Devuelve `None` si no viene o no se entiende —en desarrollo no
    hay nginx delante—, y nunca un número negativo: un reloj que se ajusta no
    debe hacer que se rechacen peticiones nuevas.
    """
    if not cabecera:
        return None
    try:
        inicio = float(cabecera.strip().lstrip('t='))
    except ValueError:
        return None
    return max(0.0, ahora - inicio)


# Cómo dicen «me he quedado sin memoria» las bibliotecas nativas. Ninguna lanza
# `MemoryError`: MuPDF lanza su propio error con «realloc (… bytes) failed», y
# Pillow y OpenCV tienen sus propias frases. Sin reconocerlas, un archivo
# demasiado grande sale como «error interno del servidor» y quien lo ve no sabe
# que basta con pedir menos resolución.
_SIN_MEMORIA = re.compile(
    r'realloc|malloc|out of memory|cannot allocate|unable to allocate|'
    r'insufficient memory|bad_alloc|memoryerror', re.IGNORECASE)


def es_falta_de_memoria(err: BaseException) -> bool:
    """Si este fallo es «no cabe en memoria», venga de Python o de una nativa."""
    if isinstance(err, MemoryError):
        return True
    return bool(_SIN_MEMORIA.search(str(err) or ''))


def es_disco_lleno(err: OSError) -> bool:
    """Si el sistema se ha quedado sin sitio o el archivo se ha pasado de tamaño."""
    return err.errno in (errno.EFBIG, errno.ENOSPC, errno.EDQUOT)
