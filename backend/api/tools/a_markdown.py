"""Herramienta: pasar un documento a Markdown, pensado para dárselo a un LLM.

El trabajo lo hace markitdown (Microsoft), que conserva la estructura —títulos,
listas y tablas— en vez de escupir un chorro de texto plano. Admite PDF, Word,
Excel, PowerPoint y unos cuantos formatos de texto más.
"""
import os
import threading

from flask import Blueprint, jsonify

from api import current_session, params, pdf_estructura
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('a_markdown', __name__, url_prefix='/api/tools')

_convertidor = None
_candado = threading.Lock()


def _markitdown():
    """El conversor, construido la primera vez que alguien lo pide.

    Importar markitdown cuesta unos 120 MB de memoria porque arrastra
    onnxruntime para detectar tipos de archivo. Quien no use esta herramienta no
    debería pagar ese precio: hasta la primera conversión el backend se queda en
    unos 70 MB, y quien la use la paga una vez.

    Los plugins van desactivados a propósito: aquí no hay ninguno instalado y
    habilitarlos sólo abriría la puerta a ejecutar código de terceros.
    """
    global _convertidor
    with _candado:
        if _convertidor is None:
            from markitdown import MarkItDown
            _convertidor = MarkItDown(enable_plugins=False)
    return _convertidor

SALIDA_UNIDA = 'documentos.md'

# Por encima de esto no se manda la vista previa en la respuesta: el archivo
# está para descargarlo, no para pasear medio mega de texto por el JSON.
MAXIMO_VISTA_PREVIA = 1024 * 1024


@bp.post('/a-markdown')
def a_markdown():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un documento.')
    unir = params.booleano(datos, 'unir', False)

    convertidos = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        convertidos.append((record, _convertir(storage.path_of(session_id, file_id), record.name)))

    if unir and len(convertidos) > 1:
        # Cada documento bajo su propio título: quien lo lea, humano o modelo,
        # sabe dónde empieza y acaba cada uno.
        texto = '\n\n'.join(f'# {record.name}\n\n{markdown}' for record, markdown in convertidos)
        salidas = [_guardar(session_id, SALIDA_UNIDA, texto)]
    else:
        salidas = [_guardar(session_id, f'{_base(record.name)}.md', markdown)
                   for record, markdown in convertidos]
        texto = convertidos[0][1]

    respuesta = {'files': [salida.to_json() for salida in salidas]}
    if len(salidas) == 1 and len(texto) <= MAXIMO_VISTA_PREVIA:
        respuesta['vista_previa'] = {
            'texto': texto,
            'caracteres': len(texto),
            'palabras': len(texto.split()),
        }
    return jsonify(respuesta), 201


def _convertir(ruta: str, nombre: str) -> str:
    try:
        if os.path.splitext(ruta)[1].lower() == '.pdf':
            # Los PDF van por PyMuPDF, que ve tamaños, negritas y posiciones:
            # markitdown los lee como texto corrido (ver api/pdf_estructura.py).
            texto = pdf_estructura.pdf_a_markdown(ruta)
        else:
            texto = getattr(_markitdown().convert(ruta), 'text_content', '') or ''
    except Exception as err:
        raise ApiError(f'No se ha podido leer "{nombre}": {err}', 422) from err

    texto = texto.strip()
    if not texto:
        raise ApiError(
            f'"{nombre}" no tiene texto que extraer. Si es un PDF escaneado haría falta '
            'reconocimiento óptico de caracteres (OCR), que esta herramienta no hace.', 422)
    return texto


def _guardar(session_id: str, nombre: str, texto: str):
    destino, salida = storage.reserve_output(session_id, nombre)
    with open(destino, 'w', encoding='utf-8') as fichero:
        fichero.write(texto + '\n')
    return storage.commit_output(session_id, salida)


def _base(nombre: str) -> str:
    return os.path.splitext(nombre_seguro(nombre))[0]
