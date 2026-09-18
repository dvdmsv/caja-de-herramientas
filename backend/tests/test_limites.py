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


@pytest.fixture
def conversion(entorno):
    """`api.conversion` recargado y con contexto de aplicación, que usa el log."""
    import contextlib
    import importlib

    import flask

    entorno()
    import api.conversion
    importlib.reload(api.conversion)

    @contextlib.contextmanager
    def preparar():
        with flask.Flask(__name__).app_context():
            yield api.conversion

    return preparar


def test_un_programa_muerto_por_señal_no_se_confunde_con_un_archivo_dañado(conversion):
    """Medido: pdf2docx con 512 MB de tope muere con violación de segmento (-11).

    Los programas externos heredan el límite de memoria del worker, así que
    quedarse corto no da un error de memoria: da un proceso muerto a mitad. Sin
    traducirlo, el usuario leía «el archivo está dañado».

    Se usa un proceso que se mata de verdad y no un `CompletedProcess` de
    mentira: lo que hay que comprobar es que el código negativo llega, y eso
    depende de cómo se espere al proceso.
    """
    from errors import ApiError

    with conversion() as modulo:
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar(['sh', '-c', 'kill -9 $$'], 10, 'programa', 'no disponible')

    assert fallo.value.status == 413
    assert 'sin memoria' in fallo.value.message


def test_un_programa_que_no_esta_instalado_se_explica(conversion):
    from errors import ApiError

    with conversion() as modulo:
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar(['no-existe-este-programa'], 10, 'programa', 'no disponible')

    assert fallo.value.status == 500
    assert fallo.value.message == 'no disponible'


def test_un_programa_que_se_pasa_del_plazo_se_corta(conversion):
    """El plazo se lleva a mano porque la espera va a latidos: si se sumaran los
    latidos en vez de mirar el reloj, el plazo se alargaría solo."""
    import time

    from errors import ApiError

    with conversion() as modulo:
        empezado = time.monotonic()
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar(['sleep', '30'], 1, 'programa', 'no disponible', 'La conversión')
        tardado = time.monotonic() - empezado

    assert fallo.value.status == 504
    assert '1 segundo' in fallo.value.message
    assert tardado < 5, 'se ha esperado mucho más que el plazo'


def test_cancelar_mata_el_programa(conversion):
    """Sin esto, cancelar un OCR de cuatro minutos no haría nada: el worker
    seguiría bloqueado en el subproceso hasta el final."""
    import time

    from api.progreso import Cancelado

    with conversion() as modulo:
        empezado = time.monotonic()
        with pytest.raises(Cancelado):
            modulo.ejecutar(['sleep', '30'], 30, 'programa', 'no disponible',
                            vigilante=lambda: True)
        tardado = time.monotonic() - empezado

    assert tardado < 5, 'el programa tenía que morir en el primer latido'


def test_un_programa_que_termina_bien_devuelve_su_salida(conversion):
    """La salida se lee entre latidos, así que reintentar no puede perderla."""
    with conversion() as modulo:
        resultado = modulo.ejecutar(['sh', '-c', 'sleep 1.2; echo hola; echo ay >&2'],
                                    10, 'programa', 'no disponible')

    assert resultado.returncode == 0
    assert resultado.stdout.strip() == 'hola'
    assert resultado.stderr.strip() == 'ay'
