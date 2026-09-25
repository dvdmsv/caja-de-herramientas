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


# --- Por tamaño ----------------------------------------------------------------

def comprimir_hasta(cliente, ruta, objetivo_mb):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        file_id = storage.save_upload(SESION, subida(fh.read(), 'documento.pdf')).id
    respuesta = cliente.post('/api/tools/comprimir-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id], 'objetivo_mb': objetivo_mb})
    assert respuesta.status_code == 201, respuesta.get_json()
    datos = respuesta.get_json()
    return storage.path_of(SESION, datos['files'][0]['id']), datos['objetivo']


def documento_pesado(ruta, paginas=4):
    """Varias fotos con mucho detalle: pesa lo bastante para que haya margen."""
    import io
    import random

    from PIL import Image

    aleatorio = random.Random(7)
    documento = fitz.open()
    for _ in range(paginas):
        lienzo = Image.new('RGB', (1600, 1200))
        lienzo.putdata([(aleatorio.randrange(256), (x * 3) % 256, (y * 2) % 256)
                        for y in range(1200) for x in range(1600)])
        memoria = io.BytesIO()
        lienzo.save(memoria, format='JPEG', quality=95)
        documento.new_page().insert_image(fitz.Rect(20, 20, 580, 440), stream=memoria.getvalue())
    documento.save(str(ruta))
    documento.close()
    return str(ruta)


def test_baja_del_tamano_pedido(cliente, tmp_path):
    import os

    origen = documento_pesado(tmp_path / 'origen.pdf')
    objetivo = os.path.getsize(origen) / 1024 / 1024 / 3

    salida, informe = comprimir_hasta(cliente, origen, objetivo)

    assert informe['logrado'] is True
    assert os.path.getsize(salida) <= informe['bytes']
    with fitz.open(salida) as documento:
        assert documento.page_count == 4


def test_elige_la_compresion_mas_suave_que_cabe(cliente, tmp_path):
    """Con un objetivo holgado no se machacan las fotos: el resultado se queda
    cerca del objetivo, no en lo mínimo que se podría conseguir."""
    import os

    origen = documento_pesado(tmp_path / 'origen.pdf')
    original = os.path.getsize(origen)

    holgado, _ = comprimir_hasta(cliente, origen, original * 0.8 / 1024 / 1024)
    apretado, _ = comprimir_hasta(cliente, origen, 0.01)

    assert os.path.getsize(holgado) > os.path.getsize(apretado)


def test_si_no_se_llega_entrega_lo_mas_ligero_y_lo_dice(cliente, tmp_path):
    import os

    origen = documento_pesado(tmp_path / 'origen.pdf')
    salida, informe = comprimir_hasta(cliente, origen, 0.01)

    assert informe['logrado'] is False
    assert os.path.getsize(salida) < os.path.getsize(origen)


def test_si_ya_cabe_no_se_toca(cliente, tmp_path):
    origen = documento_con_imagen(tmp_path / 'origen.pdf')
    salida, informe = comprimir_hasta(cliente, origen, 50)

    assert informe['logrado'] is True
    with open(origen, 'rb') as a, open(salida, 'rb') as b:
        assert a.read() == b.read()


# --- El mínimo, antes de comprimir ------------------------------------------------

def pedir_minimo(cliente, ruta):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fh:
        file_id = storage.save_upload(SESION, subida(fh.read(), 'documento.pdf')).id
    respuesta = cliente.post('/api/tools/comprimir-pdf/minimo', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id]})
    assert respuesta.status_code == 200, respuesta.get_json()
    return respuesta.get_json()


def test_comprimir_dos_veces_da_los_mismos_bytes(tmp_path):
    """Sin esto, `/minimo` y la compresión de verdad podían diferir en un byte.

    MuPDF inventa al guardar un /ID de 16 bytes al azar, y según le salgan lo
    escribe en hexadecimal o como texto con escapes: la longitud cambia. Se ve
    en uno de cada pocos intentos, así que se repite hasta que salga.
    """
    from api.tools import comprimir_pdf
    from app import app

    origen = documento_pesado(tmp_path / 'origen.pdf')
    with app.test_request_context():
        resultados = set()
        for vez in range(12):
            salida = tmp_path / f'intento-{vez}.pdf'
            comprimir_pdf._comprimir(str(origen), str(salida), comprimir_pdf.ESCALERA[-1], False)
            resultados.add(salida.read_bytes())

    assert len(resultados) == 1


def test_el_minimo_es_lo_que_luego_entrega(cliente, tmp_path):
    import os

    origen = documento_pesado(tmp_path / 'origen.pdf')
    datos = pedir_minimo(cliente, origen)
    salida, informe = comprimir_hasta(cliente, origen, 0.01)

    assert datos['original'] == os.path.getsize(origen)
    assert datos['minimo'] < datos['original']
    assert datos['minimo'] == os.path.getsize(salida)

    # Y pidiendo justo el mínimo, se llega.
    _, informe = comprimir_hasta(cliente, origen, datos['minimo'] / 1024 / 1024)
    assert informe['logrado'] is True


def test_un_pdf_sin_imagenes_apenas_baja(cliente, tmp_path):
    documento = fitz.open()
    for numero in range(20):
        documento.new_page().insert_text((72, 72), f'Página {numero} ' * 20, fontsize=9)
    ruta = str(tmp_path / 'texto.pdf')
    documento.save(ruta, deflate=True)
    documento.close()

    datos = pedir_minimo(cliente, ruta)

    # Sólo se gana lo de limpiar la estructura: medido, un 14 %.
    assert datos['minimo'] >= datos['original'] * 0.8
