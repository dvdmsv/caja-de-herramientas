"""Enseñar cómo va a quedar una página antes de escribir el archivo.

Lo comparten las herramientas que estampan algo encima de un PDF —la marca de
agua y la numeración—, y la idea es la misma que en `firmar.py`: la vista previa
la dibuja **el servidor**, con el mismo código que va a escribir el resultado. Si
la imitara el navegador habría dos implementaciones que se desviarían en cuanto
se toque una, y encima habría que cargar pdf.js en herramientas que hoy no lo
necesitan.

El detalle que lo hace imprescindible: al estampar se corrige el giro de la
página con `derotation_matrix`, mientras `get_pixmap` la devuelve **ya girada**.
En un PDF con `/Rotate`, sólo quien tiene PyMuPDF delante sabe dónde acaba la
marca.
"""
import io

import fitz  # PyMuPDF
from flask import send_file

from api import limites, params

# Ancho de la vista previa en píxeles. Se ve bien en la caja donde va y no hay
# que pagar por más: la página se pinta como mucho a unos 700 px de ancho.
ANCHO_VISTA = 700

# En JPEG y no en PNG a propósito. Medido sobre una página con una foto a toda
# plana: 654 kB en PNG contra 120 kB en JPEG. Como esto se refresca cada vez que
# se mueve un deslizador, manda el caso peor; en una página de sólo texto el
# JPEG pesa 4 kB más que el PNG, que no se nota.
CALIDAD = 85


def pagina_a_jpeg(documento, numero: int, ancho: int = ANCHO_VISTA) -> bytes:
    """Rasteriza una página, ya con lo que se le haya estampado."""
    pagina = documento[numero - 1]
    escala = ancho / pagina.rect.width if pagina.rect.width else 1
    limites.comprobar_lienzo(pagina.rect.width * escala, pagina.rect.height * escala, 'La página')
    imagen = pagina.get_pixmap(matrix=fitz.Matrix(escala, escala), alpha=False)
    return imagen.tobytes('jpeg', jpg_quality=CALIDAD)


def reducir(imagen, ancho: int = ANCHO_VISTA):
    """Una copia de la imagen al ancho de la vista previa.

    Va aparte de `imagen_a_jpeg` porque el orden importa: quien enseñe el
    resultado de un tratamiento tiene que **reducir primero y tratar después**.
    Al revés —tratar la foto entera para enseñar 700 px— se tarda varios segundos
    por cada movimiento de un deslizador.
    """
    from PIL import Image

    if imagen.width <= ancho:
        return imagen
    alto = max(1, round(imagen.height * ancho / imagen.width))
    return imagen.resize((ancho, alto), Image.LANCZOS)


def imagen_a_jpeg(imagen, ancho: int = ANCHO_VISTA) -> bytes:
    """Una imagen suelta —sin páginas— lista para enseñar."""
    copia = reducir(imagen, ancho)
    if copia.mode not in ('RGB', 'L'):
        copia = copia.convert('RGB')

    buzon = io.BytesIO()
    copia.save(buzon, 'JPEG', quality=CALIDAD, optimize=True)
    return buzon.getvalue()


def responder(imagen: bytes):
    """La imagen tal cual, sin pasar por el almacén de la sesión."""
    return send_file(io.BytesIO(imagen), mimetype='image/jpeg')


def pagina_pedida(datos: dict, total: int) -> int:
    """Qué página hay que enseñar, siempre dentro del documento."""
    return params.entero(datos, 'pagina', 1, 1, max(1, total))
