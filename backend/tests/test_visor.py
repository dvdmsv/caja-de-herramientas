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


# --- notas, dibujos, formas, sellos, imágenes y las que ya traía -------------

def visible(pagina, punto):
    """Dónde cae, en proporciones de lo que se ve, un punto del espacio sin girar."""
    p = fitz.Point(punto) * pagina.rotation_matrix
    return p.x / pagina.rect.width, p.y / pagina.rect.height


def imagen_mitad_roja():
    """Un PNG de 40×40 con la mitad de arriba roja y la de abajo azul."""
    pixeles = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40), False)
    pixeles.set_rect(fitz.IRect(0, 0, 40, 20), (255, 0, 0))
    pixeles.set_rect(fitz.IRect(0, 20, 40, 40), (0, 0, 255))
    import base64
    return 'data:image/png;base64,' + base64.b64encode(pixeles.tobytes('png')).decode()


@pytest.mark.parametrize('giro', [0, 90, 180, 270])
def test_cada_tipo_queda_donde_se_puso(cliente, tmp_path, giro):
    file_id = subir(documento(tmp_path / 'd.pdf', paginas=1, giro=giro))

    respuesta = guardar(cliente, file_id,
        notas=[{'pagina': 1, 'color': 'rojo', 'x': 0.2, 'y': 0.3, 'texto': 'Revisar esto'}],
        trazos=[{'pagina': 1, 'color': 'azul', 'grosor': 3,
                 'trazos': [[[0.5, 0.5], [0.55, 0.6], [0.6, 0.5]]]}],
        formas=[{'pagina': 1, 'color': 'negro', 'figura': 'rectangulo', 'grosor': 2,
                 'desde': [0.1, 0.7], 'hasta': [0.3, 0.8]},
                {'pagina': 1, 'color': 'rojo', 'figura': 'flecha', 'grosor': 2,
                 'desde': [0.6, 0.1], 'hasta': [0.8, 0.2]}],
        sellos=[{'pagina': 1, 'color': 'rojo', 'rect': [0.55, 0.75, 0.9, 0.82],
                 'texto': 'APROBADO'}])

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as pdf:
        pagina = pdf[0]
        por_tipo = {a.type[1]: a for a in pagina.annots()}
        assert set(por_tipo) == {'Text', 'Ink', 'Square', 'Line', 'FreeText'}

        nota = por_tipo['Text']
        assert nota.info['content'] == 'Revisar esto'
        # El icono mide lo suyo desde su punto en el espacio sin girar: lo que
        # importa es que el punto pedido quede en una de sus esquinas.
        esquinas = [visible(pagina, esquina) for esquina in
                    (nota.rect.tl, nota.rect.tr, nota.rect.bl, nota.rect.br)]
        assert any(x == pytest.approx(0.2, abs=0.005) and y == pytest.approx(0.3, abs=0.005)
                   for x, y in esquinas), esquinas

        cuadro = por_tipo['Square'].rect * pagina.rotation_matrix
        cuadro.normalize()
        centro = ((cuadro.x0 + cuadro.x1) / 2 / pagina.rect.width,
                  (cuadro.y0 + cuadro.y1) / 2 / pagina.rect.height)
        assert centro == (pytest.approx(0.2, abs=0.02), pytest.approx(0.75, abs=0.02))

        assert por_tipo['Line'].line_ends == (fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_OPEN_ARROW)
        assert 'APROBADO' in por_tipo['FreeText'].info['content']


@pytest.mark.parametrize('giro', [0, 90, 180, 270])
def test_la_firma_se_ve_derecha_aunque_la_pagina_venga_girada(cliente, tmp_path, giro):
    """Rasterizando: la mitad roja de la imagen tiene que quedar arriba en lo
    que se ve. `get_text` no sirve para esto (mide en el espacio sin girar)."""
    file_id = subir(documento(tmp_path / 'd.pdf', paginas=1, giro=giro))

    respuesta = guardar(cliente, file_id, imagenes=[
        {'pagina': 1, 'color': 'negro', 'rect': [0.4, 0.4, 0.6, 0.6], 'datos': imagen_mitad_roja()}])

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as pdf:
        imagen = pdf[0].get_pixmap(dpi=36)
        ancho, alto = imagen.width, imagen.height
        arriba = imagen.pixel(int(ancho * 0.5), int(alto * 0.45))
        abajo = imagen.pixel(int(ancho * 0.5), int(alto * 0.55))
        assert arriba[0] > 200 and arriba[2] < 80, arriba
        assert abajo[2] > 200 and abajo[0] < 80, abajo


