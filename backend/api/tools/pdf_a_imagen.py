"""Herramienta: convertir cada página de un PDF en una imagen."""
import io
import os

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify

import config
from api import current_session, imaging, params
from api.formatos import extension_de, salidas_de_imagen
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('pdf_a_imagen', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Resoluciones ofrecidas, en puntos por pulgada.
RESOLUCIONES = {'pantalla': 96, 'normal': 150, 'alta': 300}

CALIDAD_MINIMA, CALIDAD_MAXIMA, CALIDAD_POR_DEFECTO = 20, 100, 90

# Sin tope de páginas, y es la única herramienta pesada que **no** tiene plazo:
# esto rasteriza dentro del propio worker, no en un proceso aparte. Aun así no
# arriesga la memoria, porque `_guardar_pagina` escribe cada página al disco
# antes de pasar a la siguiente: el pico es una página, no el documento. Lo que
# lo acota de verdad es el disco y el plazo de gunicorn.


@bp.get('/pdf-a-imagen/formatos')
def formatos():
    """Formatos de imagen que puede escribir esta instalación (PDF aparte)."""
    return jsonify({'formatos': salidas_de_imagen()})


@bp.post('/pdf-a-imagen')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El rasterizado')
def pdf_a_imagen():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    ppp = RESOLUCIONES[params.opcion(datos, 'resolucion', RESOLUCIONES, 'normal')]

    admitidos = {f['id'] for f in salidas_de_imagen()}
    formato = params.opcion(datos, 'formato', admitidos, 'JPEG')
    calidad = params.entero(datos, 'calidad', CALIDAD_POR_DEFECTO, CALIDAD_MINIMA, CALIDAD_MAXIMA)
    extension = extension_de(formato)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    ruta = storage.path_of(session_id, file_ids[0])

    try:
        documento = fitz.open(ruta)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña.', 422)
        if documento.page_count == 0:
            raise ApiError('El PDF no tiene páginas.', 422)
        base = os.path.splitext(nombre_seguro(record.name))[0]
        ancho = len(str(documento.page_count))
        resultados = []

        for numero, pagina in enumerate(documento, start=1):
            nombre = f'{base}-pagina-{numero:0{ancho}d}{extension}'
            destino, salida = storage.reserve_output(session_id, nombre)
            _guardar_pagina(pagina, ppp, destino, formato, calidad)
            resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _guardar_pagina(pagina, ppp: int, destino: str, formato: str, calidad: int) -> None:
    """Rasteriza una página y la escribe en el formato pedido.

    El pixmap pasa por Pillow porque es quien conoce las opciones de guardado de
    cada formato; PyMuPDF sólo sabría escribir unos pocos y con sus valores por
    defecto.
    """
    # A 300 ppp una página de tamaño cartel son cientos de megapíxeles: se
    # comprueba con la resolución pedida, no con el tamaño del archivo.
    escala = ppp / 72
    limites.comprobar_lienzo(pagina.rect.width * escala, pagina.rect.height * escala, 'La página')

    pixmap = pagina.get_pixmap(dpi=ppp, alpha=False)
    with Image.open(io.BytesIO(pixmap.tobytes('ppm'))) as imagen:
        imaging.guardar(imagen, destino, formato, calidad)
