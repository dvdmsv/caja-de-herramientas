"""Trabajos que corren como proceso aparte.

Las herramientas que llaman a un programa externo pesado —LibreOffice,
pdf2docx y ocrmypdf— comparten aquí dos cosas:

- **El turno**: sólo uno de estos trabajos a la vez en todo el proceso. El
  servidor atiende con cuatro hilos y el contenedor vive con poca memoria;
  cuatro LibreOffice arrancando a la vez lo matan. Quien llega y lo encuentra
  ocupado espera un rato corto y, si no le llega el turno, se le dice que
  vuelva en un momento en vez de dejarle colgado hasta que nginx corte.
- **La traducción de fallos** a `ApiError`, para que falte el programa o se
  agote el tiempo y el usuario lea algo entendible.
- **La vigilancia mientras dura**: el programa se lanza con `Popen` y se espera
  a latidos cortos en vez de bloquearse en un `run()`, que es lo único que
  permite mirar si han cancelado el trabajo y matar el proceso. Un OCR de cuatro
  minutos sin forma de pararlo es cuatro minutos de un worker ocupado para
  nadie.

El turno es **uno para los tres**, y no uno por herramienta, porque lo que se
está repartiendo es la memoria del contenedor: da igual que la ocupe un
LibreOffice o un ocrmypdf. El cálculo de workers de `config.py` reserva sitio
para un trabajo pesado por worker, y esto es lo que hace que esa cuenta se
cumpla.
"""
import os
import subprocess
import sys
import threading
import time

from flask import current_app

import config
from api import progreso
from errors import ApiError

# Cuántos de estos trabajos pueden correr a la vez **en cada worker**.
#
# En producción esto ya no reparte nada: el servicio `pesados` atiende cada
# petición en un proceso desechable, y quien pone el tope es su número de
# workers (`gunicorn.trabajos.conf.py`). Sigue aquí porque `python app.py`
# registra todo en un proceso y ahí es lo único que evita que cuatro hilos
# arranquen cuatro LibreOffice. **No lo confundas con una protección de
# producción**: allí la protección son los límites del proceso.
#
# Ojo con esto, que se presta a error: el semáforo es un objeto de módulo, así
# que cada proceso de gunicorn tiene el suyo. Los trabajos simultáneos de
# verdad son `GUNICORN_WORKERS` × este número.
#
# Por eso el valor por defecto se queda en 1 aunque la máquina sea grande: quien
# reparte la memoria es el cálculo de workers de `config.py`, que ya reserva
# sitio para un trabajo por worker (un LibreOffice se come 250-350 MB y un OCR
# a cuatro núcleos, 327 MB). Con dos workers salen dos a la vez sin tocar nada.
CONVERSIONES_A_LA_VEZ = config.entorno_entero('MAX_CONCURRENT_CONVERSIONS', 1)
_turno = threading.BoundedSemaphore(CONVERSIONES_A_LA_VEZ)

# Cuánto se espera a que quede libre el turno. Sumado al tiempo máximo del
# trabajo tiene que caber en el plazo de gunicorn (300 s), y el que más gasta de
# ese margen es el OCR: 45 + 240 = 285 s. Al subir cualquiera de los dos hay que
# mirar esa suma, no cada número por su cuenta.
ESPERA_MAXIMA = config.entorno_entero('CONVERSION_QUEUE_TIMEOUT_SECONDS', 45)

# Cada cuánto se despierta la espera para mirar si han cancelado. Medio segundo
# es imperceptible para quien pulsa y son dos vueltas por segundo de un bucle
# que no hace nada: ni se nota en la CPU de un trabajo de minutos.
LATIDO = 0.5


# En Windows un proceso que revienta no muere «por una señal»: sale con el
# código de la excepción nativa, que Python da como un entero positivo enorme.
# Son los mismos casos que el código negativo de Linux —sin memoria, violación
# de segmento— y se traducen igual.
FALLOS_NATIVOS_WINDOWS = {
    0xC0000005,  # violación de acceso: la violación de segmento de Windows
    0xC0000017,  # sin memoria
    0xC00000FD,  # desbordamiento de pila
    0xC0000409,  # la pila se ha corrompido (lo que da un abort de C)
}

