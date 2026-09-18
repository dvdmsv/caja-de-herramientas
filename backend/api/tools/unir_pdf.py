"""Herramienta: combinar varios PDF en uno solo, en el orden recibido."""
import fitz  # PyMuPDF
from flask import Blueprint, jsonify

from api import current_session, params, progreso
from errors import ApiError
from storage import storage

bp = Blueprint('unir_pdf', __name__, url_prefix='/api/tools')

SALIDA = 'documento-combinado.pdf'


@bp.post('/unir-pdf')
def unir_pdf():
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=2,
                          mensaje='Selecciona al menos dos PDF para combinar.')

    # Se resuelven todas las rutas antes de escribir nada, para fallar pronto.
    rutas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        rutas.append((record.name, storage.path_of(session_id, file_id)))

    destino, record = storage.reserve_output(session_id, SALIDA)
    salida = fitz.open()
    try:
        # El índice hay que rehacerlo a mano: `insert_pdf` copia páginas, enlaces
        # y campos, pero el índice es del documento, no de sus páginas, así que
        # se va acumulando con las páginas desplazadas.
        indice = []
        for nombre, ruta in progreso.contando(rutas, len(rutas), 'Uniendo documentos'):
            with _abrir(nombre, ruta) as origen:
                desplazamiento = salida.page_count
                # `widgets=True` conserva los campos de formulario, y es el
                # motivo por el que PyMuPDF tiene que ser 1.25.3 o posterior:
                # antes no existía el parámetro y los campos se perdían.
                salida.insert_pdf(origen, links=True, annots=True, widgets=True)
                for nivel, titulo, pagina in origen.get_toc():
                    indice.append([nivel, titulo, pagina + desplazamiento])
        if indice:
            salida.set_toc(indice)
        salida.save(destino, deflate=True, garbage=3)
    finally:
        salida.close()

    return jsonify({'files': [storage.commit_output(session_id, record).to_json()]}), 201


def _abrir(nombre: str, ruta: str) -> fitz.Document:
    """Abre un PDF diciendo qué archivo falla, que con varios importa."""
    try:
        documento = fitz.open(ruta)
    except Exception as err:  # PyMuPDF lanza distintos tipos según el destrozo
        raise ApiError(f'No se ha podido abrir "{nombre}": puede estar dañado.', 422) from err
    if documento.needs_pass:
        documento.close()
        raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422)
    return documento
