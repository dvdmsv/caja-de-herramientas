"""Leer QR y códigos de barras: qué se reconoce y cómo se cuenta.

No genera archivos, así que lo que hay que comprobar es el informe: que
encuentre lo que hay, que diga en qué página está, que clasifique el contenido
—una red wifi tiene que llegar a la pantalla como una red wifi— y que el
reintento que se ha puesto sirva para algo.
"""
import io

import fitz
import pytest
import segno
from PIL import Image, ImageFilter

from tests.conftest import SESION, subida


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('ligeros').test_client()


def qr(contenido, escala=6):
    buzon = io.BytesIO()
    segno.make(contenido).save(buzon, kind='png', scale=escala, border=4)
    return buzon.getvalue()


def subir(datos, nombre):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def leer(cliente, *archivos):
    ids = [subir(datos, nombre) for datos, nombre in archivos]
    return cliente.post('/api/tools/leer-codigo/inspeccionar',
                        headers={'X-Session-Id': SESION}, json={'file_ids': ids})


# --- cómo se clasifica lo que pone dentro --------------------------------

@pytest.mark.parametrize('texto, clase', [
    ('WIFI:S:Oficina;T:WPA;P:clave;;', 'wifi'),
    ('BEGIN:VCARD\nFN:Ana\nEND:VCARD', 'contacto'),
    ('MECARD:N:Ana;;', 'contacto'),
    ('mailto:ana@ejemplo.es', 'correo'),
    ('tel:+34600123456', 'telefono'),
    ('SMSTO:600123456:hola', 'telefono'),
    ('https://ejemplo.es', 'enlace'),
    ('http://ejemplo.es', 'enlace'),
    ('BEGIN:VEVENT', 'evento'),
    ('5901234123457', 'texto'),
])
def test_se_dice_que_es_lo_que_hay_dentro(texto, clase):
    """Sin esto, una red wifi llega a la pantalla como la cadena «WIFI:S:…»,
    que es lo que hace inútil a la mitad de los lectores."""
    from api.tools.leer_codigo import _clase

    assert _clase(texto) == clase


# --- leer de verdad -------------------------------------------------------

def test_un_qr_en_una_imagen(cliente):
    respuesta = leer(cliente, (qr('WIFI:S:Oficina;T:WPA;P:clave1234;;'), 'wifi.png'))

    assert respuesta.status_code == 200
    codigos = respuesta.get_json()['informes'][0]['codigos']
    assert len(codigos) == 1
    assert codigos[0]['contenido'] == 'WIFI:S:Oficina;T:WPA;P:clave1234;;'
    assert codigos[0]['clase'] == 'wifi'
    assert codigos[0]['formato'] == 'QR Code'


def test_varios_codigos_en_un_pdf_dicen_su_pagina(cliente):
    archivo = fitz.open()
    archivo.new_page().insert_image(fitz.Rect(72, 72, 272, 272),
                                    stream=qr('https://ejemplo.es/uno'))
    archivo.new_page()  # una en blanco en medio: no puede descuadrar la cuenta
    archivo.new_page().insert_image(fitz.Rect(72, 72, 272, 272),
                                    stream=qr('https://ejemplo.es/dos'))
    datos = archivo.tobytes()
    archivo.close()

    codigos = leer(cliente, (datos, 'albaran.pdf')).get_json()['informes'][0]['codigos']

    assert [(c['pagina'], c['contenido']) for c in codigos] == [
        (1, 'https://ejemplo.es/uno'), (3, 'https://ejemplo.es/dos')]


def test_varios_archivos_salen_cada_uno_con_su_nombre(cliente):
    respuesta = leer(cliente, (qr('uno'), 'a.png'), (qr('dos'), 'b.png'))

    informes = respuesta.get_json()['informes']
    assert [i['archivo'] for i in informes] == ['a.png', 'b.png']
    assert [i['codigos'][0]['contenido'] for i in informes] == ['uno', 'dos']


