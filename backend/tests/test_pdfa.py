"""Convertir a PDF/A: la orden que se monta y lo que se comprueba al terminar.

La conversión de verdad **no se prueba aquí**: la hace Ghoststript a través de
ocrmypdf, que sólo están en la imagen. Eso lo cubre `scripts/barrido.py` contra
el contenedor levantado, como el OCR y LibreOffice.

Lo que sí se prueba es todo lo que está de este lado y puede romperse sin que
nadie se entere: qué opciones se le pasan al programa, cómo se traduce cada
código de salida, y que el archivo que sale declare el perfil que dice.
"""
import subprocess

import fitz
import pytest

from tests.conftest import SESION, subida



@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def pdf(ruta, parte=None, conformidad='B'):
    """Un PDF de una página que declara —o no— un perfil PDF/A en su XMP.

    Se marca **con pikepdf**, que es la biblioteca con la que lo marca ocrmypdf
    de verdad. Escribirlo a mano fue el error que dejó pasar el fallo: se probaba
    contra un XMP escrito en la forma que la comprobación sabía leer, y el que
    llega de ocrmypdf usa la otra —`<pdfaid:part>2</pdfaid:part>` como elemento,
    no `pdfaid:part="2"` como atributo—.
    """
    import pikepdf

    archivo = fitz.open()
    archivo.new_page().insert_text((72, 100), 'Documento', fontsize=12)
    archivo.save(str(ruta))
    archivo.close()
    if parte is None:
        return str(ruta)

    with pikepdf.open(str(ruta), allow_overwriting_input=True) as documento:
        with documento.open_metadata(update_docinfo=False) as meta:
            meta['pdfaid:part'] = str(parte)
            meta['pdfaid:conformance'] = conformidad
        documento.save(str(ruta))
    return str(ruta)


def subir(nombre='documento.pdf'):
    from storage import storage

    archivo = fitz.open()
    archivo.new_page().insert_text((72, 100), 'Documento', fontsize=12)
    datos = archivo.tobytes()
    archivo.close()
    return storage.save_upload(SESION, subida(datos, nombre)).id


def convertir(cliente, **opciones):
    return cliente.post('/api/tools/pdf-a-pdfa', headers={'X-Session-Id': SESION},
                        json={'file_ids': [subir()], **opciones})


# --- lo que se comprueba del archivo que sale ----------------------------

def test_un_pdfa_que_declara_su_perfil_pasa(tmp_path):
    from api.tools.pdf_a_pdfa import _comprobar_declaracion

    _comprobar_declaracion(pdf(tmp_path / 'a.pdf', parte=2), '2b')


def test_un_pdf_normal_no_cuela_como_pdfa(tmp_path):
    """El caso que si no pasaría inadvertido: ocrmypdf acaba sin error y
    devuelve un PDF corriente. Enterarse en la sede es el peor momento."""
    from api.tools.pdf_a_pdfa import _comprobar_declaracion
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        _comprobar_declaracion(pdf(tmp_path / 'b.pdf'), '2b')

    assert fallo.value.status == 422
    assert 'no declara' in fallo.value.message


def test_se_comprueba_tambien_la_conformidad(tmp_path):
    """Un PDF/A-2**a** no es un PDF/A-2**b**: pide más y no es lo que se pidió."""
    from api.tools.pdf_a_pdfa import _comprobar_declaracion
    from errors import ApiError

    with pytest.raises(ApiError):
        _comprobar_declaracion(pdf(tmp_path / 'a2a.pdf', parte=2, conformidad='A'), '2b')


def test_pedir_1b_y_recibir_2b_tambien_falla(tmp_path):
    from api.tools.pdf_a_pdfa import _comprobar_declaracion
    from errors import ApiError

    with pytest.raises(ApiError):
        _comprobar_declaracion(pdf(tmp_path / 'c.pdf', parte=2), '1b')


# --- la orden que se le pasa al programa ---------------------------------

def ordenes(cliente, monkeypatch, **opciones):
    """Convierte interceptando la llamada al programa, y devuelve sus opciones."""
    import api.tools.pdf_a_pdfa as herramienta

    vistas = []

    def falso(opciones_, origen, destino, *args, **kwargs):
        vistas.append(opciones_)
        pdf(destino, parte=2)

    monkeypatch.setattr(herramienta.ocrmypdf, 'ejecutar', falso)
    respuesta = convertir(cliente, **opciones)
    return respuesta, vistas[0] if vistas else []


