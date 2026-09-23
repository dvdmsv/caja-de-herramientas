"""Herramienta: pasar un PDF a escala de grises.

Para imprimir sin gastar tinta de color y para aligerar escaneados que se
hicieron en color sin necesidad. No se rasteriza nada: el texto sigue siendo
texto —se puede seleccionar y buscar— y los dibujos siguen siendo vectores;
sólo cambian los colores, y las imágenes pasan a tener un canal en vez de tres.

Lo hace Ghostscript, que ya está en la imagen por el OCR: reescribe el PDF
convirtiendo cada color a gris. La versión de PyMuPDF instalada (1.25) no sabe
hacerlo.
"""
import os
import shutil
import tempfile

import fitz  # PyMuPDF
from flask import Blueprint, current_app, jsonify

import config
from api import conversion, current_session, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('pdf_a_grises', __name__, url_prefix='/api/tools')

TIEMPO_LIMITE = config.entorno_entero('GRISES_TIMEOUT_SECONDS', 180)

# Lo que se le dice a quien espera. Ghostscript arranca rápido y lo que cuesta
# es reescribir cada página. Pendiente de medirlo con documentos reales;
# mientras, es una estimación.
ARRANQUE = 1.0
SEGUNDOS_POR_PAGINA = 0.3


@bp.post('/pdf-a-grises')
def pdf_a_grises():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un PDF.')

    # Se valida todo antes de convertir nada: si uno no sirve, mejor decirlo
    # antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        ruta = storage.path_of(session_id, file_id)
        entradas.append((record, ruta, _paginas(ruta, record.name)))

    resultados = []
    for record, origen, paginas in entradas:
        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-grises.pdf')
        with progreso.estimando(f'Pasando a grises «{record.name}»',
                                ARRANQUE + paginas * SEGUNDOS_POR_PAGINA):
            _convertir(origen, destino)
        if not os.path.isfile(destino) or os.path.getsize(destino) == 0:
            raise ApiError(f'No se ha podido convertir "{record.name}": puede estar dañado.', 422)
        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _paginas(ruta: str, nombre: str) -> int:
    """Cuántas páginas tiene, y de paso que se puede abrir y no lleva contraseña.

    Ghostscript con un PDF cifrado no da un error que se entienda: se mira antes.
    """
    try:
        with fitz.open(ruta) as documento:
            if documento.needs_pass:
                raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela antes.', 422)
            return documento.page_count
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err


def _convertir(origen: str, destino: str) -> None:
    # Se escribe en una carpeta temporal y se mueve al final: si Ghostscript se
    # corta a medias, en la sesión no queda un PDF roto con nombre de resultado.
    with tempfile.TemporaryDirectory() as temporal:
        provisional = os.path.join(temporal, 'grises.pdf')
        orden = [
            'gs', '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
            '-sDEVICE=pdfwrite',
            '-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray',
            # Sin esto Ghostscript «endereza» las páginas según hacia dónde va
            # el texto, y un apaisado a propósito saldría girado.
            '-dAutoRotatePages=/None',
            f'-sOutputFile={provisional}',
            origen,
        ]
        resultado = conversion.ejecutar(
            orden, TIEMPO_LIMITE, 'gs',
            'La conversión a grises no está disponible en este servidor.',
            trabajo='La conversión a grises')
        if resultado.returncode != 0 or not os.path.isfile(provisional):
            current_app.logger.warning('gs salió con %s: %s', resultado.returncode,
                                       (resultado.stderr or '').strip()[:500])
            raise ApiError('No se ha podido pasar el PDF a grises: puede estar dañado.', 422)
        # `move` y no `replace`: la carpeta temporal y la de la sesión pueden
        # estar en discos distintos, y ahí `replace` falla.
        shutil.move(provisional, destino)
