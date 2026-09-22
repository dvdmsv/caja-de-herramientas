"""Herramienta: convertir un PDF al formato de archivado PDF/A.

Es lo que piden muchas sedes electrónicas, registros y juzgados, y lo que casi
nadie sabe cómo producir: un PDF/A lleva **dentro** todo lo que hace falta para
volver a verlo igual dentro de veinte años —las fuentes incrustadas enteras, el
color con su perfil, ningún contenido que dependa de nada de fuera—.

Lo hace ocrmypdf, que para esto es una envoltura de Ghostscript, y los dos ya
estaban en la imagen porque los pide «PDF con OCR». Lo que comparten las dos
herramientas está en `api/ocrmypdf.py`.

**Convertir no es certificar, y la pantalla lo dice.** Aquí se convierte y se
comprueba que el archivo resultante *declara* el perfil (su XMP trae
`pdfaid:part`), que es lo que mira una sede al recibirlo. Demostrar la
conformidad de verdad es otra cosa: exige veraPDF, que es Java y unos 200 MB, y
se ha decidido no meterlo. Prometer una validación que no se hace sería peor que
no ofrecerla.

Y como cualquier reescritura del documento, **invalida una firma que ya tuviera**
—la regla de siempre: firmar es lo último—.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, ocrmypdf, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('pdf_a_pdfa', __name__, url_prefix='/api/tools')

# Los dos perfiles que piden las administraciones. El 1b es el más estricto —ni
# transparencias ni adjuntos— y el 2b, el que acepta casi todo el mundo hoy.
PERFILES = {'1b': 'pdfa-1', '2b': 'pdfa-2'}

IDIOMAS = {'spa', 'eng', 'spa+eng'}

TIEMPO_LIMITE = config.entorno_entero('PDFA_TIMEOUT_SECONDS', 240)

# Nivel 1 de ocrmypdf: sólo optimizaciones **sin pérdida**. Para archivar, el
# tamaño importa menos que no tocar ni un píxel, así que no se sube de aquí.
OPTIMIZACION = 1

# Lo que sólo significa esto aquí; el resto lo traduce `api/ocrmypdf.py`.
ERRORES = {
    6: ('El PDF ya tiene texto, así que no hace falta reconocerlo: desmarca '
        '"reconocer el texto" y vuelve a intentarlo.', 400),
}

# Sin pasos que contar: ocrmypdf es una sola llamada. El porcentaje lo anima el
# navegador con esta estimación. Sale de la medición del OCR, rebajada porque
# convertir sin reconocer es bastante más rápido que reconocer.
SEGUNDOS_POR_PAGINA = 0.4
SEGUNDOS_POR_PAGINA_CON_OCR = 0.9



@bp.post('/pdf-a-pdfa')
def pdf_a_pdfa():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un PDF.')
    perfil = params.opcion(datos, 'perfil', PERFILES, '2b')
    con_ocr = params.booleano(datos, 'ocr', False)
    idioma = params.opcion(datos, 'idioma', IDIOMAS, 'spa+eng')

    # Se valida todo el lote antes de convertir nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        ruta = storage.path_of(session_id, file_id)
        entradas.append((record, ruta, _paginas(ruta, record.name)))

    por_pagina = SEGUNDOS_POR_PAGINA_CON_OCR if con_ocr else SEGUNDOS_POR_PAGINA
    estimado = sum(paginas for _, _, paginas in entradas) * por_pagina

    resultados = []
    with progreso.estimando(f'Convirtiendo a PDF/A-{perfil}', estimado):
        for record, origen, _ in entradas:
            base = os.path.splitext(nombre_seguro(record.name))[0]
            destino, salida = storage.reserve_output(session_id, f'{base}-pdfa.pdf')
            _convertir(origen, destino, perfil, con_ocr, idioma)
            _comprobar_declaracion(destino, perfil)
            resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _paginas(ruta: str, nombre: str) -> int:
    try:
        with fitz.open(ruta) as documento:
            if documento.needs_pass:
                raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.',
                               422)
            if documento.page_count == 0:
                raise ApiError(f'"{nombre}" no tiene páginas.', 422)
            return documento.page_count
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err


def _convertir(origen: str, destino: str, perfil: str, con_ocr: bool, idioma: str) -> None:
    opciones = [
        '--output-type', PERFILES[perfil],
        '--optimize', str(OPTIMIZACION),
        '--quiet',
        # Las páginas que ya traen texto se dejan en paz. Sin esto, ocrmypdf se
        # niega a seguir con un código 6 en cuanto encuentra una.
        '--skip-text',
    ]
    if con_ocr:
        opciones += ['--language', idioma]
    else:
        # Esto es lo que apaga el reconocimiento del todo y deja a ocrmypdf
        # haciendo sólo lo que aquí se le pide: la conversión a PDF/A.
        opciones += ['--tesseract-timeout', '0']

    ocrmypdf.ejecutar(
        opciones, origen, destino, TIEMPO_LIMITE,
        'La conversión a PDF/A no está disponible en este servidor.',
        trabajo='La conversión', errores=ERRORES,
        generico=('No se ha podido convertir el PDF al formato de archivado.', 422))


def _comprobar_declaracion(ruta: str, perfil: str) -> None:
    """Que el archivo diga de verdad qué perfil cumple.

    No es una validación de conformidad —eso es veraPDF—, pero sí descarta el
    caso que de otro modo pasaría inadvertido: que la conversión termine sin
    error y devuelva un PDF corriente. Entregar eso y llamarlo PDF/A haría que
    el rechazo llegara en la sede, que es el peor sitio para enterarse.

    **Se lee con pikepdf y no rebuscando en el XMP a mano.** El marcador se
    puede serializar de dos maneras igual de válidas —`pdfaid:part="2"` como
    atributo o `<pdfaid:part>2</pdfaid:part>` como elemento— y ocrmypdf lo
    escribe con pikepdf, que usa la segunda. Una expresión regular hecha para la
    primera daba por no declarado un PDF/A perfectamente marcado y tiraba la
    conversión entera. pikepdf ya está en la imagen, porque entra con ocrmypdf.
    """
    import pikepdf

    try:
        with pikepdf.open(ruta) as documento:
            meta = documento.open_metadata()
            parte = meta.get('pdfaid:part')
            conformidad = meta.get('pdfaid:conformance')
    except Exception as err:
        raise ApiError(f'No se ha podido leer el PDF convertido: {err}', 422) from err

    if not parte:
        raise ApiError(
            f'La conversión ha terminado pero el archivo no declara ningún perfil de '
            f'archivado. Puede que el documento de partida lleve algo que no cabe en '
            f'PDF/A-{perfil}; si has pedido 1b, prueba con 2b, que admite más cosas.', 422)

    declarado = f'{parte}{(conformidad or "").lower()}'
    if declarado != perfil:
        raise ApiError(
            f'Se ha pedido PDF/A-{perfil} y el archivo dice ser PDF/A-{declarado}. '
            'No se entrega algo que no es lo que se pidió.', 422)
