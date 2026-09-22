"""Herramienta: dejar la foto de un papel como si la hubiera pasado un escáner.

Sacas una foto a un folio con el móvil y sale con la sombra de tu propia mano en
una esquina, el papel gris amarillento y las letras deslavadas. Se lee mal, se
imprime peor y el OCR se atraganta.

Lo que hace está en `api/escaneo.py`, aparte y medible: **dividir la imagen por
su propio fondo**, que es lo que aplana la iluminación en vez de limitarse a
subir el contraste. El porqué está explicado allí.

La vista previa la dibuja el servidor con `limpiar`, el mismo código que escribe
el archivo, siguiendo lo que ya hacen la marca de agua y la numeración. Aquí no
hay giros de página que corregir, pero sigue valiendo la razón principal: imitar
esto en el navegador serían dos implementaciones desviándose.
"""
import os

from flask import Blueprint, jsonify

import config
from api import current_session, escaneo, imaging, limites, params, progreso, vista_previa
from api.formatos import extension_de, extensiones_de_entrada
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('efecto_escaner', __name__, url_prefix='/api/tools')

PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Un escaneado limpio es sobre todo blanco: en PNG pesa poco y no se lleva por
# delante los bordes de las letras, que es justo lo que estropea el JPEG y lo que
# más penaliza al OCR. En color sí compensa el JPEG.
FORMATOS = {'blanco-y-negro': 'PNG', 'gris': 'PNG', 'color': 'JPEG'}

CALIDAD = 90


@bp.post('/efecto-escaner/previsualizar')
def previsualizar():
    """Cómo va a quedar, sin escribir nada."""
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona una imagen.')
    modo, intensidad = _leer_ajustes(datos)

    record = _comprobar(session_id, file_ids[0])
    ruta = storage.path_of(session_id, file_ids[0])
    with imaging.abrir(ruta, record.name) as imagen:
        # Reducir primero y limpiar después: la estimación del fondo ya trabaja
        # sobre una copia de tamaño fijo, así que lo que se ve es lo que saldrá
        # salvo en el detalle más fino, y a cambio esto responde al instante.
        limpia = escaneo.limpiar(vista_previa.reducir(imagen), modo, intensidad)
        return vista_previa.responder(vista_previa.imagen_a_jpeg(limpia))


@bp.post('/efecto-escaner')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La limpieza')
def efecto_escaner():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos una imagen.')
    modo, intensidad = _leer_ajustes(datos)
    formato = FORMATOS[modo]
    extension = extension_de(formato)

    resultados = []
    for file_id in progreso.contando(file_ids, len(file_ids), 'Limpiando imágenes'):
        record = _comprobar(session_id, file_id)
        ruta = storage.path_of(session_id, file_id)

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-escaneado{extension}')
        with imaging.abrir(ruta, record.name) as imagen:
            imaging.guardar(escaneo.limpiar(imagen, modo, intensidad), destino, formato, CALIDAD)

        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _leer_ajustes(datos: dict) -> tuple[str, int]:
    """Las opciones, leídas igual para la vista previa y para el resultado.

    Si cada una leyera lo suyo, dejarían de coincidir en cuanto alguien tocase un
    rango, y lo que se ve dejaría de ser lo que sale.
    """
    modo = params.opcion(datos, 'modo', set(escaneo.MODOS), 'blanco-y-negro')
    intensidad = params.entero(datos, 'intensidad', escaneo.INTENSIDAD_POR_DEFECTO,
                               escaneo.INTENSIDAD_MINIMA, escaneo.INTENSIDAD_MAXIMA)
    return modo, intensidad


def _comprobar(session_id: str, file_id: str):
    record = storage.record_of(session_id, file_id)
    if record.ext not in extensiones_de_entrada():
        pista = ' Esto trabaja sobre fotos; para un PDF escaneado, usa "PDF con OCR".' \
            if record.ext == '.pdf' else ''
        raise ApiError(f'"{record.name}" no es una imagen.{pista}', 400)
    return record
