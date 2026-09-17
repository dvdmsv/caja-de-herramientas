"""Los topes que protegen la máquina de un solo trabajo."""
import io
import time
import zipfile

import pytest

from tests.conftest import SESION


def test_tope_de_rasterizado_informa_medidas(entorno):
    """El mensaje tiene que decir las medidas y el tope, o no se sabe qué hacer."""
    from errors import ApiError

    entorno(MAX_IMAGE_MEGAPIXELS=40)
    from api import limites

    with pytest.raises(ApiError) as fallo:
        limites.comprobar_lienzo(20_000, 20_000, 'La página')

    assert fallo.value.status == 413
    assert '20000×20000' in fallo.value.message
    assert '400 megapíxeles' in fallo.value.message
    assert '40' in fallo.value.message


def test_lo_que_cabe_no_se_rechaza(entorno):
    entorno(MAX_IMAGE_MEGAPIXELS=40)
    from api import limites

    # Una A4 a 600 ppp son unos 35 megapíxeles: tiene que pasar.
    limites.comprobar_lienzo(4960, 7016, 'La página')


def test_pillow_hereda_el_mismo_tope(entorno):
    """Sin fijarlo, Pillow sólo avisa a los 89 MP y no falla hasta el doble."""
    entorno(MAX_IMAGE_MEGAPIXELS=40)
    import importlib

    import api.imaging
    importlib.reload(api.imaging)
    from PIL import Image

    assert Image.MAX_IMAGE_PIXELS == 40 * 1_000_000


def test_documento_comprimido_que_se_pasa_al_descomprimir(entorno, tmp_path):
    """Un .docx pequeño puede traer gigas dentro; se mira el índice del ZIP."""
    from errors import ApiError

    entorno(MAX_UNZIPPED_MB=1)
    from api import limites

    bomba = tmp_path / 'memoria.docx'
    with zipfile.ZipFile(bomba, 'w', zipfile.ZIP_DEFLATED) as paquete:
        paquete.writestr('word/document.xml', b'\0' * 5_000_000)
    assert bomba.stat().st_size < 100_000  # comprime muchísimo

    with pytest.raises(ApiError) as fallo:
        limites.comprobar_descomprimido(str(bomba), 'memoria.docx')
    assert fallo.value.status == 413
    assert 'descomprimido' in fallo.value.message


def test_un_documento_normal_pasa(entorno, tmp_path):
    entorno(MAX_UNZIPPED_MB=400)
    from api import limites

    normal = tmp_path / 'carta.docx'
    with zipfile.ZipFile(normal, 'w') as paquete:
        paquete.writestr('word/document.xml', b'<w:document/>')
    limites.comprobar_descomprimido(str(normal), 'carta.docx')


def test_lo_que_no_es_un_zip_lo_decide_la_herramienta(entorno, tmp_path):
    """Un .docx corrupto no lo rechaza este tope: ya dará su error al abrirse."""
    entorno()
    from api import limites

    roto = tmp_path / 'roto.docx'
    roto.write_bytes(b'esto no es un zip')
    limites.comprobar_descomprimido(str(roto), 'roto.docx')


def test_el_plazo_corta_el_trabajo(entorno):
    """El contexto avisa con `TiempoAgotado`; traducirlo es del decorador."""
    entorno()
    from api import limites

    with pytest.raises(limites.TiempoAgotado):
        with limites.plazo(1, 'La prueba'):
            time.sleep(3)


def test_el_plazo_se_traduce_a_504_con_su_mensaje(entorno):
    from errors import ApiError

    entorno()
    from api import limites

    @limites.con_plazo(1, 'La prueba')
    def trabajo():
        time.sleep(3)

    with pytest.raises(ApiError) as fallo:
        trabajo()

    assert fallo.value.status == 504
    assert '1 segundo' in fallo.value.message


def test_el_plazo_se_desarma_al_salir(entorno):
    """Un plazo que se queda armado cortaría la petición siguiente."""
    import signal

    entorno()
    from api import limites

    with limites.plazo(5, 'La prueba'):
        pass
    assert signal.getitimer(signal.ITIMER_REAL)[0] == 0


@pytest.mark.parametrize('cabecera, ahora, esperado', [
    ('1000.500', 1010.0, 9.5),
    ('t=1000.500', 1010.0, 9.5),   # formato con prefijo, por si cambia nginx
    (None, 1000.0, None),
    ('basura', 1000.0, None),
    ('2000', 1000.0, 0.0),         # reloj adelantado: nunca negativo
])
def test_edad_de_la_peticion(entorno, cabecera, ahora, esperado):
    entorno()
    from api import limites

    assert limites.edad_peticion(cabecera, ahora) == esperado


def test_el_plazo_atraviesa_los_except_amplios(entorno):
    """Varias herramientas envuelven su trabajo en `except Exception`.

    Si el aviso del plazo fuese un `Exception`, se lo comerían y lo convertirían
    en «no se ha podido abrir el archivo», con un 422 en vez de un 504.
    """
    import time

    from errors import ApiError

    entorno()
    from api import limites

    @limites.con_plazo(1, 'El trabajo')
    def herramienta():
        try:
            time.sleep(3)
        except Exception as err:  # noqa: BLE001  (es justo lo que se quiere probar)
            raise ApiError('No se ha podido abrir el archivo.', 422) from err
        return 'terminado'

    with pytest.raises(ApiError) as fallo:
        herramienta()

    assert fallo.value.status == 504
