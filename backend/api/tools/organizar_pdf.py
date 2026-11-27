"""Herramienta: reordenar, girar y eliminar páginas de un PDF.

Las tres operaciones se resuelven con una sola lista: la que manda el cliente es
el documento final, página a página. Lo que no aparece en ella, se elimina.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

from api import current_session, params
from api.formularios import seleccionar_paginas
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('organizar_pdf', __name__, url_prefix='/api/tools')

# El PDF sólo entiende giros en múltiplos de 90 grados.
GIROS = {0, 90, 180, 270}


@bp.post('/organizar-pdf')
def organizar_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)
        paginas = _leer_paginas(datos.get('paginas'), documento.page_count)

        # `select` reordena, repite y elimina de una vez, en el orden dado.
        seleccionar_paginas(documento, [numero - 1 for numero, _ in paginas])
        for indice, (_, giro) in enumerate(paginas):
            if giro:
                pagina = documento[indice]
                pagina.set_rotation((pagina.rotation + giro) % 360)

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-organizado.pdf')
        documento.save(destino, deflate=True, garbage=3)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _leer_paginas(valor, total: int) -> list[tuple[int, int]]:
    """Valida la lista `[{numero, rotacion}]` que describe el documento final."""
    if not isinstance(valor, list):
        raise ApiError('La lista de páginas no es válida.', 400)
    if not valor:
        raise ApiError('No queda ninguna página en el documento.', 400)

    paginas = []
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError('La lista de páginas no es válida.', 400)
        numero = entrada.get('numero')
        giro = entrada.get('rotacion', 0)
        if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= total:
            raise ApiError(f'El PDF tiene {total} páginas y se ha pedido la {numero}.', 400)
        if giro not in GIROS:
            raise ApiError('Las páginas sólo pueden girar 90, 180 o 270 grados.', 400)
        paginas.append((numero, giro))
    return paginas
