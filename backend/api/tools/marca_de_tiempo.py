"""Sello RFC 3161 de documento o fecha visible, sin certificado personal."""
import os
from datetime import datetime
from uuid import uuid4

from flask import Blueprint, jsonify

import config
from api import current_session, firma_digital, limites, params, progreso, vista_previa
from api.texto_pdf import escribir_en_borde
from api.tipografia import COLORES_TEXTO, FAMILIAS, TAMANO_MAXIMO, TAMANO_MINIMO, fuente
from api.tools.numerar_paginas import (
    ALINEACIONES, BORDES, MILIMETRO, MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM,
    MARGEN_POR_DEFECTO_MM, _abrir,
)
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('marca_de_tiempo', __name__, url_prefix='/api/tools')
PLAZO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)


@bp.post('/marca-de-tiempo')
@limites.con_plazo(PLAZO, 'La marca de tiempo')
def ejecutar():
    session_id = current_session()
    datos = params.cuerpo()
    ruta, record = _documento(session_id, datos)
    modo = params.opcion(datos, 'modo', {'criptografico', 'visible'}, 'criptografico')
    ajustes = _ajustes(datos) if modo == 'visible' else None
    _comprobar(ruta, record.name, modo)
    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}-marca-de-tiempo.pdf')
    try:
        if modo == 'visible':
            with _abrir(ruta, record.name) as documento:
                for pagina in progreso.contando(documento, documento.page_count, 'Añadiendo fecha'):
                    escribir_en_borde(pagina, ajustes['texto'], ajustes)
                progreso.comprobar_cancelacion()
                documento.save(destino, deflate=True, garbage=3)
        else:
            _sellar(ruta, destino)
        progreso.comprobar_cancelacion()
        resultado = storage.commit_output(session_id, salida).to_json()
    except Exception:
        # Una respuesta TSA fallida o una cancelación no deja un PDF parcial.
        if os.path.exists(destino):
            os.unlink(destino)
        raise
    return jsonify({'files': [resultado]}), 201


@bp.post('/marca-de-tiempo/previsualizar')
@limites.con_plazo(limites.PLAZO_AUXILIAR, 'La vista previa')
def previsualizar():
    session_id = current_session()
    datos = params.cuerpo()
    if params.opcion(datos, 'modo', {'visible', 'criptografico'}, 'visible') != 'visible':
        raise ApiError('El sello criptográfico no cambia el aspecto del PDF.', 400)
    ruta, record = _documento(session_id, datos)
    ajustes = _ajustes(datos)
    _comprobar(ruta, record.name, 'visible')
    with _abrir(ruta, record.name) as documento:
        numero = vista_previa.pagina_pedida(datos, documento.page_count)
        escribir_en_borde(documento[numero - 1], ajustes['texto'], ajustes)
        return vista_previa.responder(vista_previa.pagina_a_jpeg(documento, numero))


def _documento(session_id, datos):
    ids = params.ids(datos, mensaje='Selecciona un PDF.')
    if len(ids) != 1:
        raise ApiError('Selecciona un solo PDF por operación.', 400)
    record = storage.record_of(session_id, ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    return storage.path_of(session_id, ids[0]), record


def _ajustes(datos):
    try:
        fecha = datetime.fromisoformat(datos.get('fecha', ''))
        if fecha.utcoffset() is None:
            raise ValueError('falta zona horaria')
        desplazamiento = fecha.utcoffset().total_seconds()
        if desplazamiento % 60 or abs(desplazamiento) > 14 * 3600:
            raise ValueError('desplazamiento no válido')
    except (TypeError, ValueError):
        raise ApiError('Indica una fecha y hora válidas con su desplazamiento UTC.', 400) from None
    offset = fecha.strftime('%z')
    texto = fecha.strftime('%d/%m/%Y %H:%M:%S') + f' UTC{offset[:3]}:{offset[3:]}'
    return {
        'texto': texto,
        'borde': params.opcion(datos, 'borde', BORDES, 'abajo'),
        'alineacion': params.opcion(datos, 'alineacion', ALINEACIONES, 'derecha'),
        'tamano': params.entero(datos, 'tamano', 10, TAMANO_MINIMO, TAMANO_MAXIMO),
        'color': COLORES_TEXTO[params.opcion(datos, 'color', COLORES_TEXTO, 'negro')],
        'fuente': fuente(params.opcion(datos, 'fuente', FAMILIAS, 'sans'), False, False),
        'margen': params.entero(datos, 'margen', MARGEN_POR_DEFECTO_MM,
                                MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM) * MILIMETRO,
    }


def _comprobar(ruta, nombre, modo):
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.fields import enumerate_sig_fields

    with _abrir(ruta, nombre):
        pass
    try:
        with open(ruta, 'rb') as archivo:
            lector = PdfFileReader(archivo)
            if modo == 'visible' and any(enumerate_sig_fields(lector, filled_status=True)):
                raise ApiError('Este PDF lleva firmas o sellos digitales. Para añadir una fecha visible, '
                               'usa un PDF sin firmas.', 422)
            # Revisar ahora evita consultar a la TSA si el original ya incumple sus permisos.
            if modo == 'criptografico':
                _comprobar_permisos(lector)
    except ApiError:
        raise
    except Exception as err:
        raise ApiError('No se pueden leer las firmas o restricciones de este PDF.', 422) from err


def _comprobar_permisos(lector):
    for firma in lector.embedded_signatures:
        firma.compute_integrity_info()
        if firma.summarise_integrity_info()['docmdp_ok'] is not True:
            raise ApiError('Las restricciones de las firmas de este PDF no permiten añadir '
                           'el sello de tiempo sin alterarlas.', 422)


def _sellar(ruta, destino):
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign import signers
    from pyhanko.sign.timestamps import TimestampRequestError
    from pyhanko.sign.general import SigningError
    from pyhanko.sign.validation import validate_pdf_timestamp
    from pyhanko_certvalidator import ValidationContext

    progreso.iniciar('Solicitando sello de tiempo', estimado=config.TSA_TIMEOUT)
    progreso.comprobar_cancelacion()
    sellador = firma_digital.sellador({'sello_tiempo': True})
    try:
        with open(ruta, 'rb') as entrada, open(destino, 'w+b') as salida:
            escritor = IncrementalPdfFileWriter(entrada)
            signers.PdfTimeStamper(sellador, field_name=f'MarcaTiempo_{uuid4().hex}').timestamp_pdf(
                escritor, 'sha256', output=salida)
            progreso.comprobar_cancelacion()
            salida.seek(0)
            # Comprobar el resultado también: el nuevo campo debe respetar DocMDP y FieldMDP.
            lector = PdfFileReader(salida)
            _comprobar_permisos(lector)
            contexto = ValidationContext(trust_roots=[], allow_fetching=False, revocation_mode='soft-fail')
            estado = validate_pdf_timestamp(lector.embedded_signatures[-1], contexto)
            if not (estado.intact and estado.valid):
                raise ApiError('La respuesta de la autoridad no contiene un sello de tiempo íntegro.', 422)
    except TimestampRequestError as err:
        raise ApiError('No se ha podido obtener el sello de tiempo: la autoridad de sellado '
                       'no responde o ha rechazado la solicitud. Vuelve a intentarlo.', 504) from err
    except (ValueError, KeyError) as err:
        raise ApiError('La autoridad ha devuelto una respuesta de sellado no válida.', 502) from err
    except SigningError as err:
        raise ApiError('No se ha podido añadir el sello de tiempo a este PDF.', 422) from err
