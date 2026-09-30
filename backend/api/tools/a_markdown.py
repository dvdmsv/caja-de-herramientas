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

# Lo más que se manda de vista previa en la respuesta, **sumando todos los
# documentos**: los archivos están para descargarlos, no para pasear megas de
# texto por el JSON. Los que ya no quepan van sin texto, sólo con sus cuentas.
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

    # (nombre que se enseña, archivo que se guarda, texto, bytes de lo que entró)
    if unir and len(convertidos) > 1:
        textos = [(SALIDA_UNIDA, SALIDA_UNIDA, _unidos(convertidos), sum(record.size for record, _ in convertidos))]
    else:
        textos = [(record.name, f'{_base(record.name)}.md', markdown, record.size) for record, markdown in convertidos]
    salidas = [_guardar(session_id, archivo, texto) for _, archivo, texto, _ in textos]

    respuesta = {'files': [salida.to_json() for salida in salidas + adjuntos],
                 'vistas_previas': _vistas_previas([(nombre, texto, original, salida.size)
                                                    for (nombre, _, texto, original), salida in zip(textos, salidas)])}
    return jsonify(respuesta), 201


def _unidos(convertidos) -> str:
    """Todos en uno, cada documento bajo su propio título: quien lo lea, humano o
    modelo, sabe dónde empieza y acaba cada uno. «Copiar todos» de la página
    hace lo mismo (`markdownUnido`, `pages/tools/a-markdown/vistas.ts`): si se
    cambia uno, el otro también."""
    return '\n\n'.join(f'# {record.name}\n\n{markdown}' for record, markdown in convertidos)


def _vistas_previas(textos: list[tuple[str, str, int, int]]) -> list[dict]:
    """Lo que la página enseña para copiar sin descargar, uno por documento y en
    el orden de la lista. Con texto mientras quepan en `MAXIMO_VISTA_PREVIA`
    entre todos; los demás, sólo con sus cuentas.

    `original` y `markdown` son bytes, para decir cuánto adelgaza: lo que se
    subió y el `.md` tal como se descarga, que es el mismo número que enseña la
    lista de resultados."""
    vistas, quedan = [], MAXIMO_VISTA_PREVIA
    for nombre, texto, original, markdown in textos:
        cabe = len(texto) <= quedan
        quedan -= len(texto) if cabe else 0
        vistas.append({'nombre': nombre, 'texto': texto if cabe else None,
                       'caracteres': len(texto), 'palabras': len(texto.split()),
                       'original': original, 'markdown': markdown})
    return vistas


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
