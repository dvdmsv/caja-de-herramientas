"""Herramienta: reunir varias imágenes en un único PDF.

Es la operación inversa de "PDF a imagen" y admite cualquier formato que Pillow
sepa abrir en esta instalación (JPG, PNG, WebP, HEIC con plugin, TIFF, BMP…).

El documento lo compone PyMuPDF y no Pillow porque así cada página puede tener
su propio tamaño y la imagen se inserta ya comprimida, sin recomprimirla otra
vez al escribir el PDF.
"""
import io
import os

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify

from api import current_session, imaging, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('imagen_a_pdf', __name__, url_prefix='/api/tools')

# Tamaños de página en puntos PostScript (1 pt = 1/72 de pulgada).
PAGINAS = {'a4': (595.28, 841.89), 'carta': (612.0, 792.0)}
TAMANOS = {'ajustada'} | set(PAGINAS)

ORIENTACIONES = {'auto', 'vertical', 'horizontal'}

MILIMETRO = 72 / 25.4
MARGEN_MAXIMO_MM, MARGEN_POR_DEFECTO_MM = 30, 10

CALIDAD_MINIMA, CALIDAD_MAXIMA, CALIDAD_POR_DEFECTO = 20, 100, 85

# Mismo criterio que en "PDF a imagen": un documento enorme no debe tumbar el
# servidor.
MAXIMO_IMAGENES = 200

# Resolución que se supone cuando la imagen no dice a cuántos ppp se pensó.
PPP_POR_DEFECTO = 96.0
PPP_MINIMO, PPP_MAXIMO = 50.0, 1200.0

# Ninguna página "ajustada" pasa de este lado (≈70 cm): un JPG de muchos
# megapíxeles no debe acabar convertido en un póster.
LADO_MAXIMO_PT = 2000.0

SALIDA_VARIAS = 'imagenes.pdf'


@bp.post('/imagen-a-pdf')
def imagen_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos una imagen.')
    if len(file_ids) > MAXIMO_IMAGENES:
        raise ApiError(f'Se pueden unir hasta {MAXIMO_IMAGENES} imágenes de una vez.', 413)

    tamano = params.opcion(datos, 'pagina', TAMANOS, 'a4')
    orientacion = params.opcion(datos, 'orientacion', ORIENTACIONES, 'auto')
    calidad = params.entero(datos, 'calidad', CALIDAD_POR_DEFECTO, CALIDAD_MINIMA, CALIDAD_MAXIMA)
    # En una página del tamaño de la imagen el margen no pinta nada.
    margen = 0.0 if tamano == 'ajustada' else params.entero(
        datos, 'margen', MARGEN_POR_DEFECTO_MM, 0, MARGEN_MAXIMO_MM) * MILIMETRO

    # Se resuelve todo antes de componer nada, para fallar pronto.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext == '.pdf':
            raise ApiError(f'"{record.name}" ya es un PDF. Usa la herramienta de unir PDF.', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))

    documento = fitz.open()
    with documento:
        for record, ruta in progreso.contando(entradas, len(entradas), 'Componiendo páginas'):
            with imaging.abrir(ruta, record.name) as imagen:
                _anadir_pagina(documento, imagen, tamano, orientacion, margen, calidad)

        nombre = _nombre_salida([record.name for record, _ in entradas])
        destino, salida = storage.reserve_output(session_id, nombre)
        try:
            documento.save(destino, deflate=True)
        except Exception as err:
            raise ApiError(f'No se ha podido crear el PDF: {err}', 422) from err

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _anadir_pagina(documento, imagen: Image.Image, tamano: str, orientacion: str,
                   margen: float, calidad: int) -> None:
    """Añade una página con la imagen centrada y sin deformarla."""
    # El PDF no admite transparencia: lo que fuera transparente va sobre blanco.
    plana = imaging.adaptar_modo(imagen, 'PDF')
    ancho, alto = _tamano_pagina(plana.size, plana.info.get('dpi'), tamano, orientacion)

    pagina = documento.new_page(width=ancho, height=alto)
    hueco = fitz.Rect(margen, margen, ancho - margen, alto - margen)
    if hueco.is_empty or hueco.width <= 0 or hueco.height <= 0:
        hueco = pagina.rect  # margen imposible en una página diminuta
    pagina.insert_image(hueco, stream=_a_jpeg(plana, calidad), keep_proportion=True)


def _tamano_pagina(tamano_px: tuple[int, int], dpi, tamano: str,
                   orientacion: str) -> tuple[float, float]:
    """Tamaño de la página en puntos según la opción elegida."""
    ancho_px, alto_px = tamano_px

    if tamano == 'ajustada':
        ppp = _ppp_de(dpi)
        ancho, alto = ancho_px * 72 / ppp, alto_px * 72 / ppp
        mayor = max(ancho, alto)
        if mayor > LADO_MAXIMO_PT:
            escala = LADO_MAXIMO_PT / mayor
            ancho, alto = ancho * escala, alto * escala
        return ancho, alto

    ancho, alto = PAGINAS[tamano]
    apaisada = orientacion == 'horizontal' or (orientacion == 'auto' and ancho_px > alto_px)
    return (alto, ancho) if apaisada else (ancho, alto)


def _ppp_de(dpi) -> float:
    """Resolución declarada por la imagen, si es creíble; si no, la de por defecto."""
    valor = dpi[0] if isinstance(dpi, (tuple, list)) and dpi else dpi
    try:
        ppp = float(valor)
    except (TypeError, ValueError):
        return PPP_POR_DEFECTO
    return ppp if PPP_MINIMO <= ppp <= PPP_MAXIMO else PPP_POR_DEFECTO


def _a_jpeg(imagen: Image.Image, calidad: int) -> bytes:
    """Comprime la imagen para incrustarla en el PDF.

    Se usa JPEG normal (no progresivo) porque es lo que el PDF puede llevar tal
    cual, sin que PyMuPDF tenga que descomprimirlo y volver a comprimirlo.
    """
    buffer = io.BytesIO()
    imagen.save(buffer, 'JPEG', quality=calidad, optimize=True)
    return buffer.getvalue()


def _nombre_salida(nombres: list[str]) -> str:
    """Una sola imagen conserva su nombre; varias van a un documento común."""
    if len(nombres) == 1:
        return os.path.splitext(nombre_seguro(nombres[0]))[0] + '.pdf'
    return SALIDA_VARIAS
