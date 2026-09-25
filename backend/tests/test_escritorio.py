"""La aplicación de escritorio: el backend en 127.0.0.1 no puede hablar con
cualquiera, y el frontend lo sirve él mismo.

Un servidor local no es privado: lo alcanza cualquier web abierta en el
navegador del usuario y cualquier programa del equipo. Estos tests son la
garantía de que sin el token no se llega a nada, ni a la API ni a la página.
"""
import os

import pytest

from tests.conftest import SESION

TOKEN = 'secreto-de-prueba'


@pytest.fixture
def cliente(entorno, tmp_path):
    frontend = tmp_path / 'frontend'
    (frontend / 'assets').mkdir(parents=True)
    (frontend / 'index.html').write_text('<app-root></app-root>')
    (frontend / 'pdf.worker.min.mjs').write_text('export {}')
    (frontend / 'main.js').write_text('console.log(1)')

    entorno(ESCRITORIO_TOKEN=TOKEN, ESCRITORIO_FRONTEND=str(frontend))
    import app as modulo
    aplicacion = modulo.create_app('web')
    yield aplicacion.test_client()


def con_token(cliente):
    cliente.set_cookie('escritorio', TOKEN, domain='localhost')
    return cliente


def test_sin_token_no_se_llega_a_la_api(cliente):
    assert cliente.get('/api/health').status_code == 403
    assert cliente.get('/api/session/uso', headers={'X-Session-Id': SESION}).status_code == 403


def test_sin_token_no_se_llega_a_la_pagina(cliente):
    assert cliente.get('/').status_code == 403


def test_un_token_equivocado_tampoco(cliente):
    cliente.set_cookie('escritorio', 'otro', domain='localhost')
    assert cliente.get('/api/health').status_code == 403
    assert cliente.get('/?t=otro').status_code == 403


def test_el_token_de_la_url_se_cambia_por_una_cookie(cliente):
    """Y se redirige a la URL limpia: el token no se queda en la barra, y los
    demás parámetros se conservan."""
    respuesta = cliente.get(f'/visor?t={TOKEN}&x=1')

    assert respuesta.status_code == 302
    assert respuesta.headers['Location'] == '/visor?x=1'
    cookie = respuesta.headers['Set-Cookie']
    assert f'escritorio={TOKEN}' in cookie
    assert 'HttpOnly' in cookie
    assert 'SameSite=Strict' in cookie

    assert cliente.get('/api/health').status_code == 200


def test_con_token_funciona_la_api(cliente):
    assert con_token(cliente).get('/api/health').status_code == 200


def test_otro_host_se_rechaza_aunque_traiga_el_token(cliente):
    """DNS rebinding: un dominio ajeno que resuelve a 127.0.0.1 sería, para el
    navegador, del mismo origen que su propia página."""
    cliente.application.config['ESCRITORIO_HOST'] = '127.0.0.1:5123'
    con_token(cliente)

    assert cliente.get('/api/health', headers={'Host': 'malo.example'}).status_code == 403
    cliente.set_cookie('escritorio', TOKEN, domain='127.0.0.1')
    assert cliente.get('/api/health', headers={'Host': '127.0.0.1:5123'}).status_code == 200


def test_sin_cors(cliente):
    """Con CORS abierto, cualquier web podría leer las respuestas."""
    respuesta = con_token(cliente).get('/api/health', headers={'Origin': 'https://malo.example'})
    assert 'Access-Control-Allow-Origin' not in respuesta.headers


def test_las_rutas_de_angular_devuelven_index(cliente):
    respuesta = con_token(cliente).get('/herramientas/unir-pdf')
    assert respuesta.status_code == 200
    assert b'app-root' in respuesta.data


def test_los_modulos_van_como_javascript(cliente):
    """Sin esto el worker de pdf.js llega con otro tipo y el navegador lo
    rechaza: es lo mismo que arregla `nginx.conf` para `.mjs`."""
    con_token(cliente)
    for ruta in ('/pdf.worker.min.mjs', '/main.js'):
        respuesta = cliente.get(ruta)
        assert respuesta.status_code == 200
        assert respuesta.mimetype == 'text/javascript'


def test_una_ruta_de_api_que_no_existe_no_devuelve_la_pagina(cliente):
    """Si cayera en el comodín, el frontend recibiría HTML donde espera JSON."""
    assert con_token(cliente).get('/api/no-existe').status_code == 404


