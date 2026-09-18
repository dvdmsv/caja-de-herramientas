"""Comprimir, y de paso dejar el PDF listo para verlo en la web.

Linearizar reordena el archivo para que un visor pueda pintar la primera página
sin haberlo descargado entero. Se reconoce porque el diccionario `/Linearized`
tiene que ir **al principio** del archivo: si estuviera al final no serviría de
nada, que es justo lo que la linearización evita.
"""
import fitz
import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def documento_con_imagen(ruta):
    """Un PDF con una foto dentro: sin imágenes no habría nada que comprimir."""
    import io

    from PIL import Image

    lienzo = Image.new('RGB', (600, 400))
    lienzo.putdata([((x * 7) % 256, (y * 5) % 256, (x + y) % 256)
                    for y in range(400) for x in range(600)])
    memoria = io.BytesIO()
    lienzo.save(memoria, format='JPEG', quality=95)

    documento = fitz.open()
    pagina = documento.new_page()
    pagina.insert_image(fitz.Rect(50, 50, 550, 400), stream=memoria.getvalue())
    pagina.insert_text((72, 430), 'Texto que no debe perder nitidez', fontsize=12)
    documento.save(str(ruta), deflate=True)
    documento.close()
    return str(ruta)


def comprimir(cliente, ruta, **opciones):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        file_id = storage.save_upload(SESION, subida(fh.read(), 'documento.pdf')).id

    respuesta = cliente.post('/api/tools/comprimir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], **opciones})
    assert respuesta.status_code == 201, respuesta.get_json()
    return storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])


def esta_linearizado(ruta):
    with open(ruta, 'rb') as fh:
        return b'/Linearized' in fh.read(1024)


def test_sin_pedirlo_no_linealiza_y_pesa_menos(cliente, tmp_path):
    origen = documento_con_imagen(tmp_path / 'origen.pdf')
    salida = comprimir(cliente, origen, nivel='fuerte')

    import os
    assert os.path.getsize(salida) < os.path.getsize(origen)
    assert not esta_linearizado(salida)


def test_optimizar_para_la_web_deja_la_marca_en_la_cabecera(cliente, tmp_path):
    origen = documento_con_imagen(tmp_path / 'origen.pdf')
    salida = comprimir(cliente, origen, nivel='media', web=True)

    assert esta_linearizado(salida)
    with fitz.open(salida) as documento:
        assert documento.page_count == 1


def test_optimizar_sin_tocar_las_imagenes_no_devuelve_el_original(cliente, tmp_path):
    """Linearizar engorda el archivo unos kilobytes.

    La herramienta devuelve el original cuando comprimir no ha servido de nada,
    y ese atajo se llevaría por delante justo lo que se ha pedido aquí.
    """
    origen = documento_con_imagen(tmp_path / 'origen.pdf')
    salida = comprimir(cliente, origen, nivel='ninguno', web=True)

    assert esta_linearizado(salida)
