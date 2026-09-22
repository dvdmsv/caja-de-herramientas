"""Recortar, girar y redimensionar: que el recorte caiga donde se marcó.

Lo que puede romperse sin que nadie se entere es la convención de coordenadas:
proporciones de 0 a 1, origen arriba a la izquierda, y **antes** del giro que se
pida aquí. Si se desvía no hay error ninguno, hay una foto recortada por otro
sitio. Por eso las pruebas pintan cuadrantes de colores y miran qué color queda.
"""
import io

import pytest
from PIL import Image

from tests.conftest import SESION, subida

# Cuatro cuadrantes de colores distintos: así se sabe qué trozo ha sobrevivido.
ROJO, VERDE, AZUL, AMARILLO = (220, 30, 30), (30, 180, 30), (30, 30, 220), (230, 220, 40)


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def cuadrantes(ancho=400, alto=400):
    imagen = Image.new('RGB', (ancho, alto))
    imagen.paste(Image.new('RGB', (ancho // 2, alto // 2), ROJO), (0, 0))
    imagen.paste(Image.new('RGB', (ancho // 2, alto // 2), VERDE), (ancho // 2, 0))
    imagen.paste(Image.new('RGB', (ancho // 2, alto // 2), AZUL), (0, alto // 2))
    imagen.paste(Image.new('RGB', (ancho // 2, alto // 2), AMARILLO), (ancho // 2, alto // 2))
    return imagen


def como_png(imagen):
    buzon = io.BytesIO()
    imagen.save(buzon, 'PNG')
    return buzon.getvalue()


def subir(datos, nombre='foto.png'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def editar(cliente, datos=None, nombre='foto.png', **opciones):
    ident = subir(datos if datos is not None else como_png(cuadrantes()), nombre)
    return cliente.post('/api/tools/editar-imagen', headers={'X-Session-Id': SESION},
                        json={'file_ids': [ident], **opciones})


def resultado(respuesta):
    from storage import storage

    ruta = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    return Image.open(ruta).convert('RGB')


def esquinas(imagen):
    """El color de las cuatro esquinas, que es lo que dice cómo ha quedado."""
    ancho, alto = imagen.size
    dentro = lambda x, y: imagen.getpixel((x, y))  # noqa: E731
    return (dentro(5, 5), dentro(ancho - 6, 5), dentro(5, alto - 6), dentro(ancho - 6, alto - 6))


# --- el recorte ----------------------------------------------------------

def test_recortar_el_cuadrante_de_arriba_a_la_izquierda(cliente):
    respuesta = editar(cliente, recorte={'x': 0, 'y': 0, 'ancho': 0.5, 'alto': 0.5})

    assert respuesta.status_code == 201
    salida = resultado(respuesta)
    assert salida.size == (200, 200)
    assert esquinas(salida) == (ROJO, ROJO, ROJO, ROJO)


def test_recortar_el_cuadrante_de_abajo_a_la_derecha(cliente):
    """Si el origen o el eje `y` estuvieran al revés, aquí saldría otro color."""
    respuesta = editar(cliente, recorte={'x': 0.5, 'y': 0.5, 'ancho': 0.5, 'alto': 0.5})

    assert esquinas(resultado(respuesta)) == (AMARILLO,) * 4


def test_un_recorte_que_se_sale_se_recorta_contra_el_borde(cliente):
    """Pasarse unos píxeles al arrastrar es lo normal, no un error."""
    respuesta = editar(cliente, recorte={'x': 0.75, 'y': 0.75, 'ancho': 0.5, 'alto': 0.5})

    assert respuesta.status_code == 201
    assert resultado(respuesta).size == (100, 100)


def test_un_recorte_diminuto_se_rechaza(cliente):
    respuesta = editar(cliente, recorte={'x': 0, 'y': 0, 'ancho': 0.005, 'alto': 0.005})

    assert respuesta.status_code == 400
    assert 'demasiado pequeño' in respuesta.get_json()['error']


def test_un_recorte_fuera_de_la_imagen_se_rechaza(cliente):
    respuesta = editar(cliente, recorte={'x': 1.0, 'y': 0, 'ancho': 0.5, 'alto': 0.5})

    assert respuesta.status_code == 400
    assert 'fuera de la imagen' in respuesta.get_json()['error']


# --- el giro y el espejo -------------------------------------------------

def test_girar_noventa_grados_va_en_sentido_horario(cliente):
    """Como en "Organizar PDF" y como lo entiende cualquiera: el de arriba a la
    izquierda se va a arriba a la derecha."""
    salida = resultado(editar(cliente, giro=90))

    assert esquinas(salida) == (AZUL, ROJO, AMARILLO, VERDE)


def test_girar_ciento_ochenta(cliente):
    assert esquinas(resultado(editar(cliente, giro=180))) == (AMARILLO, AZUL, VERDE, ROJO)


def test_el_espejo_cambia_izquierda_por_derecha(cliente):
    assert esquinas(resultado(editar(cliente, espejo=True))) == (VERDE, ROJO, AMARILLO, AZUL)


def test_se_recorta_antes_de_girar(cliente):
    """El recuadro está referido a lo que el navegador tiene delante, que es la
    imagen **sin** el giro. Aplicarlo al revés recortaría por otro sitio."""
    salida = resultado(editar(cliente, recorte={'x': 0, 'y': 0, 'ancho': 0.5, 'alto': 0.5},
                              giro=90))

    assert esquinas(salida) == (ROJO,) * 4


def test_un_giro_que_no_es_recto_se_rechaza(cliente):
    respuesta = editar(cliente, giro=45)

    assert respuesta.status_code == 400
    assert '90' in respuesta.get_json()['error']


# --- el tamaño y el formato ----------------------------------------------

def test_redimensionar_respeta_la_proporcion(cliente):
    salida = resultado(editar(cliente, datos=como_png(cuadrantes(800, 400)), lado_maximo=400))

    assert salida.size == (400, 200)


def test_sin_lado_maximo_no_se_redimensiona(cliente):
    assert resultado(editar(cliente, lado_maximo=0)).size == (400, 400)


def test_el_formato_se_conserva(cliente):
    """Esto es un editor, no un conversor: un PNG sale PNG."""
    respuesta = editar(cliente)

    assert respuesta.get_json()['files'][0]['name'] == 'foto-editada.png'


def test_un_jpeg_sale_jpeg(cliente):
    buzon = io.BytesIO()
    cuadrantes().save(buzon, 'JPEG', quality=95)

    respuesta = editar(cliente, datos=buzon.getvalue(), nombre='foto.jpg')

    assert respuesta.get_json()['files'][0]['name'] == 'foto-editada.jpg'


def test_sin_nada_que_hacer_devuelve_la_imagen_igual(cliente):
    """Es lo que pasa al entrar y pulsar sin tocar nada: no puede fallar."""
    respuesta = editar(cliente)

    assert respuesta.status_code == 201
    assert resultado(respuesta).size == (400, 400)


def test_un_pdf_manda_a_organizar(cliente):
    from storage import storage

    ident = storage.save_upload(SESION, subida(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'doc.pdf')).id
    respuesta = cliente.post('/api/tools/editar-imagen', headers={'X-Session-Id': SESION},
                             json={'file_ids': [ident]})

    assert respuesta.status_code == 400
    assert 'Organizar PDF' in respuesta.get_json()['error']