# Los programas que en realidad son paquetes de Python. En Linux y en un
# entorno de desarrollo son un ejecutable más en el PATH; en la aplicación de
# escritorio no existe ese ejecutable —PyInstaller no crea los scripts de
# consola—, así que se llama al propio backend empaquetado y él los arranca
# (ver `escritorio.py`, `--programa`). La tabla dice dónde está su `main`.
PROGRAMAS_DE_PYTHON = {
    'ocrmypdf': 'ocrmypdf.__main__:run',
    'pdf2docx': 'pdf2docx.main:main',
}

# Los que en Windows se llaman de otra manera. Ghostscript instala `gswin64c`
# (la «c» es la versión de consola; `gswin64` abriría una ventana).
NOMBRES_EN_WINDOWS = {'gs': 'gswin64c'}


def murio_por_fallo(codigo: int) -> bool:
    """Si el programa no terminó mal, sino que lo mató el sistema."""
    return codigo < 0 or (os.name == 'nt' and codigo in FALLOS_NATIVOS_WINDOWS)


def resolver(orden: list[str]) -> list[str]:
    """La orden tal y como hay que lanzarla en esta plataforma.

    En Linux, fuera del paquete de escritorio, no cambia nada: es lo que evita
    que el escritorio le cueste algo al servicio web.
    """
    programa, *resto = orden
    # Una ruta explícita gana a todo: `RUTA_SOFFICE`, `RUTA_GS`… La aplicación
    # de escritorio la usa porque LibreOffice no puede ir en el PATH: su
    # carpeta `program` trae su propio `python.exe`, y con ella delante
    # cualquier `python` del sistema pasa a ser el de LibreOffice.
    explicita = os.environ.get(f'RUTA_{programa.upper()}', '').strip()
    if explicita:
        return [explicita, *resto]
    if getattr(sys, 'frozen', False) and programa in PROGRAMAS_DE_PYTHON:
        return [sys.executable, '--programa', programa, *resto]
    if os.name == 'nt' and programa in NOMBRES_EN_WINDOWS:
        return [NOMBRES_EN_WINDOWS[programa], *resto]
    return orden


def entorno_de_programas() -> dict | None:
    """El entorno de los programas externos: el del backend con `PATH_PROGRAMAS`
    delante, o el mismo sin tocar (`None`) si no lo hay, que es la web.

    Existe por la aplicación de escritorio: Tesseract y Ghostscript tienen que
    estar en el PATH de ocrmypdf, que los busca por nombre, y **no** en el del
    backend, porque Tesseract trae sus propias bibliotecas de GTK y taparían las
    de WeasyPrint (ver `escritorio.usar_vendor`).
    """
    extra = os.environ.get('PATH_PROGRAMAS', '').strip()
    if not extra:
        return None
    return {**os.environ, 'PATH': os.pathsep.join([extra, os.environ.get('PATH', '')])}