def test_sin_token_es_el_servicio_web_de_siempre(entorno, monkeypatch):
    monkeypatch.delenv('ESCRITORIO_TOKEN', raising=False)
    entorno()
    import app as modulo
    cliente = modulo.create_app('web').test_client()

    assert cliente.get('/api/health').status_code == 200
    assert cliente.get('/').status_code == 404


@pytest.fixture(autouse=True)
def sin_rutas_explicitas(monkeypatch):
    """La CI de Windows pone `RUTA_SOFFICE`: aquí se prueba lo que pasa sin ella."""
    for nombre in list(os.environ):
        if nombre.startswith('RUTA_'):
            monkeypatch.delenv(nombre)


def test_programas_de_python_en_el_paquete(monkeypatch):
    """PyInstaller no trae los scripts de consola: se llama al propio backend."""
    import sys

    from api import conversion

    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, 'executable', r'C:\app\backend.exe')

    assert conversion.resolver(['ocrmypdf', '-l', 'spa', 'a.pdf', 'b.pdf']) == [
        r'C:\app\backend.exe', '--programa', 'ocrmypdf', '-l', 'spa', 'a.pdf', 'b.pdf']
    assert conversion.resolver(['soffice', '--headless']) == ['soffice', '--headless']


def test_fuera_del_paquete_la_orden_no_cambia(monkeypatch):
    """Es lo que garantiza que el escritorio no le cuesta nada a la web."""
    import sys

    from api import conversion

    monkeypatch.delattr(sys, 'frozen', raising=False)
    monkeypatch.setattr(os, 'name', 'posix')
    for orden in (['ocrmypdf', 'a'], ['pdf2docx', 'convert'], ['gs', '-q'], ['soffice']):
        assert conversion.resolver(orden) == orden


def test_ghostscript_se_llama_distinto_en_windows(monkeypatch):
    import sys

    from api import conversion

    monkeypatch.delattr(sys, 'frozen', raising=False)
    monkeypatch.setattr(os, 'name', 'nt')
    assert conversion.resolver(['gs', '-q']) == ['gswin64c', '-q']


@pytest.mark.parametrize('nombre,codigo,esperado', [
    ('posix', -11, True),
    ('posix', 1, False),
    ('posix', 0xC0000005, False),
    ('nt', 0xC0000005, True),
    ('nt', 0xC0000017, True),
    ('nt', 1, False),
])
def test_un_fallo_nativo_se_reconoce_en_las_dos_plataformas(monkeypatch, nombre, codigo, esperado):
    """En Windows un proceso que revienta no sale con código negativo sino con
    el de la excepción nativa; los dos tienen que acabar en el mismo 413."""
    from api import conversion

    monkeypatch.setattr(os, 'name', nombre)
    assert conversion.murio_por_fallo(codigo) is esperado


def test_una_ruta_explicita_gana(monkeypatch):
    """LibreOffice no puede ir en el PATH: trae su propio `python.exe`."""
    from api import conversion

    monkeypatch.setenv('RUTA_SOFFICE', r'C:\LibreOffice\program\soffice.exe')
    assert conversion.resolver(['soffice', '--headless']) == [
        r'C:\LibreOffice\program\soffice.exe', '--headless']


def test_el_vendor_dice_donde_esta_cada_programa(monkeypatch, tmp_path):
    """Lo que Tauri no tiene que saber: el backend se configura solo."""
    import escritorio

    # Puestas y quitadas con monkeypatch para que las restaure al acabar: si
    # no, `usar_vendor` las dejaría puestas para el resto de la batería.
    for nombre in ('TESSDATA_PREFIX', 'WEASYPRINT_DLL_DIRECTORIES', 'FONTCONFIG_FILE',
                   'RUTA_SOFFICE'):
        monkeypatch.setenv(nombre, '-')
        monkeypatch.delenv(nombre)
    monkeypatch.setenv('PATH', 'sistema')
    vendor = str(tmp_path)

    escritorio.usar_vendor(vendor)

    ruta = os.environ['PATH'].split(os.pathsep)
    assert ruta[:2] == [os.path.join(vendor, 'tesseract'), os.path.join(vendor, 'gs', 'bin')], \
        'los del paquete van delante de los del sistema'
    assert not any('libreoffice' in parte for parte in ruta), \
        'LibreOffice trae su propio python.exe y no puede ir en el PATH'
    assert os.environ['RUTA_SOFFICE'].endswith(os.path.join('libreoffice', 'program', 'soffice.exe'))
    assert os.environ['TESSDATA_PREFIX'] == os.path.join(vendor, 'tesseract', 'tessdata')
    assert os.environ['FONTCONFIG_FILE'] == os.path.join(vendor, 'fonts.conf')
