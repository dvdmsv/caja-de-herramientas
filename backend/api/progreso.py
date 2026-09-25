"""Por dónde va un trabajo, y cómo pararlo.

El problema que resuelve no es de interfaz, es de arquitectura: el proceso que
trabaja **muere con la petición** (`gunicorn.trabajos.conf.py`, `max_requests=1`)
y quien atendería la pregunta «¿cómo vas?» ni siquiera es el mismo contenedor
—`/api/tools/` lo sirve `pesados` y `/api/` lo sirve `web`—. No hay memoria
compartida donde dejar el dato.

Lo que sí comparten los tres servicios es el volumen `uploads`, así que el canal
es un archivo diminuto en la carpeta de la sesión:

    uploads/<sesión>/.trabajos/<trabajo>.json        lo escribe quien trabaja
    uploads/<sesión>/.trabajos/<trabajo>.cancelar    lo escribe `web` al cancelar

El identificador del trabajo lo genera el navegador y lo manda en la cabecera
``X-Trabajo-Id``, igual que ya hace con la sesión. **Sin esa cabecera todo esto
es un no-op**: la herramienta funciona igual y no escribe nada, que es lo que
tiene que pasar con un cliente viejo o con el barrido.

Hay dos formas de contar:

- ``pasos``: se sabe cuántas iteraciones hay (páginas, archivos, marcas). El
  porcentaje es de verdad.
- ``estimado``: no hay pasos que contar porque el trabajo entero es una llamada
  a un programa externo (OCR, LibreOffice, pdf2docx). Aquí se escribe **una sola
  vez** cuánto se calcula que va a durar y es el navegador quien anima la barra.
  Así no hace falta dejar un hilo en el servidor tocando el archivo mientras el
  programa trabaja.
"""
import contextlib
import json
import os
import threading
import time

from flask import request

from errors import ApiError
from storage import ID_RE, storage, validate_session_id

CABECERA = 'X-Trabajo-Id'

# Dentro de la carpeta de la sesión, y con punto delante: lo que hay ahí no son
# archivos del usuario y no tiene que aparecer entre ellos.
CARPETA = '.trabajos'

# Cada cuánto se escribe, como mucho. Un documento de 2000 marcas no puede hacer
# 2000 escrituras para que una barra avance un píxel.
INTERVALO = 0.4

# La etapa la lee una persona en una línea; no es un log.
MAXIMO_ETAPA = 90


class Cancelado(ApiError):
    """Lo ha parado quien lo pidió. No es un fallo, así que no se cuenta como tal.

    409 y no 499: el 499 es un invento de nginx que no viaja como respuesta, y
    aquí el cliente ya sabe que ha cancelado porque lo ha pedido él.
    """

    def __init__(self):
        super().__init__('Trabajo cancelado.', 409)


# El trabajo en curso. Va en `threading.local` porque `python app.py` registra
# todo en un proceso con hilos y dos trabajos a la vez se pisarían el progreso;
# en producción cada petición es un proceso entero y da igual.
_local = threading.local()


class _Trabajo:
    def __init__(self, session_id: str, trabajo: str, etapa: str, cancelable: bool):
        self.session_id = session_id
        self.trabajo = trabajo
        self.etapa = etapa[:MAXIMO_ETAPA]
        self.cancelable = cancelable
        self.modo = 'pasos'
        self.hechos = 0
        self.total = 0
        self.estimado = 0.0
        self.desde = time.time()
        self.ultima = 0.0

    def como_json(self) -> dict:
        datos = {'modo': self.modo, 'etapa': self.etapa, 'desde': self.desde,
                 'cancelable': self.cancelable}
        if self.modo == 'pasos':
            datos['hechos'] = self.hechos
            datos['total'] = self.total
        else:
            datos['estimado'] = round(self.estimado, 1)
        return datos


# --- lo que usa quien trabaja ----------------------------------------------

def iniciar(etapa: str, total: int = 0, estimado: float = 0.0,
            cancelable: bool = True) -> None:
    """Empieza a contar. Sin cabecera de trabajo no hace nada."""
    trabajo = (request.headers.get(CABECERA) or '').strip() if request else ''
    if not ID_RE.match(trabajo):
        _local.trabajo = None
        return

    actual = _Trabajo(validate_session_id(request.headers.get('X-Session-Id')),
                      trabajo, etapa, cancelable)
    actual.modo = 'estimado' if estimado else 'pasos'
    actual.total = max(0, total)
    actual.estimado = max(0.0, estimado)
    _local.trabajo = actual
    _escribir(actual, forzar=True)


def fase(etapa: str, total: int = 0, estimado: float = 0.0,
         cancelable: bool | None = None) -> None:
    """Cambia de etapa dentro del mismo trabajo, reiniciando la cuenta.

    Comparar dos PDF, por ejemplo, alinea, rasteriza y maqueta: tres cosas que
    tardan y que no se parecen en nada.

    `cancelable=False` es para una etapa que es **una sola llamada** —maquetar
    con WeasyPrint, un `save()` de PyMuPDF—: ahí no hay entre paso y paso donde
    mirar la marca, así que más vale retirar el botón que dejarlo sin efecto.
    """
    actual = _actual()
    if not actual:
        return
    if cancelable is not None:
        actual.cancelable = cancelable
    actual.etapa = etapa[:MAXIMO_ETAPA]
    actual.modo = 'estimado' if estimado else 'pasos'
    actual.hechos = 0
    actual.total = max(0, total)
    actual.estimado = max(0.0, estimado)
    _escribir(actual, forzar=True)


