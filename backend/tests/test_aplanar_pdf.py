"""Aplanar: lo que se ve pasa a ser lo que hay.

Un campo relleno y un subrayado viven **encima** de la página y cualquier lector
puede cambiarlos. Después de aplanar tienen que haber desaparecido como objetos
y seguir viéndose como parte de la página, que es lo que distingue aplanar de
borrar.
"""
import os

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


# --- PDF que MuPDF lee pero no sabe guardar -------------------------------
#
# Reproduce sin datos personales el caso de una solicitud de matrícula real:
# «cannot find object in xref (618 0 R)» al guardar, con `clean` y sin él. La
# causa es una xref **con huecos**: subsecciones `0 5` y `7 n`, y los objetos 5 y
# 6 sin entrada ninguna. MuPDF lo abre y lo pinta sin quejarse, pero al guardar
# recorre todos los números y el hueco lo para (ver `api/reconstruccion.py`).

def pdf_con_huecos(ruta, firma: bool = False):
    """Un formulario relleno —texto y casilla marcada— más un recuadro, escrito a mano."""
    objetos = {
        1: b'<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 9 0 R] >> >>',
        2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: (b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 10 0 R'
            b' /Resources << /Font << /F1 7 0 R >> >> /Annots [4 0 R 9 0 R 13 0 R] >>'),
        4: (b'<< /Type /Annot /Subtype /Widget /FT /Tx /T (solicitante) /V (Ada Lovelace)'
            b' /Rect [10 200 200 230] /P 3 0 R /F 4 /AP << /N 8 0 R >> >>'),
        7: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        9: (b'<< /Type /Annot /Subtype /Widget /FT /Btn /T (acepto) /V /Si /AS /Si'
            b' /Rect [10 150 30 170] /P 3 0 R /F 4 /AP << /N << /Si 11 0 R /Off 12 0 R >> >> >>'),
        13: (b'<< /Type /Annot /Subtype /Square /Rect [100 40 200 100] /C [1 0 0]'
             b' /F 4 /P 3 0 R >>'),
    }
    flujos = {
        8: (b'/Type /XObject /Subtype /Form /BBox [0 0 190 30] /Resources << /Font << /Helv 7 0 R'
            b' >> >>', b'BT /Helv 12 Tf 2 10 Td (Ada Lovelace) Tj ET'),
        10: (b'', b'BT /F1 12 Tf 10 260 Td (Solicitud de prueba) Tj ET'),
        11: (b'/Type /XObject /Subtype /Form /BBox [0 0 20 20]', b'0 0 0 rg 3 3 14 14 re f'),
        12: (b'/Type /XObject /Subtype /Form /BBox [0 0 20 20]', b''),
    }
    for numero, (diccionario, contenido) in flujos.items():
        objetos[numero] = (b'<< %s /Length %d >>\nstream\n' % (diccionario, len(contenido))
                           + contenido + b'\nendstream')
    if firma:
        objetos[1] = objetos[1].replace(b'9 0 R]', b'9 0 R 14 0 R]')
        objetos[3] = objetos[3].replace(b'13 0 R]', b'13 0 R 14 0 R]')
        objetos[14] = (b'<< /Type /Annot /Subtype /Widget /FT /Sig /T (firma) /F 4 /P 3 0 R'
                       b' /Rect [0 0 0 0] /V << /Type /Sig /Filter /Adobe.PPKLite >> >>')

    datos = bytearray(b'%PDF-1.7\n')
    posiciones = {}
    for numero in sorted(objetos):
        posiciones[numero] = len(datos)
        datos += b'%d 0 obj\n%s\nendobj\n' % (numero, objetos[numero])
    xref = len(datos)
    ultimo = max(objetos)
    datos += b'xref\n0 5\n0000000000 65535 f \n'
    datos += b''.join(b'%010d 00000 n \n' % posiciones[n] for n in range(1, 5))
    # Aquí falta el `5 2`: los objetos 5 y 6 se quedan sin entrada.
    datos += b'7 %d\n' % (ultimo - 6)
    datos += b''.join(b'%010d 00000 n \n' % posiciones[n] if n in posiciones
                      else b'0000000000 65535 f \n' for n in range(7, ultimo + 1))
    datos += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (ultimo + 1, xref)
    ruta.write_bytes(bytes(datos))
    return str(ruta)


def subir(ruta, nombre='formulario.pdf'):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        return storage.save_upload(SESION, subida(fh.read(), nombre)).id


def aplanar_ids(cliente, ids, **opciones):
    return cliente.post('/api/tools/aplanar-pdf', headers={'X-Session-Id': SESION},
                        json={'file_ids': ids, **opciones})


