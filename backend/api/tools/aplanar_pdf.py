"""Herramienta: aplanar un PDF.

Un formulario relleno y un subrayado no forman parte de la página: son objetos
que viven encima y que cualquiera puede cambiar o quitar con un lector normal.
Aplanar los dibuja **dentro** de la página y los borra como objetos, así que lo
que se ve pasa a ser lo que hay.

No tiene vuelta atrás, y es justo para lo que sirve: mandar un formulario
relleno sabiendo que nadie va a reescribirlo por el camino.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, params
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('aplanar_pdf', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)


@bp.post('/aplanar-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El aplanado')
def aplanar_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un PDF.')
    campos = params.booleano(datos, 'campos', True)
    anotaciones = params.booleano(datos, 'anotaciones', True)
    if not campos and not anotaciones:
        raise ApiError('Elige qué quieres aplanar: los campos, las anotaciones o las dos cosas.',
                       400)

    resultados = []

    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        origen = storage.path_of(session_id, file_id)

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-aplanado.pdf')

        try:
            documento = fitz.open(origen)
        except Exception as err:
            raise ApiError(f'No se ha podido abrir "{record.name}": {err}', 422) from err

        with documento:
            if documento.needs_pass:
                raise ApiError(f'"{record.name}" está protegido con contraseña.', 422)
            documento.bake(annots=anotaciones, widgets=campos)
            # `garbage=3` recoge lo que los campos dejan atrás —apariencias,
            # fuentes que ya no usa nadie— y que si no seguiría pesando.
            documento.save(destino, garbage=3, deflate=True, clean=True)

        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201
