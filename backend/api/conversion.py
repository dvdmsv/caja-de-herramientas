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

El turno es **uno para los tres**, y no uno por herramienta, porque lo que se
está repartiendo es la memoria del contenedor: da igual que la ocupe un
LibreOffice o un ocrmypdf. El cálculo de workers de `config.py` reserva sitio
para un trabajo pesado por worker, y esto es lo que hace que esa cuenta se
cumpla.
"""
import subprocess
import threading

from flask import current_app

import config
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


def ejecutar(orden: list[str], tiempo_limite: int, programa: str,
             no_disponible: str, trabajo: str = 'La conversión') -> subprocess.CompletedProcess:
    """Lanza el programa y devuelve su resultado, esperando su turno.

    `no_disponible` es lo que se le dice al usuario si el programa no está
    instalado en esta máquina, que en desarrollo pasa constantemente.

    `trabajo` es cómo se llama esto en la pantalla de quien espera: el OCR no es
    una conversión y leer que "la conversión se ha cancelado" después de subir
    un escaneado desconcierta.
    """
    if not _turno.acquire(timeout=ESPERA_MAXIMA):
        raise ApiError('El servidor está ocupado procesando otro documento. '
                       'Inténtalo de nuevo en un momento.', 503)
    try:
        resultado = subprocess.run(orden, capture_output=True, text=True, timeout=tiempo_limite)
        if resultado.returncode < 0:
            # Código negativo = lo mató una señal, no terminó mal. Lo normal es
            # que se haya pasado del límite de memoria del worker, que hereda:
            # medido, pdf2docx con 512 MB se cae con violación de segmento (-11)
            # sin decir nada. Antes esto salía como "el archivo está dañado", que
            # manda a buscar el problema al sitio equivocado.
            current_app.logger.warning('%s murió por la señal %d.', programa,
                                       -resultado.returncode)
            raise ApiError(
                f'{trabajo} se ha quedado sin memoria con este documento. '
                'Prueba con uno más corto, o sube el tope de memoria por trabajo '
                'del servidor.', 413)
        return resultado
    except FileNotFoundError as err:  # falta el programa en la imagen
        current_app.logger.error('%s no está instalado: %s', programa, err)
        raise ApiError(no_disponible, 500) from err
    except subprocess.TimeoutExpired as err:
        raise ApiError(
            f'{trabajo} ha tardado más de {en_palabras(tiempo_limite)} y se ha '
            'cancelado. Prueba con un documento más corto.', 504) from err
    finally:
        _turno.release()