def contenido_de_la_sesion():
    from storage import storage
    return sorted(os.listdir(storage.session_dir(SESION)))


def pixeles(ruta_o_documento):
    with fitz.open(ruta_o_documento) as documento:
        return documento[0].get_pixmap(dpi=72)


def test_la_causa_mupdf_lo_lee_pero_no_lo_guarda_ni_sin_tocarlo(tmp_path):
    """Lo que pasa con PyMuPDF 1.25.5, la de `requirements.txt`.

    Desde la 1.26.0, MuPDF avisa del hueco y sigue guardando (probado hasta la
    1.28.2). Cuando se suba de versión, este test fallará: entonces habrá que
    quitarlo, y la reparación quedará sólo como red para otros daños.
    """
    with fitz.open(pdf_con_huecos(tmp_path / 'huecos.pdf')) as documento:
        assert documento[0].get_text().startswith('Solicitud de prueba')
        assert not documento.is_repaired
        with pytest.raises(Exception, match='cannot find object in xref'):
            documento.tobytes(garbage=0)


def test_un_pdf_que_no_se_puede_guardar_se_repara_y_se_aplana(cliente, tmp_path):
    origen = pdf_con_huecos(tmp_path / 'huecos.pdf')

    respuesta = aplanar(cliente, origen)
    despues = inventario(salida_de(respuesta))

    assert respuesta.get_json()['reparados'] == ['formulario.pdf']
    assert despues['campos'] == []
    assert despues['anotaciones'] == []
    assert 'Ada Lovelace' in despues['texto']
    assert not [n for n in contenido_de_la_sesion() if n.startswith('.reconstruido-')]


def test_lo_reparado_se_ve_igual_que_el_original(cliente, tmp_path):
    origen = pdf_con_huecos(tmp_path / 'huecos.pdf')
    antes = pixeles(origen)

    despues = pixeles(salida_de(aplanar(cliente, origen)))

    assert (despues.width, despues.height) == (antes.width, antes.height)
    distintos = sum(a != b for a, b in zip(antes.samples, despues.samples))
    assert distintos <= len(antes.samples) * 0.001
    # El centro de la casilla marcada (x 20, y 140 desde arriba) sigue en negro.
    assert despues.pixel(20, 140) == (0, 0, 0)


def test_lo_reparado_respeta_solo_campos(cliente, tmp_path):
    despues = inventario(salida_de(aplanar(cliente, pdf_con_huecos(tmp_path / 'h.pdf'),
                                           anotaciones=False)))

    assert despues['campos'] == []
    assert despues['anotaciones'] == ['Square']


def test_lo_reparado_respeta_solo_anotaciones(cliente, tmp_path):
    salida = salida_de(aplanar(cliente, pdf_con_huecos(tmp_path / 'h.pdf'), campos=False))

    assert inventario(salida)['anotaciones'] == []
    with fitz.open(salida) as documento:
        valores = {w.field_name: w.field_value for w in documento[0].widgets()}
    assert valores == {'solicitante': 'Ada Lovelace', 'acepto': 'Si'}


def test_un_fallo_al_aplanar_tambien_se_repara(cliente, tmp_path, monkeypatch):
    original = fitz.Document.bake
    llamadas = []

    def bake_que_falla_una_vez(self, *args, **kwargs):
        llamadas.append(1)
        if len(llamadas) == 1:
            raise RuntimeError('code=7: cannot find object in xref (618 0 R)')
        return original(self, *args, **kwargs)

    monkeypatch.setattr(fitz.Document, 'bake', bake_que_falla_una_vez)

    respuesta = aplanar(cliente, formulario(tmp_path / 'origen.pdf'))

    assert respuesta.get_json()['reparados'] == ['formulario.pdf']
    assert inventario(salida_de(respuesta))['campos'] == []
    assert len(llamadas) == 2


def test_si_la_reparacion_falla_lo_dice_y_no_deja_nada(cliente, tmp_path, monkeypatch):
    from api import reconstruccion

    def no_se_puede(origen, carpeta):
        raise RuntimeError('qpdf: unable to find trailer dictionary')

    monkeypatch.setattr(reconstruccion, 'reconstruir', no_se_puede)
    file_id = subir(pdf_con_huecos(tmp_path / 'h.pdf'))
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 422
    error = respuesta.get_json()['error']
    assert 'estructura interna está dañada' in error
    assert 'qpdf' not in error and 'xref' not in error
    assert contenido_de_la_sesion() == antes


