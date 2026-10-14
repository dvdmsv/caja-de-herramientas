"""Herramienta: aplanar un PDF.

Un formulario relleno y un subrayado no forman parte de la página: son objetos
que viven encima y que cualquiera puede cambiar o quitar con un lector normal.
Aplanar los dibuja **dentro** de la página y los borra como objetos, así que lo
que se ve pasa a ser lo que hay.

No tiene vuelta atrás, y es justo para lo que sirve: mandar un formulario
relleno sabiendo que nadie va a reescribirlo por el camino.

Si MuPDF no puede aplanar o guardar el archivo, se reconstruye con qpdf y se
intenta otra vez, una sola (`api/reconstruccion.py` cuenta el caso que lo
trajo). Lo reparado sólo se entrega si conserva los mismos campos, con sus
valores, y las mismas anotaciones que el original.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, current_app, jsonify

import config
from api import current_session, params, progreso, reconstruccion
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('aplanar_pdf', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos. Cubre también
# la reparación.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)


@bp.post('/aplanar-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El aplanado')
def aplanar_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un PDF.')
    campos = params.booleano(datos, 'campos', True)
    anotaciones = params.booleano(datos, 'anotaciones', True)
    firmados = params.booleano(datos, 'firmados', False)
    if not campos and not anotaciones:
        raise ApiError('Elige qué quieres aplanar: los campos, las anotaciones o las dos cosas.',
                       400)

    reservados = []
    reparados = []
    try:
        for file_id in progreso.contando(file_ids, len(file_ids), 'Aplanando documentos'):
            record = storage.record_of(session_id, file_id)
            if record.ext != '.pdf':
                raise ApiError(f'"{record.name}" no es un PDF.', 400)
            origen = storage.path_of(session_id, file_id)

            base = os.path.splitext(nombre_seguro(record.name))[0]
            destino, salida = storage.reserve_output(session_id, f'{base}-aplanado.pdf')
            reservados.append(salida)
            if _aplanar(origen, destino, record.name, campos, anotaciones, firmados,
                        storage.session_dir(session_id)):
                reparados.append(record.name)

        # Se confirman todos al final: si falla el tercero, los dos primeros no
        # se le devuelven a nadie y no deben quedarse ocupando la sesión.
        progreso.comprobar_cancelacion()
        resultados = [storage.commit_output(session_id, salida).to_json()
                      for salida in reservados]
    except BaseException:
        # `BaseException` para que tampoco quede nada tras agotarse el plazo.
        for salida in reservados:
            storage.descartar(session_id, salida)
        raise

    return jsonify({'files': resultados, 'reparados': reparados}), 201


def _aplanar(origen: str, destino: str, nombre: str, campos: bool, anotaciones: bool,
             firmados: bool, carpeta: str) -> bool:
    """Aplana `origen` en `destino`. Devuelve si hubo que repararlo antes."""
    huella = None
    try:
        documento = fitz.open(origen)
    except Exception as err:
        if _no_se_repara(err):
            raise
        current_app.logger.warning('MuPDF no abre "%s": %s', nombre, err)
    else:
        with documento:
            _comprobar(documento, nombre, firmados)
            huella = _huella(documento)
            try:
                _fijar(documento, destino, campos, anotaciones)
                return False
            except Exception as err:
                if _no_se_repara(err):
                    raise
                current_app.logger.warning('MuPDF no aplana "%s": %s; se reconstruye.',
                                           nombre, err)
        # Lo que dejara escrito el intento fallido no puede llegar a entregarse.
        _borrar(destino)

    progreso.comprobar_cancelacion()
    try:
        temporal = reconstruccion.reconstruir(origen, carpeta)
    except Exception as err:
        if _no_se_repara(err):
            raise
        current_app.logger.warning('qpdf no reconstruye "%s": %s', nombre, err)
        if huella is None:
            raise ApiError(f'"{nombre}" no se ha podido abrir: el archivo está dañado '
                           'o no es un PDF.', 422) from err
        raise _irreparable(nombre) from err

    try:
        try:
            reparado = fitz.open(temporal)
        except Exception as err:
            if _no_se_repara(err):
                raise
            raise ApiError(f'"{nombre}" no se ha podido abrir: el archivo está dañado '
                           'o no es un PDF.', 422) from err
        with reparado:
            _comprobar(reparado, nombre, firmados)
            if huella is not None and _huella(reparado) != huella:
                raise ApiError(f'No se ha podido aplanar "{nombre}" sin perder contenido: '
                               'su estructura interna está dañada y, al repararla, cambian '
                               'sus campos o sus anotaciones.', 422)
            try:
                _fijar(reparado, destino, campos, anotaciones)
            except Exception as err:
                if _no_se_repara(err):
                    raise
                current_app.logger.warning('MuPDF tampoco aplana "%s" reparado: %s', nombre, err)
                raise _irreparable(nombre) from err
    except BaseException:
        _borrar(destino)
        raise
    finally:
        _borrar(temporal)
    return True


def _fijar(documento, destino: str, campos: bool, anotaciones: bool) -> None:
    documento.bake(annots=anotaciones, widgets=campos)
    # `garbage=3` recoge lo que los campos dejan atrás —apariencias, fuentes
    # que ya no usa nadie— y que si no seguiría pesando.
    documento.save(destino, garbage=3, deflate=True, clean=True)


def _comprobar(documento, nombre: str, firmados: bool) -> None:
    if documento.needs_pass:
        raise ApiError(f'"{nombre}" está protegido con contraseña.', 422)
    # Cualquier reescritura invalida una firma, aplanes lo que aplanes. Antes
    # sólo lo decía un aviso genérico de la página; ahora hay que pedirlo.
    if not firmados and _firmado(documento):
        raise ApiError(f'"{nombre}" está firmado digitalmente y aplanarlo invalidaría la '
                       'firma. Si es lo que quieres, marca "Aplanar también los PDF '
                       'firmados".', 422)


def _firmado(documento) -> bool:
    """Si algún campo de firma lleva una firma dentro. Uno vacío no cuenta."""
    for pagina in documento:
        for widget in pagina.widgets(types=[fitz.PDF_WIDGET_TYPE_SIGNATURE]):
            if documento.xref_get_key(widget.xref, 'V')[0] != 'null':
                return True
            # El valor puede ir en el campo padre y no en el widget.
            tipo, padre = documento.xref_get_key(widget.xref, 'Parent')
            if tipo == 'xref' and documento.xref_get_key(int(padre.split()[0]), 'V')[0] != 'null':
                return True
    return False


def _huella(documento) -> list:
    """Lo que la reparación no puede cambiar: páginas, campos con su valor y anotaciones."""
    return [
        (sorted((w.field_name or '', w.field_type, str(w.field_value))
                for w in pagina.widgets()),
         sorted(a.type[1] for a in pagina.annots()))
        for pagina in documento
    ]


def _no_se_repara(err: BaseException) -> bool:
    """Los fallos que no son del archivo y que reparar sólo escondería.

    La cancelación es un `ApiError`; la falta de memoria y el disco lleno
    tienen su propia respuesta (413). `TiempoAgotado` ni llega aquí: es una
    `BaseException` y atraviesa los `except Exception`.
    """
    if isinstance(err, ApiError) or limites.es_falta_de_memoria(err):
        return True
    return isinstance(err, OSError) and limites.es_disco_lleno(err)


def _irreparable(nombre: str) -> ApiError:
    return ApiError(f'No se ha podido aplanar "{nombre}": su estructura interna está dañada '
                    'y ni reparándolo se ha podido guardar.', 422)


def _borrar(ruta: str) -> None:
    try:
        os.unlink(ruta)
    except FileNotFoundError:
        pass
