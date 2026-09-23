"""Herramienta: convertir un documento de oficina a PDF.

Textos (Word, el .docx de ahora y el .doc de antes, OpenDocument, RTF y texto
plano), hojas de cálculo (Excel y ODS) y presentaciones (PowerPoint y ODP). El
trabajo lo hace LibreOffice sin interfaz, que es lo único capaz de respetar
estilos, tablas, imágenes y saltos de página de un documento de Office; pandoc
reescribe el documento y la maquetación se queda por el camino.

Una hoja de cálculo sale paginada como la imprimiría LibreOffice: cada hoja
con sus áreas de impresión, si las tiene, o entera si no. Una presentación sale
con una diapositiva por página.

Se lanza como proceso aparte, igual que ocrmypdf: se puede cortar por tiempo y
su memoria vuelve entera al terminar, que en esta VM importa. Todo el lote va en
**una sola llamada** porque arrancar LibreOffice cuesta varios segundos y
convertir cada documento, décimas.
"""
import os
import shutil
import tempfile

from flask import Blueprint, current_app, jsonify

import config
from api import limites
from api import conversion, current_session, params, progreso
from errors import ApiError
from storage import storage, cambiar_extension

bp = Blueprint('documento_a_pdf', __name__, url_prefix='/api/tools')

EXTENSIONES_ADMITIDAS = {
    '.docx', '.doc', '.odt', '.rtf', '.txt',     # textos
    '.xlsx', '.xls', '.ods',                     # hojas de cálculo
    '.pptx', '.ppt', '.odp',                     # presentaciones
}

# Sin tope de archivos: el lote entero va en una sola llamada a LibreOffice, con
# el plazo de aquí abajo. Si se pasa, se corta y se dice cuánto ha tardado.
#
# De sobra para el lote entero, contando el arranque de LibreOffice.
TIEMPO_LIMITE = config.entorno_entero('DOC_TO_PDF_TIMEOUT_SECONDS', 180)


# Lo que se le dice a quien espera que va a tardar. El arranque de LibreOffice
# es un coste fijo que se paga aunque el documento sea una línea —por eso el lote
# entero va en una sola llamada—, y convertir cada documento, una fracción.
# Pendiente de medirlo en el contenedor; mientras, la barra va por detrás.
ARRANQUE = 6.0
SEGUNDOS_POR_DOCUMENTO = 1.5


@bp.post('/documento-a-pdf')
def documento_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un documento.')

    # Se resuelve y valida todo antes de convertir nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in EXTENSIONES_ADMITIDAS:
            raise ApiError(
                f'"{record.name}" no es un documento de oficina. Se admiten '
                f'{", ".join(sorted(EXTENSIONES_ADMITIDAS))}.', 400)
        ruta = storage.path_of(session_id, file_id)
        # Un .docx o un .odt son un ZIP: lo que importa es lo que traen dentro.
        limites.comprobar_descomprimido(ruta, record.name)
        entradas.append((record, ruta))

    resultados = []
    with tempfile.TemporaryDirectory() as temporal:
        with progreso.estimando('Convirtiendo con LibreOffice',
                                ARRANQUE + len(entradas) * SEGUNDOS_POR_DOCUMENTO):
            _convertir([origen for _, origen in entradas], temporal)

        for record, origen in entradas:
            # LibreOffice nombra la salida como el archivo de entrada, que en
            # disco se llama `<id><ext>`. El nombre bonito lo pone el registro.
            generado = os.path.join(temporal, os.path.splitext(os.path.basename(origen))[0] + '.pdf')
            if not os.path.isfile(generado):
                raise ApiError(f'No se ha podido convertir "{record.name}": puede estar dañado '
                               'o protegido con contraseña.', 422)
            destino, salida = storage.reserve_output(
                session_id, cambiar_extension(record.name, '.pdf'))
            shutil.move(generado, destino)
            resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _convertir(origenes: list[str], carpeta_salida: str) -> None:
    """Pasa todos los documentos a PDF de una tacada."""
    # Perfil de usuario propio y desechable: LibreOffice se niega a arrancar dos
    # veces sobre el mismo, y aquí las peticiones vienen seguidas.
    with tempfile.TemporaryDirectory() as perfil:
        orden = [
            'soffice', '--headless', '--norestore', '--nolockcheck',
            f'-env:UserInstallation=file://{perfil}',
            # Sin filtro: cada tipo de documento necesita el suyo (Writer,
            # Calc, Impress) y LibreOffice elige el que toca.
            '--convert-to', 'pdf',
            '--outdir', carpeta_salida,
            *origenes,
        ]
        resultado = conversion.ejecutar(
            orden, TIEMPO_LIMITE, 'soffice',
            'La conversión a PDF no está disponible en este servidor.')

    # El código de salida de LibreOffice no es de fiar: devuelve 0 aunque no
    # haya escrito nada. Quien decide es la existencia del PDF, que comprueba
    # quien llama; esto sólo deja rastro para el registro.
    if resultado.returncode != 0:
        current_app.logger.warning('soffice salió con %s: %s', resultado.returncode,
                                   (resultado.stderr or '').strip()[:500])