def paso(cuantos: int = 1) -> None:
    """Un paso más, y de paso mira si han cancelado.

    Las dos cosas van a ritmos distintos a propósito: escribir tiene freno, pero
    la cancelación se mira **en cada paso**. Atarla al freno dejaría sin
    cancelar cualquier trabajo que quepa entre dos escrituras, y mirarla es un
    `stat` que cuesta menos que cualquier paso de cualquier herramienta.
    """
    actual = _actual()
    if not actual:
        return
    actual.hechos += cuantos
    _escribir(actual)
    comprobar_cancelacion()


def contando(iterable, total: int, etapa: str, cancelable: bool = True):
    """Envuelve el bucle de una herramienta para que cuente por dónde va.

    Es lo que hace que instrumentar una herramienta sea una línea:

        for numero, pagina in progreso.contando(enumerate(documento, 1),
                                                documento.page_count, 'Convirtiendo'):
    """
    iniciar(etapa, total=total, cancelable=cancelable)
    for elemento in iterable:
        yield elemento
        paso()


@contextlib.contextmanager
def estimando(etapa: str, segundos: float, cancelable: bool = True):
    """Para lo que no tiene pasos: se declara lo que se cree que va a durar."""
    iniciar(etapa, estimado=max(1.0, segundos), cancelable=cancelable)
    yield
    terminar()


def terminar() -> None:
    """Borra el registro. Lo llama el `teardown_request`, pase lo que pase."""
    actual = _actual()
    _local.trabajo = None
    if not actual:
        return
    for ruta in (_ruta(actual.session_id, actual.trabajo),
                 _ruta(actual.session_id, actual.trabajo, cancelacion=True)):
        try:
            _insistiendo(os.unlink, ruta)
        except OSError:
            pass


def comprobar_cancelacion() -> None:
    if cancelado():
        raise Cancelado()


def cancelado() -> bool:
    actual = _actual()
    if not actual or not actual.cancelable:
        return False
    return os.path.exists(_ruta(actual.session_id, actual.trabajo, cancelacion=True))


# --- lo que usa `web` ------------------------------------------------------

def leer(session_id: str, trabajo: str) -> dict | None:
    """El último parte del trabajo, o `None` si todavía no ha empezado.

    Que no haya nada **no es un error**: significa que la petición sigue en la
    cola, que es justo lo que hay que poder decirle a quien espera.
    """
    try:
        with open(_ruta(session_id, _validar(trabajo)), 'r', encoding='utf-8') as fichero:
            return json.load(fichero)
    except (OSError, ValueError):
        return None


def marcar_cancelacion(session_id: str, trabajo: str) -> None:
    """Deja la marca que el trabajador mira entre paso y paso."""
    ruta = _ruta(session_id, _validar(trabajo), cancelacion=True)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, 'w', encoding='utf-8') as fichero:
        fichero.write(str(time.time()))


# --- fontanería ------------------------------------------------------------

def _actual() -> _Trabajo | None:
    return getattr(_local, 'trabajo', None)


def _validar(trabajo: str) -> str:
    if not ID_RE.match(trabajo or ''):
        raise ApiError('Identificador de trabajo no válido.', 400)
    return trabajo


def _ruta(session_id: str, trabajo: str, cancelacion: bool = False) -> str:
    carpeta = os.path.join(storage.session_dir(session_id, create=False), CARPETA)
    return os.path.join(carpeta, f'{trabajo}.{"cancelar" if cancelacion else "json"}')


def _escribir(actual: _Trabajo, forzar: bool = False) -> bool:
    """Guarda el parte, como mucho cada `INTERVALO`. Dice si ha escrito.

    Se escribe en un temporal y se renombra: quien lee lo hace desde otro
    contenedor y nunca puede encontrarse medio JSON.
    """
    ahora = time.monotonic()
    if not forzar and ahora - actual.ultima < INTERVALO:
        return False
    actual.ultima = ahora

    ruta = _ruta(actual.session_id, actual.trabajo)
    try:
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        temporal = f'{ruta}.tmp'
        with open(temporal, 'w', encoding='utf-8') as fichero:
            json.dump(actual.como_json(), fichero)
        _insistiendo(os.replace, temporal, ruta)
    except OSError:
        # El progreso es una cortesía: si no se puede escribir —disco lleno,
        # sesión ya borrada—, el trabajo sigue.
        return False
    return True


def _insistiendo(operacion, *rutas, intentos: int = 5) -> None:
    """Reintenta un momento si el archivo está abierto por quien lo lee.

    Sólo pasa en Windows, que no deja renombrar encima de un archivo abierto ni
    borrarlo: si la consulta del navegador lo está leyendo justo entonces, sale
    un `PermissionError`. En el renombrado se perdería un parte, que da igual;
    en el borrado de `terminar()`, no: el parte se quedaría diciendo que el
    trabajo sigue vivo. La lectura dura microsegundos, así que basta con esperar
    un poco. En Linux esto no reintenta nunca.
    """
    for intento in range(intentos):
        try:
            operacion(*rutas)
            return
        except PermissionError:
            if intento == intentos - 1:
                raise
            time.sleep(0.02)
