"""Herramienta: sacar a Excel o a CSV las tablas de un PDF.

El caso es el de siempre: llega una factura, un balance o un listado en PDF y
hay que operar con esos números. Copiar y pegar de un PDF devuelve una columna
de texto pegado, así que se acaba tecleando a mano.

La detección la hace `find_tables()` de PyMuPDF, y **qué cuenta como tabla** lo
decide `pdf_estructura.merece_ser_tabla`, el mismo criterio que usa «Documento a
Markdown». Escribir el archivo es cosa de `api/tablas.py`, que es donde está la
única decisión delicada: qué celda se convierte en número y cuál se queda como
texto.

**Lo que no hace, y la pantalla lo dice**: las tablas que no están dibujadas,
las que se alinean sólo con espacios, no se detectan. Reconocerlas «casi
siempre» significaría entregar de vez en cuando una tabla inventada, y con una
hoja de cálculo eso no se nota hasta que alguien ha trabajado sobre ella.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, limites, params, progreso, tablas
from api.pdf_estructura import merece_ser_tabla
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('extraer_tablas', __name__, url_prefix='/api/tools')

FORMATOS = {'xlsx': '.xlsx', 'csv': '.csv'}

PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Un tope de sensatez: por encima de esto no hay un documento con tablas, hay un
# PDF lleno de rejillas, y el libro resultante no lo abriría nadie.
MAXIMO_TABLAS = 300


@bp.post('/extraer-tablas/inspeccionar')
@limites.con_plazo(limites.PLAZO_AUXILIAR, 'La búsqueda de tablas')
def inspeccionar():
    """Qué tablas hay y dónde, sin escribir nada.

    Es lo que evita ejecutar a ciegas: si el PDF maqueta sus tablas con espacios
    —que es la mitad de los PDF— aquí sale un cero, y el mensaje lo explica en
    vez de devolver un archivo vacío.
    """
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=1, mensaje='Selecciona un PDF.')

    ruta, _ = _documento(session_id, file_ids[0])
    with fitz.open(ruta) as documento:
        _comprobar_abierto(documento)
        encontradas = _tablas_del_documento(documento)

    return jsonify({
        'total': len(encontradas),
        'tablas': [{'pagina': pagina, 'filas': len(filas),
                    'columnas': max((len(f) for f in filas), default=0)}
                   for pagina, filas in encontradas],
    })


@bp.post('/extraer-tablas')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La extracción')
def extraer_tablas():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    formato = params.opcion(datos, 'formato', FORMATOS, 'xlsx')

    ruta, record = _documento(session_id, file_ids[0])
    with fitz.open(ruta) as documento:
        _comprobar_abierto(documento)
        encontradas = _tablas_del_documento(documento)

    if not encontradas:
        raise ApiError(
            'No se ha encontrado ninguna tabla dibujada en este PDF. Si sus tablas están '
            'alineadas sólo con espacios, no se pueden distinguir del texto corriente. '
            'Y si es un escaneado, pásalo antes por "PDF con OCR".', 422)

    base = os.path.splitext(nombre_seguro(record.name))[0]
    if formato == 'csv':
        return jsonify({'files': _un_csv_por_tabla(session_id, base, encontradas)}), 201
    return jsonify({'files': [_un_libro(session_id, base, encontradas)]}), 201


def _un_libro(session_id: str, base: str, encontradas: list) -> dict:
    """Todas las tablas en un `.xlsx`, una hoja por tabla."""
    destino, salida = storage.reserve_output(session_id, f'{base}-tablas.xlsx')
    tablas.a_xlsx([(_nombre(pagina, indice, encontradas), filas)
                   for indice, (pagina, filas) in enumerate(encontradas, start=1)], destino)
    return storage.commit_output(session_id, salida).to_json()


def _un_csv_por_tabla(session_id: str, base: str, encontradas: list) -> list:
    """Un `.csv` por tabla. La lista de resultados ya sabe empaquetarlos en ZIP."""
    ancho = len(str(len(encontradas)))
    resultados = []
    for indice, (pagina, filas) in enumerate(encontradas, start=1):
        nombre = f'{base}-pagina-{pagina}-tabla-{indice:0{ancho}d}.csv'
        destino, salida = storage.reserve_output(session_id, nombre)
        with open(destino, 'wb') as archivo:
            archivo.write(tablas.a_csv(filas))
        resultados.append(storage.commit_output(session_id, salida).to_json())
    return resultados


def _nombre(pagina: int, indice: int, encontradas: list) -> str:
    """Cómo se llama la hoja. El número de tabla sólo se pone si hay varias."""
    en_la_pagina = sum(1 for otra, _ in encontradas if otra == pagina)
    return f'Página {pagina}' if en_la_pagina == 1 else f'Página {pagina} · {indice}'


def _documento(session_id: str, file_id: str):
    record = storage.record_of(session_id, file_id)
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    return storage.path_of(session_id, file_id), record


def _comprobar_abierto(documento) -> None:
    if documento.needs_pass:
        raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)
    if documento.page_count == 0:
        raise ApiError('El PDF no tiene páginas.', 422)


def _tablas_del_documento(documento) -> list:
    """Las tablas que merecen serlo, en orden de lectura, como `(página, filas)`."""
    encontradas = []
    for numero, pagina in progreso.contando(enumerate(documento, start=1),
                                            documento.page_count, 'Buscando tablas'):
        for filas in _tablas_de_pagina(pagina):
            encontradas.append((numero, filas))
            if len(encontradas) > MAXIMO_TABLAS:
                raise ApiError(
                    f'Este PDF tiene más de {MAXIMO_TABLAS} tablas. Divídelo primero con '
                    '"Dividir PDF" y saca las de cada parte.', 413)
    return encontradas


def _tablas_de_pagina(pagina) -> list:
    try:
        candidatas = pagina.find_tables().tables
    except Exception:  # noqa: BLE001 — una detección fallida no debe tumbar la extracción
        return []

    resultado = []
    for candidata in candidatas:
        filas = [[celda if celda is not None else '' for celda in fila]
                 for fila in candidata.extract()]
        llenas = [str(celda) for fila in filas for celda in fila if str(celda).strip()]
        if not llenas:
            continue
        if not merece_ser_tabla(candidata.col_count, candidata.row_count, len(llenas),
                                max(celda.count('\n') + 1 for celda in llenas)):
            continue
        resultado.append(filas)
    return resultado