def en_palabras(segundos: int) -> str:
    """El plazo dicho como lo diría una persona.

    Ahora que no hay topes de páginas, este texto es lo que lee quien se pasa de
    tiempo, así que más vale que no diga "más de 1 minutos" cuando el plazo son
    tres segundos.
    """
    if segundos < 60:
        return f'{segundos} segundos' if segundos != 1 else '1 segundo'
    minutos = -(-segundos // 60)
    return f'{minutos} minutos' if minutos != 1 else '1 minuto'


def ejecutar(orden: list[str], tiempo_limite: int, programa: str, no_disponible: str,
             trabajo: str = 'La conversión', vigilante=None) -> subprocess.CompletedProcess:
    """Lanza el programa y devuelve su resultado, esperando su turno.

    `no_disponible` es lo que se le dice al usuario si el programa no está
    instalado en esta máquina, que en desarrollo pasa constantemente.

    `trabajo` es cómo se llama esto en la pantalla de quien espera: el OCR no es
    una conversión y leer que "la conversión se ha cancelado" después de subir
    un escaneado desconcierta.

    `vigilante` es una función sin argumentos que dice si hay que abortar; por
    defecto, si han cancelado el trabajo desde la interfaz. Se consulta a
    latidos de medio segundo, y si dice que sí, el programa se mata.
    """
    if not _turno.acquire(timeout=ESPERA_MAXIMA):
        raise ApiError('El servidor está ocupado procesando otro documento. '
                       'Inténtalo de nuevo en un momento.', 503)
    try:
        resultado = _esperar(orden, tiempo_limite, programa, no_disponible, trabajo,
                             vigilante or progreso.cancelado)
        if murio_por_fallo(resultado.returncode):
            # Código negativo = lo mató una señal, no terminó mal (en Windows,
            # uno de `FALLOS_NATIVOS_WINDOWS`). Lo normal es
            # que se haya pasado del límite de memoria del worker, que hereda:
            # medido, pdf2docx con 512 MB se cae con violación de segmento (-11)
            # sin decir nada. Antes esto salía como "el archivo está dañado", que
            # manda a buscar el problema al sitio equivocado.
            current_app.logger.warning('%s murió con el código %d.', programa,
                                       resultado.returncode)
            raise ApiError(
                f'{trabajo} se ha quedado sin memoria con este documento. '
                'Prueba con uno más corto, o sube el tope de memoria por trabajo '
                'del servidor.', 413)
        return resultado
    finally:
        _turno.release()


def _esperar(orden: list[str], tiempo_limite: int, programa: str, no_disponible: str,
             trabajo: str, vigilante) -> subprocess.CompletedProcess:
    """Lanza el programa y espera a latidos, mirando si hay que abortar.

    El plazo se lleva con `monotonic` y no con el `timeout=` de `communicate`
    porque la espera se parte en trozos: sumar los trozos daría un plazo que se
    alarga solo.
    """
    try:
        # UTF-8 explícito y sin reventar por un byte raro: con `text=True` a
        # secas se decodifica con la codificación del sistema, que en Windows es
        # cp1252 y no sabe leer lo que escriben tesseract o LibreOffice.
        #
        # `CREATE_NO_WINDOW`: sin él, desde la aplicación de escritorio cada
        # conversión abriría y cerraría una consola negra delante del usuario.
        # `stdin` nulo y no heredado: si el backend no tiene una entrada válida
        # (en Windows, lanzado sin consola), el programa la heredaría rota y
        # ocrmypdf fallaría al lanzar Ghostscript con «controlador no válido».
        # Visto en una VM limpia. Y así nadie se queda esperando entrada.
        proceso = subprocess.Popen(resolver(orden), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8',
                                   errors='replace', env=entorno_de_programas(),
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except FileNotFoundError as err:  # falta el programa en la imagen
        current_app.logger.error('%s no está instalado: %s', programa, err)
        raise ApiError(no_disponible, 500) from err

    limite = time.monotonic() + tiempo_limite
    with proceso:
        while True:
            try:
                salida, errores = proceso.communicate(timeout=LATIDO)
                break
            except subprocess.TimeoutExpired:
                # `communicate` conserva lo ya leído entre intentos, así que
                # reintentar no pierde salida.
                if vigilante():
                    _matar(proceso, programa)
                    raise progreso.Cancelado() from None
                if time.monotonic() >= limite:
                    _matar(proceso, programa)
                    raise ApiError(
                        f'{trabajo} ha tardado más de {en_palabras(tiempo_limite)} y se ha '
                        'cancelado. Prueba con un documento más corto.', 504) from None

    return subprocess.CompletedProcess(orden, proceso.returncode, salida, errores)


def _matar(proceso: subprocess.Popen, programa: str) -> None:
    """Lo mata y lo entierra: sin el `communicate` final queda un zombi.

    En Windows hay que matar el **árbol**: `soffice.exe` es un lanzador que
    arranca `soffice.bin`, y `kill()` sólo se lleva al lanzador. El que hace el
    trabajo —y se come la memoria— seguiría vivo, y el siguiente LibreOffice
    podría encontrárselo.
    """
    if os.name == 'nt':
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proceso.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    proceso.kill()
    try:
        proceso.communicate(timeout=LATIDO)
    except subprocess.TimeoutExpired:
        current_app.logger.warning('%s no ha muerto tras el kill.', programa)
