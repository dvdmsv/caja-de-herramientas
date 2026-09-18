"""Aplanar: lo que se ve pasa a ser lo que hay.

Un campo relleno y un subrayado viven **encima** de la página y cualquier lector
puede cambiarlos. Después de aplanar tienen que haber desaparecido como objetos
y seguir viéndose como parte de la página, que es lo que distingue aplanar de
borrar.
"""
import fitz
import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def formulario(ruta):
    """Un PDF con un campo de texto relleno y un subrayado."""
    documento = fitz.open()
    pagina = documento.new_page()
    pagina.insert_text((72, 100), 'Nombre del solicitante', fontsize=12)

    campo = fitz.Widget()
    campo.field_name = 'solicitante'
    campo.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    campo.rect = fitz.Rect(72, 120, 320, 145)
    campo.field_value = 'Ada Lovelace'
    pagina.add_widget(campo)

    pagina.add_highlight_annot(fitz.Rect(72, 90, 260, 110))
    documento.save(str(ruta), deflate=True)
    documento.close()
    return str(ruta)


def aplanar(cliente, ruta, **opciones):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        file_id = storage.save_upload(SESION, subida(fh.read(), 'formulario.pdf')).id

    respuesta = cliente.post('/api/tools/aplanar-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], **opciones})
    return respuesta


def inventario(ruta):
    with fitz.open(ruta) as documento:
        pagina = documento[0]
        return {
            'campos': [w.field_name for w in pagina.widgets()],
            'anotaciones': [a.type[1] for a in pagina.annots()],
            'texto': pagina.get_text(),
        }


def salida_de(respuesta):
    from storage import storage
    assert respuesta.status_code == 201, respuesta.get_json()
    return storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])


def test_el_campo_deja_de_ser_rellenable_y_su_valor_se_queda(cliente, tmp_path):
    origen = formulario(tmp_path / 'origen.pdf')
    antes = inventario(origen)
    assert antes['campos'] == ['solicitante']

    despues = inventario(salida_de(aplanar(cliente, origen)))

    assert despues['campos'] == []
    # El valor tiene que seguir viéndose: aplanar no es borrar.
    assert 'Ada Lovelace' in despues['texto']


def test_se_puede_aplanar_solo_los_campos(cliente, tmp_path):
    origen = formulario(tmp_path / 'origen.pdf')

    despues = inventario(salida_de(aplanar(cliente, origen, anotaciones=False)))

    assert despues['campos'] == []
    assert despues['anotaciones'] == ['Highlight']


def test_se_puede_aplanar_solo_las_anotaciones(cliente, tmp_path):
    origen = formulario(tmp_path / 'origen.pdf')

    despues = inventario(salida_de(aplanar(cliente, origen, campos=False)))

    assert despues['anotaciones'] == []
    assert despues['campos'] == ['solicitante']


def test_sin_marcar_nada_lo_dice_en_vez_de_devolver_una_copia(cliente, tmp_path):
    origen = formulario(tmp_path / 'origen.pdf')

    respuesta = aplanar(cliente, origen, campos=False, anotaciones=False)

    assert respuesta.status_code == 400
    assert 'Elige' in respuesta.get_json()['error']


def test_un_archivo_que_no_es_pdf_se_rechaza(cliente):
    from storage import storage

    from tests.conftest import subida
    file_id = storage.save_upload(SESION, subida(b'hola', 'notas.txt')).id

    respuesta = cliente.post('/api/tools/aplanar-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id]})

    assert respuesta.status_code == 400
    assert 'no es un PDF' in respuesta.get_json()['error']
