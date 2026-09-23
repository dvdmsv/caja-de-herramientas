"""Comprimir imágenes hasta un tamaño: «cada foto por debajo de 200 KB».

Lo que importa es que se cumpla el tamaño **estropeando lo menos posible**:
primero se baja la calidad, y sólo si no basta se reduce la foto en píxeles.
"""
import io
import os
import random

import pytest
from PIL import Image

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def foto(ancho=2400, alto=1600, formato='JPEG', modo='RGB') -> bytes:
    """Una foto con detalle de verdad: sin él, cualquier calidad cabría."""
    aleatorio = random.Random(3)
    imagen = Image.new(modo, (ancho, alto))
    imagen.putdata([(aleatorio.randrange(256), (x * 3) % 256, (y * 2) % 256)
                    + ((aleatorio.randrange(256),) if modo == 'RGBA' else ())
                    for y in range(alto) for x in range(ancho)])
    memoria = io.BytesIO()
    imagen.save(memoria, formato, **({'quality': 95} if formato == 'JPEG' else {}))
    return memoria.getvalue()


def comprimir(cliente, contenido, nombre, objetivo_kb):
    from storage import storage

    from tests.conftest import subida
    file_id = storage.save_upload(SESION, subida(contenido, nombre)).id
    respuesta = cliente.post('/api/tools/comprimir-imagen', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], 'objetivo_kb': objetivo_kb})
    assert respuesta.status_code == 201, respuesta.get_json()
    datos = respuesta.get_json()
    return storage.path_of(SESION, datos['files'][0]['id']), datos['objetivo']


def test_baja_del_tamano_y_conserva_la_proporcion(cliente):
    original = foto()
    ruta, informe = comprimir(cliente, original, 'foto.jpg', len(original) / 1024 / 6)

    assert informe['logrado'] is True and informe['no_alcanzadas'] == []
    assert os.path.getsize(ruta) <= informe['bytes']
    with Image.open(ruta) as resultado:
        assert resultado.format == 'JPEG'
        assert abs(resultado.width / resultado.height - 1.5) < 0.01


def test_con_margen_solo_baja_la_calidad(cliente):
    original = foto()
    ruta, informe = comprimir(cliente, original, 'foto.jpg', len(original) / 1024 * 0.8)

    assert informe['logrado'] is True
    with Image.open(ruta) as resultado:
        assert resultado.size == (2400, 1600)


def test_si_no_se_llega_lo_dice_y_entrega_algo_mas_ligero(cliente):
    original = foto()
    ruta, informe = comprimir(cliente, original, 'foto.jpg', 0.1)

    assert informe['logrado'] is False
    assert informe['no_alcanzadas'] == ['foto.jpg']
    assert os.path.getsize(ruta) < len(original)


def test_si_ya_cabe_no_se_toca(cliente):
    original = foto(300, 200)
    ruta, informe = comprimir(cliente, original, 'foto.jpg', 5000)

    assert informe['logrado'] is True
    with open(ruta, 'rb') as fh:
        assert fh.read() == original


def test_un_png_con_transparencia_la_conserva(cliente):
    original = foto(800, 600, 'PNG', 'RGBA')
    ruta, informe = comprimir(cliente, original, 'logo.png', len(original) / 1024 / 4)

    assert informe['logrado'] is True
    with Image.open(ruta) as resultado:
        assert resultado.format == 'PNG'
        assert resultado.mode in ('RGBA', 'P') and 'A' in resultado.convert('RGBA').getbands()
        assert resultado.convert('RGBA').getextrema()[3][0] < 255