def test_sin_ocr_se_apaga_el_reconocimiento_del_todo(cliente, monkeypatch):
    """Es la opción que convierte esto en «PDF/A» y no en «OCR que además archiva».

    Si alguien la quita por parecer de más, cada conversión pasaría el documento
    entero por tesseract: minutos en vez de segundos, y texto reconocido que
    nadie ha pedido encima del que ya había.
    """
    respuesta, opciones = ordenes(cliente, monkeypatch, perfil='2b', ocr=False)

    assert respuesta.status_code == 201
    assert '--tesseract-timeout' in opciones
    assert opciones[opciones.index('--tesseract-timeout') + 1] == '0'
    assert '--language' not in opciones


def test_con_ocr_se_reconoce_en_el_idioma_pedido(cliente, monkeypatch):
    _, opciones = ordenes(cliente, monkeypatch, perfil='2b', ocr=True, idioma='spa')

    assert '--tesseract-timeout' not in opciones
    assert opciones[opciones.index('--language') + 1] == 'spa'


@pytest.mark.parametrize('perfil, esperado', [('1b', 'pdfa-1'), ('2b', 'pdfa-2')])
def test_cada_perfil_pide_el_suyo(cliente, monkeypatch, perfil, esperado):
    _, opciones = ordenes(cliente, monkeypatch, perfil=perfil)

    assert opciones[opciones.index('--output-type') + 1] == esperado


def test_las_paginas_con_texto_se_dejan_en_paz(cliente, monkeypatch):
    """Sin `--skip-text`, ocrmypdf se planta con un código 6 en el primer PDF
    que ya tenga texto, que son casi todos."""
    _, opciones = ordenes(cliente, monkeypatch)

    assert '--skip-text' in opciones


# --- cómo se traduce lo que sale mal -------------------------------------

@pytest.fixture
def ejecutar(entorno, monkeypatch):
    """`ocrmypdf.ejecutar` con la llamada al programa sustituida por su código."""
    import contextlib
    import flask

    entorno()
    from api import conversion, ocrmypdf

    @contextlib.contextmanager
    def con_codigo(codigo):
        monkeypatch.setattr(conversion, 'ejecutar', lambda *a, **k: subprocess.CompletedProcess(
            args=[], returncode=codigo, stdout='', stderr='lo que sea'))
        with flask.Flask(__name__).app_context():
            yield ocrmypdf

    return con_codigo


def test_un_perfil_que_no_se_puede_cumplir_se_explica(ejecutar):
    """El código 10 es el que le importa a PDF/A y no al OCR."""
    from errors import ApiError

    with ejecutar(10) as modulo:
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar([], 'a.pdf', 'b.pdf', 10, 'no disponible', trabajo='La conversión')

    assert fallo.value.status == 422
    assert 'transparencias' in fallo.value.message


def test_un_pdf_con_contrasena_se_explica(ejecutar):
    from errors import ApiError

    with ejecutar(8) as modulo:
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar([], 'a.pdf', 'b.pdf', 10, 'no disponible', trabajo='La conversión')

    assert 'contraseña' in fallo.value.message


def test_cada_herramienta_puede_dar_su_propia_version_de_un_codigo(ejecutar):
    """El 6 —«ya tiene texto»— se arregla de una manera en el OCR y de otra aquí."""
    from errors import ApiError

    with ejecutar(6) as modulo:
        with pytest.raises(ApiError) as fallo:
            modulo.ejecutar([], 'a.pdf', 'b.pdf', 10, 'no disponible', trabajo='La conversión',
                            errores={6: ('lo mío', 400)})

    assert fallo.value.status == 400
    assert fallo.value.message == 'lo mío'


def test_terminar_bien_no_lanza_nada(ejecutar):
    with ejecutar(0) as modulo:
        modulo.ejecutar([], 'a.pdf', 'b.pdf', 10, 'no disponible', trabajo='La conversión')


# --- validación de lo que llega ------------------------------------------

def test_un_perfil_inventado_se_rechaza(cliente):
    respuesta = convertir(cliente, perfil='3z')

    assert respuesta.status_code == 400
    assert 'perfil' in respuesta.get_json()['error']


def test_lo_que_no_es_un_pdf_se_rechaza(cliente):
    from storage import storage

    ident = storage.save_upload(SESION, subida(b'texto\n', 'notas.txt')).id
    respuesta = cliente.post('/api/tools/pdf-a-pdfa', headers={'X-Session-Id': SESION},
                             json={'file_ids': [ident]})

    assert respuesta.status_code == 400
    assert 'no es un PDF' in respuesta.get_json()['error']
