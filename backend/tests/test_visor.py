"""Guardar desde el visor.

Lo que pinta el visor en el navegador tiene que acabar en el PDF, en su sitio y
del tipo que cualquier lector entiende. Los rectángulos van en proporciones
de 0 a 1, arriba a la izquierda, sobre la página sin el giro del usuario.
"""
import fitz
import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def documento(ruta, contrasena=None, paginas=2, giro=0):
    pdf = fitz.open()
    for numero in range(paginas):
        pagina = pdf.new_page()
        pagina.insert_text((72, 100), f'Texto de la página {numero + 1}', fontsize=14)
        if giro:
            pagina.set_rotation(giro)
    opciones = {}
    if contrasena:
        opciones = {'encryption': fitz.PDF_ENCRYPT_AES_256, 'user_pw': contrasena,
                    'owner_pw': contrasena + '-dueño'}
    pdf.save(str(ruta), **opciones)
    pdf.close()
    return str(ruta)


def subir(ruta):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        return storage.save_upload(SESION, subida(fh.read(), 'documento.pdf')).id


def guardar(cliente, file_id, **cambios):
    return cliente.post('/api/tools/visor/guardar', headers={'X-Session-Id': SESION},
                        json={'file_ids': [file_id], **cambios})


def resultado(respuesta):
    from storage import storage
    return storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])


SUBRAYADO = {'subrayados': [{'pagina': 1, 'color': 'amarillo', 'rects': [[0.1, 0.1, 0.5, 0.15]]}]}


def test_un_pdf_protegido_se_guarda_con_su_contrasena_y_sigue_protegido(cliente, tmp_path):
    file_id = subir(documento(tmp_path / 'protegido.pdf', contrasena='1234'))

    respuesta = guardar(cliente, file_id, contrasena='1234', **SUBRAYADO)

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as pdf:
        assert pdf.needs_pass, 'el resultado ha perdido la contraseña'
        assert pdf.authenticate('1234')
        assert [a.type[1] for a in pdf[0].annots()] == ['Highlight']


def test_sin_contrasena_o_con_una_mala_no_se_guarda(cliente, tmp_path):
    file_id = subir(documento(tmp_path / 'protegido.pdf', contrasena='1234'))

    sin = guardar(cliente, file_id, **SUBRAYADO)
    mala = guardar(cliente, file_id, contrasena='4321', **SUBRAYADO)

    assert sin.status_code == 422
    assert mala.status_code == 422
    assert 'no es correcta' in mala.get_json()['error']


def test_un_pdf_sin_contrasena_ignora_la_que_llegue(cliente, tmp_path):
    file_id = subir(documento(tmp_path / 'libre.pdf'))

    respuesta = guardar(cliente, file_id, contrasena='lo-que-sea', **SUBRAYADO)

    assert respuesta.status_code == 201
    with fitz.open(resultado(respuesta)) as pdf:
        assert not pdf.needs_pass


def test_protegido_y_quitando_paginas(cliente, tmp_path):
    """`select` reescribe el documento: tiene que seguir saliendo cifrado."""
    file_id = subir(documento(tmp_path / 'protegido.pdf', contrasena='1234', paginas=3))

    respuesta = guardar(cliente, file_id, contrasena='1234',
                        paginas=[{'numero': 1, 'rotacion': 0}, {'numero': 3, 'rotacion': 90}])

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as pdf:
        assert pdf.needs_pass and pdf.authenticate('1234')
        assert pdf.page_count == 2
        assert pdf[1].rotation == 90
