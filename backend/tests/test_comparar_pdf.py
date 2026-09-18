"""Comparar dos PDF de punta a punta: entra JSON y sale un informe en PDF.

Se lee el texto del informe con PyMuPDF, que es la única forma honrada de
comprobar que lo que cuenta es lo que ha pasado.
"""
import fitz
import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def documento(ruta, parrafos):
    """Un PDF con un párrafo por página."""
    archivo = fitz.open()
    for texto in parrafos:
        pagina = archivo.new_page()
        pagina.insert_text((72, 100), texto, fontsize=14)
    archivo.save(str(ruta), deflate=True)
    archivo.close()
    return str(ruta)


def subir(ruta):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fichero:
        return storage.save_upload(SESION, subida(fichero.read(), ruta.split('/')[-1])).id


def comparar(cliente, antes, despues, **opciones):
    return cliente.post('/api/tools/comparar-pdf', headers={'X-Session-Id': SESION},
                        json={'file_ids': [subir(antes), subir(despues)], **opciones})


def informe(respuesta) -> str:
    """El texto del informe en una sola línea: lo maqueta WeasyPrint, así que
    dónde parte los renglones no es asunto de estos tests."""
    from storage import storage
    assert respuesta.status_code == 201, respuesta.get_json()
    ruta = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    with fitz.open(ruta) as archivo:
        return ' '.join(' '.join(pagina.get_text().split()) for pagina in archivo)


def test_un_parrafo_distinto_aparece_en_el_informe(cliente, tmp_path):
    antes = documento(tmp_path / 'antes.pdf', ['Primera pagina', 'El plazo es de diez dias'])
    despues = documento(tmp_path / 'despues.pdf', ['Primera pagina', 'El plazo es de tres dias'])

    respuesta = comparar(cliente, antes, despues)
    texto = informe(respuesta)

    assert 'diez dias' in texto and 'tres dias' in texto
    assert respuesta.get_json()['comparacion']['cambiadas'] == 1
    assert respuesta.get_json()['comparacion']['identicos'] is False


def test_una_pagina_de_mas_sale_como_anadida(cliente, tmp_path):
    antes = documento(tmp_path / 'antes.pdf', ['Uno', 'Dos'])
    despues = documento(tmp_path / 'despues.pdf', ['Uno', 'Uno y medio', 'Dos'])

    respuesta = comparar(cliente, antes, despues)

    cuentas = respuesta.get_json()['comparacion']
    assert cuentas['anadidas'] == 1
    assert cuentas['iguales'] == 2
    assert 'añadida' in informe(respuesta)


def test_una_pagina_de_menos_sale_como_quitada(cliente, tmp_path):
    antes = documento(tmp_path / 'antes.pdf', ['Uno', 'Dos', 'Tres'])
    despues = documento(tmp_path / 'despues.pdf', ['Uno', 'Tres'])

    respuesta = comparar(cliente, antes, despues)

    assert respuesta.get_json()['comparacion']['quitadas'] == 1
    assert 'quitada' in informe(respuesta)


def test_dos_documentos_identicos_lo_dicen_y_no_enseñan_paginas(cliente, tmp_path):
    antes = documento(tmp_path / 'antes.pdf', ['Uno', 'Dos'])
    despues = documento(tmp_path / 'despues.pdf', ['Uno', 'Dos'])

    respuesta = comparar(cliente, antes, despues)

    assert respuesta.get_json()['comparacion']['identicos'] is True
    texto = informe(respuesta)
    assert 'dicen lo mismo' in texto
    assert 'Página a página' not in texto


def test_un_cambio_que_no_toca_ninguna_letra_se_ve_igual(cliente, tmp_path):
    """Un sello o un logotipo nuevo no cambian el texto, y hay que enseñarlos."""
    antes = documento(tmp_path / 'antes.pdf', ['Contrato'])

    archivo = fitz.open(str(antes))
    archivo[0].draw_rect(fitz.Rect(200, 300, 400, 420), color=(0, 0, 0), fill=(0.1, 0.1, 0.1))
    ruta = str(tmp_path / 'despues.pdf')
    archivo.save(ruta, deflate=True)
    archivo.close()

    respuesta = comparar(cliente, antes, ruta)

    cuentas = respuesta.get_json()['comparacion']
    assert cuentas['cambiadas'] == 1, 'el texto es el mismo, pero la página no'
    assert cuentas['diferencias'] == 0
    assert 'Lo que cambia se ve, pero no se lee' in informe(respuesta)


def test_hacen_falta_dos_documentos(cliente, tmp_path):
    uno = documento(tmp_path / 'uno.pdf', ['Uno'])

    respuesta = cliente.post('/api/tools/comparar-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [subir(uno)]})

    assert respuesta.status_code == 400


def test_tres_documentos_tambien_se_rechazan(cliente, tmp_path):
    ids = [subir(documento(tmp_path / f'{n}.pdf', ['Uno'])) for n in range(3)]

    respuesta = cliente.post('/api/tools/comparar-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': ids})

    assert respuesta.status_code == 400
    assert 'exactamente dos' in respuesta.get_json()['error']


def test_lo_que_no_es_un_pdf_se_rechaza(cliente, tmp_path):
    from storage import storage

    from tests.conftest import subida
    uno = subir(documento(tmp_path / 'uno.pdf', ['Uno']))
    otro = storage.save_upload(SESION, subida(b'hola', 'notas.txt')).id

    respuesta = cliente.post('/api/tools/comparar-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [uno, otro]})

    assert respuesta.status_code == 400
    assert 'no es un PDF' in respuesta.get_json()['error']
