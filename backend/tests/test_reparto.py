"""Los tres servicios: quién registra qué, y las redes de seguridad del trabajo."""
import pytest

from tests.conftest import SESION


def crear(entorno, papel, **variables):
    entorno(**variables)
    import importlib

    import app as modulo
    importlib.reload(modulo)
    return modulo.create_app(papel)


def rutas(aplicacion):
    return [str(regla) for regla in aplicacion.url_map.iter_rules()]


def test_web_no_registra_las_herramientas(entorno):
    """Si `web` registrara las herramientas, cargaría PyMuPDF y pyHanko sin usarlos."""
    aplicacion = crear(entorno, 'web')
    assert any('/api/files' in ruta for ruta in rutas(aplicacion))
    assert not any('/api/tools' in ruta for ruta in rutas(aplicacion))


@pytest.mark.parametrize('papel', ['ligeros', 'pesados'])
def test_los_servicios_de_trabajo_registran_las_herramientas(entorno, papel):
    """Los dos registran lo mismo: quién atiende qué lo decide nginx por la ruta."""
    aplicacion = crear(entorno, papel)
    assert any('/api/tools' in ruta for ruta in rutas(aplicacion))
    assert not any('/api/files' in ruta for ruta in rutas(aplicacion))


def test_desarrollo_registra_todo(entorno):
    aplicacion = crear(entorno, 'todo')
    assert any('/api/files' in ruta for ruta in rutas(aplicacion))
    assert any('/api/tools' in ruta for ruta in rutas(aplicacion))


def test_un_servicio_inventado_no_impide_arrancar(entorno):
    """Una errata en SERVICIO no puede dejar el despliegue sin backend."""
    aplicacion = crear(entorno, 'pesadoss')
    assert aplicacion.config['SERVICIO'] == 'todo'


def test_salud_en_los_tres(entorno):
    for papel in ('web', 'ligeros', 'pesados'):
        aplicacion = crear(entorno, papel)
        respuesta = aplicacion.test_client().get('/api/health')
        assert respuesta.status_code == 200
        assert respuesta.get_json()['servicio'] == papel


def test_peticion_vieja_sale_con_503(entorno):
    """Lo que ha esperado demasiado en la cola se descarta antes de trabajar."""
    aplicacion = crear(entorno, 'pesados', REQUEST_MAX_AGE_SECONDS=30)
    respuesta = aplicacion.test_client().post(
        '/api/tools/generar-qr',
        headers={'X-Session-Id': SESION, 'X-Request-Start': '1000.0'},
        json={'tipo': 'texto', 'texto': 'hola'})

    assert respuesta.status_code == 503
    assert 'saturado' in respuesta.get_json()['error']


def test_una_peticion_reciente_se_atiende(entorno):
    import time

    aplicacion = crear(entorno, 'pesados', REQUEST_MAX_AGE_SECONDS=30)
    respuesta = aplicacion.test_client().post(
        '/api/tools/generar-qr',
        headers={'X-Session-Id': SESION, 'X-Request-Start': str(time.time())},
        json={'tipo': 'texto', 'texto': 'hola'})

    assert respuesta.status_code == 201


def test_sin_nginx_delante_no_se_descarta_nada(entorno):
    """En desarrollo no hay cabecera: no puede impedir trabajar."""
    aplicacion = crear(entorno, 'pesados')
    respuesta = aplicacion.test_client().post(
        '/api/tools/generar-qr', headers={'X-Session-Id': SESION},
        json={'tipo': 'texto', 'texto': 'hola'})
    assert respuesta.status_code == 201


def test_memory_error_se_traduce_a_413(entorno):
    """Quedarse sin memoria es "no cabe aquí", no un fallo del servidor."""
    aplicacion = crear(entorno, 'pesados')

    @aplicacion.route('/prueba/sin-memoria', methods=['POST'])
    def sin_memoria():
        raise MemoryError()

    respuesta = aplicacion.test_client().post('/prueba/sin-memoria')
    assert respuesta.status_code == 413
    assert 'grande' in respuesta.get_json()['error']


def test_archivo_demasiado_grande_se_traduce_a_413(entorno):
    """`RLIMIT_FSIZE` llega como EFBIG: es un límite, no una avería."""
    import errno

    aplicacion = crear(entorno, 'pesados')

    @aplicacion.route('/prueba/efbig', methods=['POST'])
    def efbig():
        raise OSError(errno.EFBIG, 'File too large')

    respuesta = aplicacion.test_client().post('/prueba/efbig')
    assert respuesta.status_code == 413


def test_otro_error_del_sistema_sigue_siendo_500(entorno):
    aplicacion = crear(entorno, 'pesados')

    @aplicacion.route('/prueba/otro', methods=['POST'])
    def otro():
        raise OSError(9, 'Bad file descriptor')

    respuesta = aplicacion.test_client().post('/prueba/otro')
    assert respuesta.status_code == 500


def test_falta_de_memoria_de_una_biblioteca_nativa_es_413(entorno):
    """MuPDF no lanza `MemoryError`: dice «realloc (… bytes) failed».

    Medido en el contenedor con el límite de memoria por trabajo puesto a 200 MB
    y una página de 2000×2000 puntos a 600 ppp. Sin reconocer ese mensaje, el
    usuario recibía «error interno del servidor».
    """
    aplicacion = crear(entorno, 'pesados')

    @aplicacion.route('/prueba/mupdf', methods=['POST'])
    def mupdf():
        raise RuntimeError('code=2: realloc (78137500 bytes) failed')

    respuesta = aplicacion.test_client().post('/prueba/mupdf')
    assert respuesta.status_code == 413
    assert 'resolución' in respuesta.get_json()['error']


def test_un_error_de_verdad_sigue_siendo_500(entorno):
    aplicacion = crear(entorno, 'pesados')

    @aplicacion.route('/prueba/roto', methods=['POST'])
    def roto():
        raise RuntimeError('el índice del documento está corrupto')

    respuesta = aplicacion.test_client().post('/prueba/roto')
    assert respuesta.status_code == 500
