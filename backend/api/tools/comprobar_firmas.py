"""Herramienta: comprobar las firmas digitales de un PDF.

Es la mitad que suele faltar. Firmar se puede firmar de muchas maneras, pero
cuando te llega un PDF que dice venir firmado, averiguar si es verdad exige
subirlo a una web ajena —justo el documento que más motivos hay para no
enseñar—. Aquí se comprueba en casa.

Contesta a cuatro preguntas, por orden de importancia:

1. ¿Está **intacta**? Es decir, ¿los bytes que se firmaron son los que hay.
2. ¿**Cubre todo el archivo**, o alguien añadió algo después? Una firma puede
   estar perfectamente intacta y aun así referirse sólo a las primeras páginas.
3. ¿**Quién** dice haber firmado, y cuándo.
4. ¿Estaba **vigente** su certificado en ese momento.

Lo que **no** contesta, y la pantalla lo dice con todas las letras: si el
firmante es de verdad quien dice ser. Para eso habría que contrastar el
certificado con las listas de confianza europeas, que exige conexión y
mantenerlas al día. Se identifica al firmante; no se le acredita.

No genera ningún archivo, así que —única herramienta que se sale del molde— no
tiene endpoint principal ni botón de ejecutar: el informe se pide en cuanto el
archivo está subido, como la inspección de "Limpiar metadatos".
"""
import logging

from flask import Blueprint, jsonify

from api import current_session, firma_digital, params
from errors import ApiError
from storage import storage

bp = Blueprint('comprobar_firmas', __name__, url_prefix='/api/tools')

# Cómo de lejos llega la firma dentro del archivo.
COBERTURAS = {
    'ENTIRE_FILE': 'todo',
    'ENTIRE_REVISION': 'revision',
}

# Qué se añadió después de firmar, de menos a más grave.
CAMBIOS = {
    'NONE': 'nada',
    'LTA_UPDATES': 'datos de validación',
    'FORM_FILLING': 'campos de formulario rellenados',
    'ANNOTATIONS': 'anotaciones o comentarios',
    'OTHER': 'cambios en el contenido',
}


@bp.post('/comprobar-firmas/inspeccionar')
def inspeccionar():
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=1)

    informes = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF: sólo los PDF llevan firma.', 400)
        informes.append({
            'id': file_id,
            'archivo': record.name,
            'firmas': _firmas_de(storage.path_of(session_id, file_id), record.name),
        })
    return jsonify({'informes': informes})


def _firmas_de(ruta: str, nombre: str) -> list[dict]:
    from pyhanko.pdf_utils.reader import PdfFileReader

    with open(ruta, 'rb') as archivo:
        try:
            lector = PdfFileReader(archivo)
            firmadas = list(lector.embedded_signatures)
        except Exception as err:
            raise ApiError(f'No se ha podido leer "{nombre}": {err}', 422) from err
        return [_resumen(firma) for firma in firmadas]


def _resumen(firma) -> dict:
    """Lo que se sabe de una firma, ya en castellano y sin objetos de pyHanko."""
    from pyhanko.sign.validation import validate_pdf_signature, validate_pdf_timestamp
    from pyhanko_certvalidator import ValidationContext

    es_sello = firma.sig_object.get('/Type') == '/DocTimeStamp'
    certificado = firma.signer_cert
    datos = {
        'campo': firma.field_name,
        'tipo': 'sello_tiempo' if es_sello else 'firma',
        'firmante': firma_digital.nombre_de(certificado),
        'emisor': firma_digital.emisor_de(certificado),
        'autofirmado': certificado.self_signed != 'no',
        'fecha': _fecha(firma.self_reported_timestamp),
        'sello_tiempo': None,
        'intacta': None,
        'cobertura': 'desconocida',
        'cambios': None,
        'vigente_al_firmar': None,
        'error': None,
    }

    # Sin raíces de confianza y sin red: se comprueba la integridad y la
    # cobertura, que es lo que se puede afirmar sin consultar a nadie.
    #
    # pyHanko avisa por el log de que no ha podido construir la cadena de
    # confianza. Aquí eso no es una anomalía, es la premisa, y sin callarlo cada
    # comprobación deja una traza de veinte líneas en el log del servidor.
    logging.getLogger('pyhanko.sign.validation.generic_cms').setLevel(logging.ERROR)

    contexto = ValidationContext(trust_roots=[], allow_fetching=False, revocation_mode='soft-fail')
    try:
        validar = validate_pdf_timestamp if es_sello else validate_pdf_signature
        estado = validar(firma, contexto)
    except Exception as err:
        datos['error'] = f'No se ha podido comprobar este sello: {err}' if es_sello else f'No se ha podido comprobar esta firma: {err}'
        return datos

    datos['intacta'] = bool(estado.intact and estado.valid) if es_sello else bool(estado.intact)
    datos['cobertura'] = COBERTURAS.get(getattr(estado.coverage, 'name', ''), 'parcial')
    if estado.modification_level is not None:
        datos['cambios'] = CAMBIOS.get(estado.modification_level.name, 'cambios desconocidos')
    if es_sello:
        datos['fecha'] = datos['sello_tiempo'] = _fecha(estado.timestamp)
        datos['vigente_al_firmar'] = _vigente(certificado, estado.timestamp)
        return datos
    if estado.timestamp_validity is not None:
        datos['sello_tiempo'] = _fecha(estado.timestamp_validity.timestamp)
    datos['vigente_al_firmar'] = _vigente(certificado, estado.signer_reported_dt)
    return datos


def _vigente(certificado, cuando) -> bool | None:
    """Si el certificado estaba en vigor el día que se firmó.

    Es la razón de ser del sello de tiempo: sin él, `cuando` sale del reloj de
    quien firmó y no demuestra nada, pero sigue valiendo para avisar de que la
    firma se hizo con un certificado ya caducado.
    """
    if cuando is None:
        return None
    return certificado.not_valid_before <= cuando <= certificado.not_valid_after


def _fecha(valor) -> str | None:
    return valor.isoformat() if valor is not None else None
