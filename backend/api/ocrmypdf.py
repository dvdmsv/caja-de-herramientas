"""Lo que comparten las dos herramientas que llaman al programa `ocrmypdf`.

Son «PDF con OCR» y «Convertir a PDF/A». Usan el mismo binario, el mismo
Ghostscript por debajo y los mismos códigos de salida, así que la tabla que los
traduce a castellano vive aquí y no duplicada en las dos: el día que ocrmypdf
añada un código, se añade en un sitio.

Va por `api/conversion.py`, como LibreOffice y pdf2docx, y por lo mismo: es lo
único que permite mirar la marca de cancelación mientras corre y matarlo, y lo
único que traduce «murió por señal» en un 413 en vez de un 500.

Se lanza como proceso aparte y no por la API de Python de ocrmypdf a propósito:
reparte trabajo con multiprocessing y este servidor atiende con hilos.
"""
from flask import current_app

from api import conversion
from errors import ApiError

# Qué significa cada código de salida de ocrmypdf, en cristiano. Los que no
# están aquí caen en el mensaje genérico de quien llama.
#
# El 10 es el que le importa a PDF/A y no al OCR: Ghostscript ha hecho el
# trabajo pero el resultado no cumple el perfil que se le pidió.
ERRORES = {
    2: ('No se ha podido leer el PDF: puede estar dañado.', 422),
    4: ('El resultado no era un PDF válido.', 422),
    5: ('El resultado no era un PDF válido.', 422),
    8: ('El PDF está protegido con contraseña. Quítasela primero.', 422),
    10: ('No se ha podido convertir este PDF al formato de archivado. '
         'Suele pasar con documentos que llevan transparencias o fuentes que no '
         'se pueden incrustar.', 422),
}


def ejecutar(opciones: list[str], origen: str, destino: str, tiempo_limite: int,
             no_disponible: str, trabajo: str, errores: dict | None = None,
             generico: tuple[str, int] = ('No se ha podido completar la conversión.', 422)) -> None:
    """Lanza ocrmypdf y traduce lo que salga mal.

    `errores` se suma a `ERRORES` para los códigos que signifiquen algo distinto
    según quién llame: el 6 —«ya tiene texto»— se arregla de una manera en el
    OCR y de otra en PDF/A.
    """
    orden = ['ocrmypdf', *opciones, origen, destino]
    resultado = conversion.ejecutar(orden, tiempo_limite, 'ocrmypdf', no_disponible,
                                    trabajo=trabajo)
    if resultado.returncode == 0:
        return

    tabla = {**ERRORES, **(errores or {})}
    mensaje, codigo = tabla.get(resultado.returncode, generico)
    # El detalle de ocrmypdf va al registro, no a la pantalla del usuario. El
    # **final** y no el principio: cuando es una traza de Python, lo que dice
    # qué ha fallado es la última línea, y el principio sólo dice por dónde iba.
    current_app.logger.warning('ocrmypdf salió con %s: %s', resultado.returncode,
                               (resultado.stderr or '').strip()[-1500:])
    raise ApiError(mensaje, codigo)
