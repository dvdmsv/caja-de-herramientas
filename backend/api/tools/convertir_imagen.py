"""Herramienta: cambiar el formato de una o varias imágenes."""
import os

from flask import Blueprint, jsonify

from api import current_session, imaging, params, progreso
from api.formatos import extension_de, extensiones_de_entrada, salidas_disponibles
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('convertir_imagen', __name__, url_prefix='/api/tools')

CALIDAD_MINIMA, CALIDAD_MAXIMA, CALIDAD_POR_DEFECTO = 20, 100, 85


@bp.get('/convertir-imagen/formatos')
def formatos():
    """Formatos disponibles en esta instalación; la interfaz sólo ofrece estos."""
    return jsonify({'formatos': salidas_disponibles()})


@bp.post('/convertir-imagen')
def convertir_imagen():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos una imagen.')

    admitidos = {f['id'] for f in salidas_disponibles()}
    formato = params.opcion(datos, 'formato', admitidos, 'JPEG')
    calidad = params.entero(datos, 'calidad', CALIDAD_POR_DEFECTO, CALIDAD_MINIMA, CALIDAD_MAXIMA)
    extension = extension_de(formato)

    resultados = []
    for file_id in progreso.contando(file_ids, len(file_ids), 'Convirtiendo imágenes'):
        record = storage.record_of(session_id, file_id)
        if record.ext not in extensiones_de_entrada():
            pista = ' Usa la herramienta de PDF a imagen.' if record.ext == '.pdf' else ''
            raise ApiError(f'"{record.name}" no es una imagen.{pista}', 400)
        ruta = storage.path_of(session_id, file_id)

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}{extension}')
        with imaging.abrir(ruta, record.name) as imagen:
            imaging.guardar(imagen, destino, formato, calidad)

        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201
