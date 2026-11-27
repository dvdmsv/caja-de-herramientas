"""Herramienta: poner o quitar la contraseña de apertura de un PDF.

La contraseña no se guarda en ningún sitio: llega en la petición, se usa para
cifrar o descifrar y se queda ahí. Nunca acaba en el nombre del archivo, en sus
metadatos ni en el registro del servidor.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

from api import current_session, params
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('proteger_pdf', __name__, url_prefix='/api/tools')

ACCIONES = {'proteger', 'quitar'}

LONGITUD_MINIMA, LONGITUD_MAXIMA = 4, 128

# Se cifra el documento pero se deja imprimir y copiar: el objetivo es que no lo
# abra quien no debe, no pelearse con el lector de quien sí puede.
PERMISOS = (fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT | fitz.PDF_PERM_COPY
            | fitz.PDF_PERM_ANNOTATE)


@bp.post('/proteger-pdf')
def proteger_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    accion = params.opcion(datos, 'accion', ACCIONES, 'proteger')

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        # Un PDF ya cifrado hay que abrirlo antes de poder hacer nada con él.
        if documento.needs_pass:
            actual = _contraseña(datos, 'password_actual',
                                 'Escribe la contraseña que tiene ahora el PDF.', nueva=False)
            if not documento.authenticate(actual):
                raise ApiError('La contraseña no es correcta.', 403)
        elif accion == 'quitar':
            raise ApiError(f'"{record.name}" no está protegido con contraseña.', 400)

        base = os.path.splitext(nombre_seguro(record.name))[0]

        if accion == 'proteger':
            nueva = _contraseña(datos, 'password', 'Escribe la contraseña que quieres ponerle.', nueva=True)
            destino, salida = storage.reserve_output(session_id, f'{base}-protegido.pdf')
            documento.save(destino, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw=nueva,
                           user_pw=nueva, permissions=PERMISOS, deflate=True)
        else:
            destino, salida = storage.reserve_output(session_id, f'{base}-sin-contrasena.pdf')
            # Sin `PDF_ENCRYPT_NONE` el guardado conservaría el cifrado de origen.
            documento.save(destino, encryption=fitz.PDF_ENCRYPT_NONE, deflate=True)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _contraseña(datos: dict, clave: str, falta: str, *, nueva: bool) -> str:
    valor = datos.get(clave)
    if not isinstance(valor, str) or not valor:
        raise ApiError(falta, 400)
    if nueva and not LONGITUD_MINIMA <= len(valor) <= LONGITUD_MAXIMA:
        raise ApiError(
            f'La contraseña debe tener entre {LONGITUD_MINIMA} y {LONGITUD_MAXIMA} caracteres.', 400)
    return valor