def test_quita_solo_las_anotaciones_que_se_piden(cliente, tmp_path):
    ruta = tmp_path / 'con-notas.pdf'
    pdf = fitz.open()
    pagina = pdf.new_page()
    quitar = pagina.add_text_annot((100, 100), 'fuera')
    pagina.add_text_annot((200, 200), 'se queda')
    xref = quitar.xref
    pdf.save(str(ruta))
    pdf.close()
    file_id = subir(str(ruta))

    respuesta = guardar(cliente, file_id, anotaciones_borradas=[{'pagina': 1, 'id': f'{xref}R'}])

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as resultante:
        assert [a.info['content'] for a in resultante[0].annots()] == ['se queda']


@pytest.mark.parametrize('cambio, mensaje', [
    ({'formas': [{'pagina': 1, 'figura': 'estrella', 'desde': [0, 0], 'hasta': [1, 1]}]}, 'Figura'),
    ({'imagenes': [{'pagina': 1, 'rect': [0, 0, 0.5, 0.5], 'datos': 'data:image/png;base64,AAAA'}]},
     'PNG'),
    ({'sellos': [{'pagina': 1, 'rect': [0, 0, 0.5, 0.5], 'texto': '  '}]}, 'sin texto'),
    ({'notas': [{'pagina': 9, 'x': 0, 'y': 0, 'texto': 'x'}]}, 'no existe'),
    ({'anotaciones_borradas': [{'pagina': 1, 'id': 'javascript'}]}, 'no es válida'),
])
def test_lo_que_no_vale_se_rechaza_con_su_motivo(cliente, tmp_path, cambio, mensaje):
    file_id = subir(documento(tmp_path / 'd.pdf', paginas=1))

    respuesta = guardar(cliente, file_id, **cambio)

    assert respuesta.status_code == 400
    assert mensaje in respuesta.get_json()['error']


@pytest.mark.parametrize('giro_archivo', [0, 90])
@pytest.mark.parametrize('giro_usuario', [0, 90, 180, 270])
def test_la_firma_puesta_con_la_pagina_girada_en_el_visor_sale_derecha(
        cliente, tmp_path, giro_archivo, giro_usuario):
    """Quien gira una página en el visor suele hacerlo para leerla derecha, y
    la firma tiene que quedar derecha tal y como la estaba viendo: con el giro
    del archivo y el suyo, que se aplica luego con `paginas`."""
    file_id = subir(documento(tmp_path / 'd.pdf', paginas=1, giro=giro_archivo))

    respuesta = guardar(cliente, file_id,
                        imagenes=[{'pagina': 1, 'color': 'negro', 'rect': [0.4, 0.4, 0.6, 0.6],
                                   'datos': imagen_mitad_roja(), 'rotacion': giro_usuario}],
                        paginas=[{'numero': 1, 'rotacion': giro_usuario}])

    assert respuesta.status_code == 201, respuesta.get_json()
    with fitz.open(resultado(respuesta)) as pdf:
        imagen = pdf[0].get_pixmap(dpi=36)
        # El centro del recuadro es el mismo en cualquier giro: (0,5, 0,5).
        cx, cy = imagen.width // 2, imagen.height // 2
        lado = min(imagen.width, imagen.height) * 0.05
        arriba = imagen.pixel(cx, int(cy - lado))
        abajo = imagen.pixel(cx, int(cy + lado))
        assert arriba[0] > 200 and arriba[2] < 80, (arriba, abajo)
        assert abajo[2] > 200 and abajo[0] < 80, (arriba, abajo)
