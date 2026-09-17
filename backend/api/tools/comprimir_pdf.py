"""Herramienta: reducir el peso de un PDF.

Casi todo el peso de un PDF suele estar en sus imágenes, así que el trabajo real
es recomprimirlas. Además se limpia la estructura del documento: objetos
huérfanos, flujos sin comprimir y fuentes duplicadas.
"""
import io
import os
import shutil

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify

import config
from api import current_session, params
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('comprimir_pdf', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Calidad JPEG y lado mayor admitido para las imágenes de dentro del PDF. Los
# tres niveles recomprimen: uno que sólo limpiara la estructura no bajaría nada
# en un PDF normal, porque el peso está en las imágenes.
NIVELES = {
    'suave': {'calidad': 85, 'lado_maximo': 2200},
    'media': {'calidad': 70, 'lado_maximo': 1600},
    'fuerte': {'calidad': 45, 'lado_maximo': 1100},
}

# Recomprimir una imagen ya pequeña casi nunca compensa y sí degrada.
MINIMO_BYTES = 20 * 1024
MINIMO_LADO = 80


@bp.post('/comprimir-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La compresión')
def comprimir_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    nivel = params.opcion(datos, 'nivel', NIVELES, 'media')

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}-comprimido.pdf')

    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña.', 422)
        _recomprimir_imagenes(documento, **NIVELES[nivel])
        documento.save(destino, garbage=4, deflate=True, deflate_images=True,
                       deflate_fonts=True, clean=True)

    # Si el "comprimido" pesa más (pasa con PDF ya optimizados), se entrega el
    # original: nadie quiere descargar una versión peor de su archivo.
    tamano_original = os.path.getsize(origen)
    if os.path.getsize(destino) >= tamano_original:
        shutil.copyfile(origen, destino)

    resultado = storage.commit_output(session_id, salida)
    return jsonify({
        'files': [resultado.to_json()],
        'resumen': {'antes': tamano_original, 'despues': resultado.size},
    }), 201


def _recomprimir_imagenes(documento, calidad: int, lado_maximo: int) -> None:
    """Sustituye las imágenes del PDF por versiones JPEG más ligeras."""
    procesados: set[int] = set()

    for pagina in documento:
        for informacion in pagina.get_images(full=True):
            xref = informacion[0]
            if xref in procesados:
                continue
            procesados.add(xref)

            try:
                original = documento.extract_image(xref)
            except Exception:
                continue  # imagen ilegible: se deja como está

            # Las imágenes con transparencia se saltan: al pasarlas a JPEG
            # perderían el canal alfa y aparecerían recuadros negros.
            if original.get('smask'):
                continue
            if len(original['image']) < MINIMO_BYTES:
                continue

            nueva = _a_jpeg(original['image'], calidad, lado_maximo)
            if nueva and len(nueva) < len(original['image']):
                try:
                    pagina.replace_image(xref, stream=nueva)
                except Exception:
                    continue  # el PDF se queda con la imagen original


def _a_jpeg(datos: bytes, calidad: int, lado_maximo: int) -> bytes | None:
    """Reescala y recomprime una imagen; devuelve None si no se puede."""
    try:
        with Image.open(io.BytesIO(datos)) as imagen:
            if min(imagen.size) < MINIMO_LADO:
                return None
            imagen = imagen.convert('RGB')
            if max(imagen.size) > lado_maximo:
                imagen.thumbnail((lado_maximo, lado_maximo), Image.LANCZOS)
            destino = io.BytesIO()
            imagen.save(destino, 'JPEG', quality=calidad, optimize=True, progressive=True)
            return destino.getvalue()
    except Exception:
        return None
