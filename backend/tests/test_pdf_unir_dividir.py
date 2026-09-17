"""Unir y dividir sin perder lo que el PDF lleva dentro.

Un PDF no son sólo páginas: tiene índice, enlaces internos y, si es un
formulario, campos rellenables. Copiar las páginas sueltas los pierde, y se
pierde en silencio: el archivo se abre igual y sólo se nota cuando alguien busca
el índice o pulsa un enlace.

Medido con pypdf 4.3.1, que es lo que se usaba antes: al **unir** conservaba
todo, pero al **dividir** dejaba el documento sin índice y con el enlace interno
apuntando a la página equivocada.
"""
import fitz
import pytest

from tests.conftest import SESION


def documento_completo(ruta, titulo='Doc'):
    """Un PDF de tres páginas con índice, un enlace interno y un campo."""
    d = fitz.open()
    for i in range(3):
        pagina = d.new_page()
        pagina.insert_text((72, 100), f'{titulo} · página {i + 1}', fontsize=14)
    # De la página 1 a la 3.
    d[0].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(72, 150, 250, 170), 'page': 2})
    campo = fitz.Widget()
    campo.field_name = f'nombre_{titulo}'
    campo.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    campo.rect = fitz.Rect(72, 200, 300, 225)
    campo.field_value = 'valor'
    d[1].add_widget(campo)
    d.set_toc([[1, f'{titulo}: inicio', 1], [2, f'{titulo}: detalle', 3]])
    d.save(str(ruta), deflate=True)
    d.close()
    return str(ruta)


def inventario(ruta):
    with fitz.open(ruta) as d:
        return {
            'paginas': d.page_count,
            'indice': d.get_toc(),
            'enlaces': [(p.number + 1, l.get('page')) for p in d
                        for l in p.get_links() if l['kind'] == fitz.LINK_GOTO],
            'campos': sorted(w.field_name for p in d for w in p.widgets()),
        }


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def subir(ruta):
    """Mete el archivo en la sesión como si lo hubiera subido el navegador."""
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        return storage.save_upload(SESION, subida(fh.read(), ruta.split('/')[-1])).id


def test_unir_conserva_indice_enlaces_y_formularios(cliente, tmp_path):
    uno = documento_completo(tmp_path / 'uno.pdf', 'Uno')
    dos = documento_completo(tmp_path / 'dos.pdf', 'Dos')
    ids = [subir(uno), subir(dos)]

    respuesta = cliente.post('/api/tools/unir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': ids})
    assert respuesta.status_code == 201

    from storage import storage
    salida = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    datos = inventario(salida)

    assert datos['paginas'] == 6
    # El índice del segundo documento se desplaza detrás del primero.
    assert datos['indice'] == [[1, 'Uno: inicio', 1], [2, 'Uno: detalle', 3],
                               [1, 'Dos: inicio', 4], [2, 'Dos: detalle', 6]]
    # Cada enlace sigue apuntando a su propia página 3, ya desplazada.
    assert datos['enlaces'] == [(1, 2), (4, 5)]
    assert datos['campos'] == ['nombre_Dos', 'nombre_Uno']


def test_dividir_conserva_indice_y_enlace(cliente, tmp_path):
    """Es lo que se perdía: sin índice y con el enlace a la página 0."""
    origen = documento_completo(tmp_path / 'origen.pdf', 'Uno')
    file_id = subir(origen)

    respuesta = cliente.post('/api/tools/dividir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], 'modo': 'unico', 'paginas': '1,3'})
    assert respuesta.status_code == 201

    from storage import storage
    salida = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    datos = inventario(salida)

    assert datos['paginas'] == 2
    assert datos['indice'] == [[1, 'Uno: inicio', 1], [2, 'Uno: detalle', 2]]
    # La página 3 del original es ahora la 2: el destino se reajusta.
    assert datos['enlaces'] == [(1, 1)]


def test_dividir_por_pagina_no_arrastra_el_recorte_anterior(cliente, tmp_path):
    """Cada archivo sale del original, no del recorte de antes."""
    origen = documento_completo(tmp_path / 'origen.pdf')
    file_id = subir(origen)

    respuesta = cliente.post('/api/tools/dividir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], 'modo': 'por-pagina', 'paginas': '1-3'})
    assert respuesta.status_code == 201
    from storage import storage
    salidas = respuesta.get_json()['files']
    assert len(salidas) == 3
    for salida in salidas:
        assert inventario(storage.path_of(SESION, salida['id']))['paginas'] == 1


def test_el_campo_de_formulario_viaja_con_su_pagina(cliente, tmp_path):
    origen = documento_completo(tmp_path / 'origen.pdf', 'Form')
    file_id = subir(origen)

    respuesta = cliente.post('/api/tools/dividir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], 'modo': 'unico', 'paginas': '2'})
    from storage import storage
    salida = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    assert inventario(salida)['campos'] == ['nombre_Form']


def test_un_pdf_protegido_se_rechaza_diciendo_cual(cliente, tmp_path):
    protegido = tmp_path / 'protegido.pdf'
    d = fitz.open()
    d.new_page().insert_text((72, 100), 'secreto')
    d.save(str(protegido), encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='x', user_pw='x')
    d.close()
    normal = documento_completo(tmp_path / 'normal.pdf')

    ids = [subir(normal), subir(str(protegido))]
    respuesta = cliente.post('/api/tools/unir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': ids})

    assert respuesta.status_code == 422
    assert 'protegido.pdf' in respuesta.get_json()['error']