def test_una_imagen_sin_codigos_no_es_un_error(cliente):
    """Que no haya nada que leer es una respuesta, no un fallo."""
    buzon = io.BytesIO()
    Image.new('RGB', (200, 200), (200, 200, 200)).save(buzon, 'PNG')

    respuesta = leer(cliente, (buzon.getvalue(), 'lisa.png'))

    assert respuesta.status_code == 200
    assert respuesta.get_json()['informes'][0]['codigos'] == []


def test_no_se_miran_mas_paginas_de_la_cuenta(cliente):
    """Lo pone el perfil de `ligeros`, que es quien atiende esto: 192 MB y 30 s
    de CPU. Un código está en la primera página o en la última, no en las
    doscientas."""
    from api.tools import leer_codigo

    archivo = fitz.open()
    for numero in range(leer_codigo.MAXIMO_PAGINAS + 5):
        archivo.new_page().insert_image(fitz.Rect(72, 72, 272, 272),
                                        stream=qr(f'pagina-{numero + 1}'))
    datos = archivo.tobytes()
    archivo.close()

    codigos = leer(cliente, (datos, 'gordo.pdf')).get_json()['informes'][0]['codigos']

    assert len(codigos) == leer_codigo.MAXIMO_PAGINAS
    assert codigos[-1]['pagina'] == leer_codigo.MAXIMO_PAGINAS


def test_el_reintento_al_doble_rescata_un_codigo_diminuto():
    """Medido: por debajo de un píxel por módulo, zxing-cpp falla en directo y
    acierta al doblar el tamaño. Es el único reintento que compra algo; pasar a
    gris y estirar el contraste no cambió nada en ninguna prueba."""
    import zxingcpp

    from api.tools.leer_codigo import _leer

    grande = Image.open(io.BytesIO(qr('https://ejemplo.es/factura/2026-014', escala=10)))
    diminuto = (grande.convert('RGB')
                .resize((grande.width // 8, grande.height // 8), Image.LANCZOS)
                .filter(ImageFilter.GaussianBlur(0.6)))

    assert zxingcpp.read_barcodes(diminuto) == []
    assert _leer(diminuto)[0]['contenido'] == 'https://ejemplo.es/factura/2026-014'


def test_si_la_biblioteca_no_esta_se_dice_en_vez_de_dar_error_interno(entorno, monkeypatch):
    """Una rueda que no carga en la imagen salía como «Error interno del
    servidor», que no le dice nada ni a quien lo lee ni a quien lo arregla."""
    import builtins
    import contextlib

    import flask

    entorno()
    from api.tools import leer_codigo
    from errors import ApiError

    de_verdad = builtins.__import__

    def sin_zxing(nombre, *args, **kwargs):
        if nombre == 'zxingcpp':
            raise ImportError('libzxing no encontrada')
        return de_verdad(nombre, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', sin_zxing)
    with flask.Flask(__name__).app_context():
        with pytest.raises(ApiError) as fallo:
            leer_codigo._biblioteca()

    assert fallo.value.status == 500
    assert 'no está disponible en este servidor' in fallo.value.message


def test_una_imagen_desmedida_se_corta_con_sus_medidas(entorno):
    """Una foto que no cabe tiene que dar un 413 que diga cuánto mide.

    Lo pone `imaging.abrir`, que es por donde pasan todas las imágenes; aquí se
    comprueba que esta herramienta no se salta ese camino.
    """
    entorno(MAX_IMAGE_MEGAPIXELS=1)
    import app as modulo
    from storage import storage

    cliente = modulo.create_app('ligeros').test_client()
    buzon = io.BytesIO()
    Image.new('RGB', (2000, 2000), (255, 255, 255)).save(buzon, 'PNG')
    ident = storage.save_upload(SESION, subida(buzon.getvalue(), 'enorme.png')).id

    respuesta = cliente.post('/api/tools/leer-codigo/inspeccionar',
                             headers={'X-Session-Id': SESION}, json={'file_ids': [ident]})

    assert respuesta.status_code == 413
    assert '2000×2000' in respuesta.get_json()['error']


def test_lo_que_no_es_una_imagen_se_dice(cliente):
    respuesta = leer(cliente, (b'esto es texto\n', 'notas.txt'))

    assert respuesta.status_code == 422
    assert 'notas.txt' in respuesta.get_json()['error']
