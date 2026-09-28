"""Herramienta: pasar un PDF a libro electrónico EPUB, para leerlo en un lector.

Un EPUB no tiene páginas: es texto que se adapta a la pantalla y al tamaño de
letra que elija quien lee. Así que lo que se convierte no es la maquetación del
PDF sino su **estructura**, que reconstruye `api/pdf_estructura.py` —la misma
que usa «Documento a Markdown»—: títulos, párrafos, listas, tablas y, aquí,
también las imágenes en su sitio. Con los títulos se parte en capítulos y se
hace el índice. El paquete lo escribe `api/epub.py`.

Lo que no puede hacer es inventarse el texto de un escaneado: si el PDF no tiene
texto, lo dice y manda a «PDF con OCR». La página lo sabe antes de convertir,
por `/inspeccionar`, que además trae el título y el autor de los metadatos.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, epub, limites, params, pdf_estructura, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('pdf_a_epub', __name__, url_prefix='/api/tools')

PLAZO_EN_PROCESO = config.entorno_entero('MARKDOWN_TIMEOUT_SECONDS', 120)

# Hasta dónde se mira si tiene texto al inspeccionar: con las primeras páginas
# basta para saber si es un escaneado, y así no se lee un libro entero para eso.
PAGINAS_A_MIRAR = 20

MAXIMO_METADATO = 300

# La portada: la primera página a este ancho, que es lo que suelen pedir las
# tiendas y lo que se ve bien en la biblioteca de cualquier lector.
ANCHO_PORTADA = 1200

ESCANEADO = ('Este PDF no tiene texto: es un escaneado, y lo que parecen letras son una imagen. '
             'Pásalo antes por "PDF con OCR" y vuelve aquí.')


@bp.post('/pdf-a-epub/inspeccionar')
@limites.con_plazo(limites.PLAZO_AUXILIAR, 'La lectura del PDF')
def inspeccionar():
    """Título, autor, páginas y si tiene texto, para rellenar el formulario."""
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=1, mensaje='Selecciona un PDF.')
    record, ruta = _pdf(session_id, file_ids[0])
    with _abrir(ruta, record.name) as documento:
        metadatos = documento.metadata or {}
        con_texto = any(pagina.get_text('text').strip()
                        for pagina in documento.pages(0, min(documento.page_count, PAGINAS_A_MIRAR)))
        return jsonify({
            'titulo': (metadatos.get('title') or '').strip() or _titulo_del_nombre(record.name),
            'autor': (metadatos.get('author') or '').strip(),
            'paginas': documento.page_count,
            'con_texto': con_texto,
        })


@bp.post('/pdf-a-epub')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La conversión a EPUB')
def pdf_a_epub():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    titulo = _texto(datos, 'titulo')
    autor = _texto(datos, 'autor')
    con_portada = params.booleano(datos, 'portada', True)

    record, ruta = _pdf(session_id, file_ids[0])
    with _abrir(ruta, record.name) as documento:
        portada = _portada(documento) if con_portada else None
        titulo = titulo or (documento.metadata or {}).get('title', '').strip() or _titulo_del_nombre(record.name)

    imagenes: dict[str, bytes] = {}
    with progreso.estimando('Leyendo la estructura del PDF', 10):
        texto = pdf_estructura.pdf_a_markdown(ruta, imagenes=imagenes)
    if not texto.strip():
        raise ApiError(ESCANEADO, 422)

    partes = epub.capitulos(texto, sin_titulo=titulo)
    capitulos = [(nombre, epub.a_xhtml(cuerpo))
                 for nombre, cuerpo in progreso.contando(partes, len(partes), 'Escribiendo los capítulos')]
    datos_epub = epub.construir(capitulos, imagenes, titulo, autor, portada=portada)

    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}.epub')
    with open(destino, 'wb') as archivo:
        archivo.write(datos_epub)
    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _pdf(session_id: str, file_id: str):
    record = storage.record_of(session_id, file_id)
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    return record, storage.path_of(session_id, file_id)


def _abrir(ruta: str, nombre: str) -> fitz.Document:
    try:
        documento = fitz.open(ruta)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err
    if documento.needs_pass:
        documento.close()
        raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422)
    if documento.page_count == 0:
        documento.close()
        raise ApiError(f'"{nombre}" no tiene páginas.', 422)
    return documento


def _texto(datos: dict, clave: str) -> str:
    valor = datos.get(clave) or ''
    if not isinstance(valor, str):
        raise ApiError(f'El campo "{clave}" no es válido.', 400)
    return ' '.join(valor.split())[:MAXIMO_METADATO]


def _titulo_del_nombre(nombre: str) -> str:
    """«informe_anual-2026.pdf» → «informe anual 2026»: mejor que «Sin título»."""
    base = os.path.splitext(nombre)[0]
    return ' '.join(base.replace('_', ' ').replace('-', ' ').split()) or 'Sin título'


def _portada(documento: fitz.Document) -> bytes:
    """La primera página como JPEG, que es la imagen de portada del libro."""
    pagina = documento[0]
    escala = ANCHO_PORTADA / max(pagina.rect.width, 1)
    limites.comprobar_lienzo(pagina.rect.width * escala, pagina.rect.height * escala, 'La portada')
    return pagina.get_pixmap(matrix=fitz.Matrix(escala, escala), alpha=False).tobytes('jpeg', jpg_quality=85)
