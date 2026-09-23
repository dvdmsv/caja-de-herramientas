"""Herramienta: pasar un documento a Markdown, pensado para dárselo a un LLM.

El trabajo lo hace markitdown (Microsoft), que conserva la estructura —títulos,
listas y tablas— en vez de escupir un chorro de texto plano. Admite PDF, Word,
Excel, PowerPoint, correos `.eml` y unos cuantos formatos de texto más.
"""
import os

from flask import Blueprint, jsonify

import config
from api import correo, current_session, params, pdf_estructura, progreso
from api.conversor_markdown import markitdown
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('a_markdown', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('MARKDOWN_TIMEOUT_SECONDS', 120)

SALIDA_UNIDA = 'documentos.md'

# Por encima de esto no se manda la vista previa en la respuesta: el archivo
# está para descargarlo, no para pasear medio mega de texto por el JSON.
MAXIMO_VISTA_PREVIA = 1024 * 1024


@bp.post('/a-markdown')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La extracción del texto')
def a_markdown():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un documento.')
    unir = params.booleano(datos, 'unir', False)

    convertidos = []
    correos = []
    for file_id in progreso.contando(file_ids, len(file_ids),
                                       'Extrayendo el contenido'):
        record = storage.record_of(session_id, file_id)
        ruta = storage.path_of(session_id, file_id)
        limites.comprobar_descomprimido(ruta, record.name)
        if record.ext in correo.EXTENSIONES:
            mensaje = correo.leer(ruta, record.name)
            correos.append(mensaje)
            convertidos.append((record, correo.a_markdown(mensaje)))
        else:
            convertidos.append((record, _convertir(ruta, record.name)))

    # Los adjuntos se guardan al final: si un documento del lote falla, no
    # quedan sueltos los de los correos que iban antes.
    adjuntos = [guardado for mensaje in correos
                for guardado in correo.guardar_adjuntos(session_id, mensaje)]

    if unir and len(convertidos) > 1:
        # Cada documento bajo su propio título: quien lo lea, humano o modelo,
        # sabe dónde empieza y acaba cada uno.
        texto = '\n\n'.join(f'# {record.name}\n\n{markdown}' for record, markdown in convertidos)
        salidas = [_guardar(session_id, SALIDA_UNIDA, texto)]
    else:
        salidas = [_guardar(session_id, f'{_base(record.name)}.md', markdown)
                   for record, markdown in convertidos]
        texto = convertidos[0][1]

    respuesta = {'files': [salida.to_json() for salida in salidas + adjuntos]}
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
            texto = getattr(markitdown().convert(ruta), 'text_content', '') or ''
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