def test_si_ni_reparado_se_guarda_lo_dice_y_no_deja_nada(cliente, tmp_path, monkeypatch):
    def save_que_falla(self, *args, **kwargs):
        raise RuntimeError('code=7: cannot find object in xref (618 0 R)')

    file_id = subir(formulario(tmp_path / 'origen.pdf'))
    monkeypatch.setattr(fitz.Document, 'save', save_que_falla)
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 422
    assert 'ni reparándolo' in respuesta.get_json()['error']
    assert contenido_de_la_sesion() == antes


def test_un_archivo_que_no_abre_ni_reparado_se_explica(cliente, tmp_path):
    roto = tmp_path / 'roto.pdf'
    roto.write_bytes(b'%PDF-1.7\n' + b'\x00\x13basura' * 200)
    file_id = subir(roto, 'roto.pdf')
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 422
    assert 'está dañado' in respuesta.get_json()['error']
    assert contenido_de_la_sesion() == antes


def test_una_reparacion_que_cambia_el_contenido_no_se_entrega(cliente, tmp_path, monkeypatch):
    import shutil

    from api import reconstruccion

    # «Reparar» devolviendo otro documento: el mismo, sin el campo relleno.
    otro = tmp_path / 'otro.pdf'
    with fitz.open() as documento:
        documento.new_page(width=300, height=300)
        documento.save(str(otro))

    def reconstruir_mal(origen, carpeta):
        destino = os.path.join(carpeta, '.reconstruido-prueba.pdf')
        shutil.copy(otro, destino)
        return destino

    monkeypatch.setattr(reconstruccion, 'reconstruir', reconstruir_mal)
    file_id = subir(pdf_con_huecos(tmp_path / 'h.pdf'))
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 422
    assert 'sin perder contenido' in respuesta.get_json()['error']
    assert contenido_de_la_sesion() == antes


def test_si_falla_uno_del_lote_no_queda_ninguno(cliente, tmp_path):
    bueno = subir(formulario(tmp_path / 'bueno.pdf'), 'bueno.pdf')
    roto = tmp_path / 'roto.pdf'
    roto.write_bytes(b'%PDF-1.7\n' + b'\x00\x13basura' * 200)
    malo = subir(roto, 'roto.pdf')
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [bueno, malo])

    assert respuesta.status_code == 422
    assert '"roto.pdf"' in respuesta.get_json()['error']
    assert contenido_de_la_sesion() == antes


def test_un_pdf_firmado_no_se_aplana_sin_pedirlo(cliente, tmp_path):
    file_id = subir(pdf_con_huecos(tmp_path / 'firmado.pdf', firma=True))

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 422
    assert 'firmado digitalmente' in respuesta.get_json()['error']

    respuesta = aplanar_ids(cliente, [file_id], firmados=True)
    assert respuesta.status_code == 201, respuesta.get_json()


def test_un_campo_de_firma_vacio_no_cuenta_como_firmado(cliente, tmp_path):
    ruta = tmp_path / 'vacio.pdf'
    with fitz.open() as documento:
        pagina = documento.new_page()
        campo = fitz.Widget()
        campo.field_name = 'firma'
        campo.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
        campo.rect = fitz.Rect(72, 72, 272, 132)
        pagina.add_widget(campo)
        documento.save(str(ruta))

    assert aplanar(cliente, ruta).status_code == 201


def test_el_plazo_agotado_no_se_confunde_con_un_archivo_roto(cliente, tmp_path, monkeypatch):
    from api import limites, reconstruccion

    def bake_eterno(self, *args, **kwargs):
        raise limites.TiempoAgotado()

    def no_deberia(*args):
        raise AssertionError('no se repara un plazo agotado')

    monkeypatch.setattr(fitz.Document, 'bake', bake_eterno)
    monkeypatch.setattr(reconstruccion, 'reconstruir', no_deberia)
    file_id = subir(formulario(tmp_path / 'origen.pdf'))
    antes = contenido_de_la_sesion()

    respuesta = aplanar_ids(cliente, [file_id])

    assert respuesta.status_code == 504
    assert contenido_de_la_sesion() == antes


def test_la_falta_de_memoria_no_se_intenta_reparar(cliente, tmp_path, monkeypatch):
    from api import reconstruccion

    def bake_sin_memoria(self, *args, **kwargs):
        raise RuntimeError('malloc (78137500 bytes) failed')

    def no_deberia(*args):
        raise AssertionError('no se repara una falta de memoria')

    monkeypatch.setattr(fitz.Document, 'bake', bake_sin_memoria)
    monkeypatch.setattr(reconstruccion, 'reconstruir', no_deberia)

    assert aplanar(cliente, formulario(tmp_path / 'origen.pdf')).status_code == 413
