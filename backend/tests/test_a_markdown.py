"""«Documento a Markdown»: la vista previa que la página enseña para copiar sin
descargar. Una por documento, en el orden de la lista, y con un tope para todas
juntas: los archivos están para descargarlos, no para pasear megas por el JSON.
"""
import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('todo').test_client()


def convertir(cliente, documentos: dict[str, str], **opciones) -> dict:
    from storage import storage
    from tests.conftest import subida

    ids = [storage.save_upload(SESION, subida(texto.encode(), nombre)).id for nombre, texto in documentos.items()]
    respuesta = cliente.post('/api/tools/a-markdown', headers={'X-Session-Id': SESION},
                             json={'file_ids': ids, **opciones})
    assert respuesta.status_code == 201, respuesta.get_json()
    return respuesta.get_json()


DOCUMENTOS = {'uno.txt': 'Primero de todos', 'dos.txt': 'El segundo documento', 'tres.txt': 'Y el tercero'}


def test_con_varios_documentos_una_vista_por_cada_uno_en_orden(cliente):
    datos = convertir(cliente, DOCUMENTOS)

    vistas = datos['vistas_previas']
    assert [vista['nombre'] for vista in vistas] == list(DOCUMENTOS)
    assert [vista['texto'] for vista in vistas] == list(DOCUMENTOS.values())
    assert vistas[1]['palabras'] == 3 and vistas[1]['caracteres'] == len('El segundo documento')
    assert [f['name'] for f in datos['files']] == ['uno.md', 'dos.md', 'tres.md']


def test_al_unir_una_sola_vista_igual_que_el_archivo(cliente):
    from storage import storage

    datos = convertir(cliente, DOCUMENTOS, unir=True)

    [vista] = datos['vistas_previas']
    assert vista['nombre'] == 'documentos.md'
    assert vista['texto'].startswith('# uno.txt\n\nPrimero de todos\n\n# dos.txt')
    with open(storage.path_of(SESION, datos['files'][0]['id']), encoding='utf-8') as fh:
        # El archivo acaba en salto de línea, como todo archivo de texto.
        assert fh.read() == vista['texto'] + '\n'


def test_el_tope_es_de_todas_juntas_y_lo_que_no_cabe_va_sin_texto(cliente, monkeypatch):
    """Con sus cuentas, para que la página diga que es demasiado largo."""
    from api.tools import a_markdown

    monkeypatch.setattr(a_markdown, 'MAXIMO_VISTA_PREVIA', len('Primero de todos') + len('Y el tercero'))
    vistas = convertir(cliente, DOCUMENTOS)['vistas_previas']

    # El segundo ya no cabe; el tercero, más corto, sí.
    assert [vista['texto'] is not None for vista in vistas] == [True, False, True]
    assert vistas[1]['caracteres'] == len('El segundo documento')
