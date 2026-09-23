"""Lo que enseña el indicador de la barra: cuánto ocupa la sesión y cuándo se borra.

La caducidad tiene que ser la misma que aplica el recolector —si no, la pantalla
prometería una hora y el servidor borraría a otra— y consultarla no puede
alargarla: mirar el indicador no es usar la aplicación.
"""
import io
import os
import time

import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno(SESSION_TTL_MINUTES=120)
    import app as modulo
    return modulo.create_app('web').test_client()


def uso(cliente) -> dict:
    respuesta = cliente.get('/api/session/uso', headers={'X-Session-Id': SESION})
    assert respuesta.status_code == 200
    return respuesta.get_json()


def subir(cliente, contenido=b'hola'):
    respuesta = cliente.post('/api/files', headers={'X-Session-Id': SESION},
                             data={'files': (io.BytesIO(contenido), 'nota.txt')},
                             content_type='multipart/form-data')
    assert respuesta.status_code in (200, 201), respuesta.get_json()


def test_sin_archivos_no_hay_nada_que_caduque(cliente):
    datos = uso(cliente)
    assert datos['usado'] == 0
    assert datos['tope'] > 0
    assert datos['caduca'] is None


def test_al_subir_caduca_en_dos_horas(cliente):
    antes = time.time()
    subir(cliente)

    datos = uso(cliente)

    assert datos['usado'] >= 4
    assert antes + 120 * 60 - 5 <= datos['caduca'] <= time.time() + 120 * 60 + 5


def test_mirar_el_uso_no_alarga_la_sesion(cliente):
    from storage import storage

    subir(cliente)
    carpeta = storage.session_dir(SESION, create=False)
    hace_una_hora = time.time() - 3600
    os.utime(carpeta, (hace_una_hora, hace_una_hora))

    primera = uso(cliente)['caduca']
    segunda = uso(cliente)['caduca']

    assert primera == segunda == pytest.approx(hace_una_hora + 120 * 60)
    # Y es la misma cuenta que usa el recolector para borrar.
    assert primera == pytest.approx(os.path.getmtime(carpeta) + storage.ttl_seconds)


def test_vaciar_deja_la_sesion_a_cero(cliente):
    subir(cliente)
    respuesta = cliente.delete('/api/session', headers={'X-Session-Id': SESION})
    assert respuesta.status_code == 204

    datos = uso(cliente)
    assert datos['usado'] == 0
    assert datos['caduca'] is None
