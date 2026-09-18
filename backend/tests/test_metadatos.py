"""Ver, corregir y borrar lo que un archivo cuenta de quien lo hizo.

Lo que se comprueba aquí es lo que se rompería sin darse cuenta: que editar una
foto **no la recomprima** —los bytes de la imagen tienen que salir idénticos— y
que borrar y cambiar convivan sin pisarse.
"""
import io

import fitz
import pytest
from PIL import Image

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def subir(contenido: bytes, nombre: str) -> str:
    from storage import storage

    from tests.conftest import subida
    return storage.save_upload(SESION, subida(contenido, nombre)).id


def pdf_con_metadatos(**metadatos) -> bytes:
    documento = fitz.open()
    documento.new_page().insert_text((72, 100), 'Hola', fontsize=12)
    if metadatos:
        documento.set_metadata(metadatos)
    datos = documento.tobytes(deflate=True)
    documento.close()
    return datos


def foto_con_exif(autor='Quien fuera', modelo='Camarita 1') -> bytes:
    imagen = Image.new('RGB', (64, 48))
    imagen.putdata([((x * 4) % 256, (y * 5) % 256, (x + y) % 256)
                    for y in range(48) for x in range(64)])
    exif = Image.Exif()
    exif[0x013B] = autor
    exif[0x0110] = modelo
    memoria = io.BytesIO()
    imagen.save(memoria, format='JPEG', quality=92, exif=exif)
    return memoria.getvalue()


def pixeles_jpeg(datos: bytes) -> bytes:
    """Los bytes comprimidos de la imagen: del comienzo del barrido al final."""
    return datos[datos.index(b'\xff\xda'):]


def inspeccionar(cliente, file_id):
    respuesta = cliente.post('/api/tools/limpiar-metadatos/inspeccionar',
                             headers={'X-Session-Id': SESION}, json={'file_ids': [file_id]})
    assert respuesta.status_code == 200, respuesta.get_json()
    return {campo['clave']: campo for campo in respuesta.get_json()['metadatos'][0]['campos']}


def aplicar(cliente, file_id, **cuerpo):
    return cliente.post('/api/tools/limpiar-metadatos', headers={'X-Session-Id': SESION},
                        json={'file_ids': [file_id], **cuerpo})


def contenido_de(respuesta) -> bytes:
    from storage import storage
    assert respuesta.status_code == 201, respuesta.get_json()
    ruta = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    with open(ruta, 'rb') as fichero:
        return fichero.read()


# --- PDF -------------------------------------------------------------------

def test_un_pdf_ensena_sus_ocho_campos_aunque_esten_vacios(cliente):
    """Si sólo se enseñara lo que hay, no se podría rellenar lo que falta."""
    campos = inspeccionar(cliente, subir(pdf_con_metadatos(), 'vacio.pdf'))

    assert len(campos) == 8
    assert campos['title']['valor'] == ''
    assert campos['title']['editable'] is True


def test_cambiar_el_titulo_de_un_pdf(cliente, tmp_path):
    file_id = subir(pdf_con_metadatos(title='Borrador', author='Quien fuera'), 'doc.pdf')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []},
                                  cambios={file_id: {'title': 'Memoria 2026'}}))

    with fitz.open(stream=salida, filetype='pdf') as documento:
        assert documento.metadata['title'] == 'Memoria 2026'
        assert documento.metadata['author'] == 'Quien fuera'  # lo no tocado se queda


def test_borrar_un_campo_y_cambiar_otro_a_la_vez(cliente):
    file_id = subir(pdf_con_metadatos(title='Borrador', author='Quien fuera'), 'doc.pdf')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: ['author']},
                                  cambios={file_id: {'title': 'Memoria 2026'}}))

    with fitz.open(stream=salida, filetype='pdf') as documento:
        assert documento.metadata['title'] == 'Memoria 2026'
        assert not documento.metadata['author']


def test_borrar_y_cambiar_el_mismo_campo_es_un_error(cliente):
    file_id = subir(pdf_con_metadatos(title='Borrador'), 'doc.pdf')

    respuesta = aplicar(cliente, file_id, seleccion={file_id: ['title']},
                        cambios={file_id: {'title': 'Otro'}})

    assert respuesta.status_code == 400
    assert 'borrar y cambiar' in respuesta.get_json()['error']


