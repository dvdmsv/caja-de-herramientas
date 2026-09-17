"""Herramienta: sacar las imágenes que lleva dentro un PDF.

Por defecto se vuelcan **tal y como están en el archivo**, sin recomprimirlas:
es lo más fiel y lo más rápido. Quien las quiera todas en el mismo formato puede
pedir PNG o JPG, y entonces sí pasan por Pillow.

Un PDF de texto corriente trae docenas de fragmentos diminutos —viñetas, filetes
de las tablas, iconos— que no le interesan a nadie, así que se descartan las que
no llegan a un tamaño mínimo. El filtro usa las medidas que ya vienen en los
datos de la imagen, sin abrirla.
"""
import io
import os

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify

import config
from api import current_session, imaging, params
from api.formatos import extension_de
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('extraer_imagenes', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Formatos de salida. "original" vuelca los bytes tal cual.
FORMATOS = {'original', 'PNG', 'JPEG'}

LADO_MINIMO, LADO_MAXIMO, LADO_POR_DEFECTO = 0, 2000, 100

# Un PDF puede llevar miles de imágenes; devolverlas todas haría inservible el
# ZIP y dejaría al servidor escribiendo archivos un buen rato.
MAXIMO_IMAGENES = 300

CALIDAD = 90


@bp.post('/extraer-imagenes')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La extracción de imágenes')
def extraer_imagenes():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    formato = params.opcion(datos, 'formato', FORMATOS, 'original')
    lado_minimo = params.entero(datos, 'lado_minimo', LADO_POR_DEFECTO, LADO_MINIMO, LADO_MAXIMO)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{record.name}": {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError(f'"{record.name}" está protegido con contraseña. '
                           'Quítasela primero.', 422)
        encontradas = _recoger(documento, lado_minimo)

    if not encontradas:
        raise ApiError(
            'No se ha encontrado ninguna imagen de ese tamaño en el documento. '
            'Prueba a bajar el tamaño mínimo.', 422)

    base = os.path.splitext(nombre_seguro(record.name))[0]
    ancho = len(str(len(encontradas)))
    resultados = []
    for numero, imagen in enumerate(encontradas, start=1):
        extension = f'.{imagen["ext"]}' if formato == 'original' else extension_de(formato)
        destino, salida = storage.reserve_output(
            session_id, f'{base}-imagen-{numero:0{ancho}d}{extension}')
        _guardar(imagen, destino, formato)
        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _recoger(documento, lado_minimo: int) -> list[dict]:
    """Las imágenes del documento, sin repetir y en orden de aparición."""
    vistas: set[int] = set()
    encontradas = []

    for pagina in documento:
        for informacion in pagina.get_images(full=True):
            xref = informacion[0]
            # La misma imagen puede estar en varias páginas: se saca una vez.
            if xref in vistas:
                continue
            vistas.add(xref)

            try:
                imagen = documento.extract_image(xref)
            except Exception:
                continue  # imagen ilegible: se salta y a por la siguiente

            if not imagen or not imagen.get('image'):
                continue
            if min(imagen.get('width', 0), imagen.get('height', 0)) < lado_minimo:
                continue

            encontradas.append(imagen)
            if len(encontradas) >= MAXIMO_IMAGENES:
                return encontradas

    return encontradas


def _guardar(imagen: dict, destino: str, formato: str) -> None:
    if formato == 'original':
        with open(destino, 'wb') as fichero:
            fichero.write(imagen['image'])
        return

    try:
        with Image.open(io.BytesIO(imagen['image'])) as abierta:
            abierta.load()
            imaging.guardar(abierta, destino, formato, CALIDAD)
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido convertir una de las imágenes: {err}', 422) from err