def test_una_fecha_se_escribe_como_se_lee(cliente):
    file_id = subir(pdf_con_metadatos(), 'doc.pdf')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []},
                                  cambios={file_id: {'creationDate': '31/12/2026 09:30'}}))

    with fitz.open(stream=salida, filetype='pdf') as documento:
        assert documento.metadata['creationDate'].startswith('D:20261231093000')


def test_una_fecha_ininteligible_se_explica(cliente):
    file_id = subir(pdf_con_metadatos(), 'doc.pdf')

    respuesta = aplicar(cliente, file_id, seleccion={file_id: []},
                        cambios={file_id: {'creationDate': 'el martes'}})

    assert respuesta.status_code == 400
    assert '31/12/2026' in respuesta.get_json()['error']


def test_no_se_puede_colar_una_clave_que_no_es_de_un_pdf(cliente):
    file_id = subir(pdf_con_metadatos(), 'doc.pdf')

    respuesta = aplicar(cliente, file_id, seleccion={file_id: []},
                        cambios={file_id: {'exif:271': 'Nikon'}})

    assert respuesta.status_code == 400


# --- fotos -----------------------------------------------------------------

def test_cambiar_el_autor_de_una_foto_no_recomprime_la_imagen(cliente):
    """Es la razón de ser del camino sin recompresión.

    Guardar con Pillow a secas daría bytes distintos: cada edición costaría una
    generación de calidad.
    """
    original = foto_con_exif(autor='Quien fuera')
    file_id = subir(original, 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []},
                                  cambios={file_id: {'exif:315': 'Ada Lovelace'}}))

    assert pixeles_jpeg(salida) == pixeles_jpeg(original)
    with Image.open(io.BytesIO(salida)) as imagen:
        exif = imagen.getexif()
        assert exif[0x013B] == 'Ada Lovelace'
        assert exif[0x0110] == 'Camarita 1'  # el modelo sigue ahí


def test_borrar_el_modelo_y_corregir_el_autor_de_una_foto(cliente):
    file_id = subir(foto_con_exif(), 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: ['exif:272']},
                                  cambios={file_id: {'exif:315': 'Ada Lovelace'}}))

    with Image.open(io.BytesIO(salida)) as imagen:
        exif = imagen.getexif()
        assert exif[0x013B] == 'Ada Lovelace'
        assert 0x0110 not in exif


def test_dejar_un_campo_en_blanco_lo_quita(cliente):
    file_id = subir(foto_con_exif(), 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []},
                                  cambios={file_id: {'exif:315': ''}}))

    with Image.open(io.BytesIO(salida)) as imagen:
        assert 0x013B not in imagen.getexif()


def test_borrarlo_todo_y_escribir_encima(cliente):
    """Sin `seleccion` se borra todo; lo que venga en `cambios` se escribe después."""
    file_id = subir(foto_con_exif(), 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, cambios={file_id: {'exif:33432': '2026'}}))

    with Image.open(io.BytesIO(salida)) as imagen:
        exif = imagen.getexif()
        assert exif[0x8298] == '2026'
        assert 0x0110 not in exif


def test_un_nombre_con_acentos_sobrevive_al_viaje(cliente):
    """El EXIF dice ASCII y Pillow cambia lo demás por "?".

    Se escribe en UTF-8, como hace exiftool, y la propia herramienta lo vuelve a
    leer bien: sin esto, "José Pérez" volvería como "Jos? P?rez".
    """
    file_id = subir(foto_con_exif(), 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []},
                                  cambios={file_id: {'exif:315': 'José Pérez'}}))
    de_nuevo = subir(salida, 'foto-2.jpg')

    assert inspeccionar(cliente, de_nuevo)['exif:315']['texto'] == 'José Pérez'


def test_sin_tocar_nada_el_archivo_sale_igual(cliente):
    original = foto_con_exif()
    file_id = subir(original, 'foto.jpg')

    salida = contenido_de(aplicar(cliente, file_id, seleccion={file_id: []}))

    assert salida == original
