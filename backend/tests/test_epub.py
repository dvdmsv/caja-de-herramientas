"""Libros electrónicos: «EPUB a PDF», «PDF a EPUB» y el escritor de EPUB.

Lo que se comprueba es lo que hace que un lector abra el libro: que el
`mimetype` vaya el primero y sin comprimir, que cada archivo sea XML bien
formado y que el índice sea el de los capítulos. Y, de punta a punta, **la ida
y la vuelta**: un PDF con títulos e imágenes pasa a EPUB, el EPUB lo abre
PyMuPDF (que es un lector de EPUB de verdad) y vuelve a PDF con el texto entero.
"""
import io
import zipfile
import xml.etree.ElementTree as ET

import fitz
import pytest
from PIL import Image

from tests.conftest import SESION, subida


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def subir(datos, nombre):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def post(cliente, ruta, **cuerpo):
    return cliente.post(ruta, headers={'X-Session-Id': SESION}, json=cuerpo)


def leer_salida(respuesta) -> bytes:
    from storage import storage
    with open(storage.path_of(SESION, respuesta.get_json()['files'][0]['id']), 'rb') as archivo:
        return archivo.read()


def png(color=(200, 30, 30), lado=200) -> bytes:
    salida = io.BytesIO()
    Image.new('RGB', (lado, lado), color).save(salida, 'PNG')
    return salida.getvalue()


def libro_pdf(capitulos=3, con_imagen=True, con_texto=True) -> bytes:
    """Un PDF con título, capítulos con su título grande y una ilustración."""
    documento = fitz.open()
    pagina = documento.new_page()
    if con_texto:
        pagina.insert_text((72, 120), 'Libro de pruebas', fontsize=30)
    for numero in range(1, capitulos + 1):
        pagina = documento.new_page()
        if con_texto:
            pagina.insert_text((72, 90), f'Capítulo {numero}', fontsize=22)
            for renglon in range(12):
                pagina.insert_text((72, 140 + renglon * 16), f'Texto del capítulo {numero}, renglón {renglon}.',
                                   fontsize=11)
        if con_imagen and numero == 2:
            pagina.insert_image(fitz.Rect(72, 400, 272, 600), stream=png())
    documento.set_metadata({'title': 'Mi libro', 'author': 'Ana Autora'})
    datos = documento.tobytes()
    documento.close()
    return datos


def libro_epub(capitulos=3) -> bytes:
    """Un EPUB mínimo hecho con el propio escritor, con una imagen en el primero."""
    from api import epub
    partes = [(f'Capítulo {n}', epub.a_xhtml(f'# Capítulo {n}\n\n' + 'Texto del capítulo. ' * 200
                                             + ('\n\n![](imagenes/img-001.png)' if n == 1 else '')))
              for n in range(1, capitulos + 1)]
    return epub.construir(partes, {'imagenes/img-001.png': png()}, 'Libro EPUB', 'Autor')


# --- el escritor de EPUB, sin Flask --------------------------------------

def test_el_mimetype_va_el_primero_y_sin_comprimir():
    """Los lectores reconocen un EPUB por sus primeros bytes."""
    datos = libro_epub()
    assert datos[30:38] == b'mimetype'
    with zipfile.ZipFile(io.BytesIO(datos)) as zipf:
        primero = zipf.infolist()[0]
        assert primero.filename == 'mimetype'
        assert primero.compress_type == zipfile.ZIP_STORED
        assert zipf.read('mimetype') == b'application/epub+zip'


def test_todo_es_xml_bien_formado_y_el_indice_son_los_capitulos():
    with zipfile.ZipFile(io.BytesIO(libro_epub(capitulos=4))) as zipf:
        for nombre in zipf.namelist():
            if nombre.endswith(('.xhtml', '.opf', '.ncx', '.xml')):
                ET.fromstring(zipf.read(nombre))  # lanza si no lo es
        nav = zipf.read('OEBPS/nav.xhtml').decode()
    assert [f'Capítulo {n}' in nav for n in range(1, 5)] == [True] * 4


def test_se_corta_por_el_titulo_que_se_repite_no_por_el_del_libro():
    """El título del libro suele ser el único `#`; los capítulos, `##`."""
    from api import epub
    texto = '# El libro\n\n## Uno\n\nA\n\n## Dos\n\nB\n\n```\n## no es un título\n```'
    assert [titulo for titulo, _ in epub.capitulos(texto)] == ['Inicio', 'Uno', 'Dos']


def test_un_capitulo_enorme_se_reparte_sin_salir_del_indice_mas_de_una_vez():
    from api import epub
    texto = '## Único\n\n' + '\n\n'.join('Párrafo largo. ' * 40 for _ in range(600))
    partes = epub.capitulos(texto)
    assert len(partes) > 1
    assert [titulo for titulo, _ in partes if titulo] == ['Único']
    assert all(len(cuerpo) < epub.CAPITULO_GRANDE * 1.1 for _, cuerpo in partes)


def test_el_html_del_markdown_de_pdf_estructura_sale_como_xhtml():
    from api import epub
    xhtml = epub.a_xhtml('<p align="center">Uno<br>Dos</p>\n\n<div style="page-break-after: always"></div>')
    ET.fromstring(f'<body>{xhtml}</body>')
    assert 'text-align: center' in xhtml and 'page-break' not in xhtml


# --- PDF a EPUB -----------------------------------------------------------

def test_la_inspeccion_trae_titulo_autor_y_si_tiene_texto(cliente):
    cuerpo = post(cliente, '/api/tools/pdf-a-epub/inspeccionar',
                  file_ids=[subir(libro_pdf(), 'libro.pdf')]).get_json()
    assert cuerpo == {'titulo': 'Mi libro', 'autor': 'Ana Autora', 'paginas': 4, 'con_texto': True}

    escaneado = post(cliente, '/api/tools/pdf-a-epub/inspeccionar',
                     file_ids=[subir(libro_pdf(con_texto=False), 'informe_anual-2026.pdf')]).get_json()
    assert escaneado['con_texto'] is False
    assert escaneado['titulo'] == 'Mi libro'


def test_ida_y_vuelta_el_libro_se_puede_leer_entero(cliente):
    respuesta = post(cliente, '/api/tools/pdf-a-epub', file_ids=[subir(libro_pdf(), 'libro.pdf')],
                     titulo='Título elegido', autor='Otra Autora')
    assert respuesta.status_code == 201
    datos = leer_salida(respuesta)

    with zipfile.ZipFile(io.BytesIO(datos)) as zipf:
        nombres = zipf.namelist()
        opf = zipf.read('OEBPS/content.opf').decode()
    assert 'Título elegido' in opf and 'Otra Autora' in opf
    assert 'OEBPS/imagenes/portada.jpg' in nombres and 'properties="cover-image"' in opf
    assert any(n.startswith('OEBPS/imagenes/img-') for n in nombres), 'la ilustración se ha perdido'

    # PyMuPDF abre EPUB: es un lector de verdad.
    with fitz.open(stream=datos, filetype='epub') as libro:
        indice = [titulo for _, titulo, _ in libro.get_toc()]
        # El texto fluye: parte los renglones donde le toca, no donde el PDF.
        texto = ' '.join(''.join(pagina.get_text() for pagina in libro).split())
    assert indice[-3:] == ['Capítulo 1', 'Capítulo 2', 'Capítulo 3']
    assert 'Texto del capítulo 3, renglón 11.' in texto


def test_sin_portada_si_no_se_quiere(cliente):
    datos = leer_salida(post(cliente, '/api/tools/pdf-a-epub', file_ids=[subir(libro_pdf(), 'libro.pdf')],
                             portada=False))
    with zipfile.ZipFile(io.BytesIO(datos)) as zipf:
        assert 'OEBPS/imagenes/portada.jpg' not in zipf.namelist()


def test_un_escaneado_manda_al_ocr(cliente):
    respuesta = post(cliente, '/api/tools/pdf-a-epub',
                     file_ids=[subir(libro_pdf(con_texto=False), 'escaneado.pdf')])
    assert respuesta.status_code == 422
    assert 'OCR' in respuesta.get_json()['error']


def test_las_imagenes_no_cambian_documento_a_markdown(tmp_path):
    """La opción va apagada de serie: «Documento a Markdown» sigue sin imágenes."""
    from api import pdf_estructura
    ruta = tmp_path / 'libro.pdf'
    ruta.write_bytes(libro_pdf())
    imagenes = {}
    con = pdf_estructura.pdf_a_markdown(str(ruta), imagenes=imagenes)
    sin = pdf_estructura.pdf_a_markdown(str(ruta))
    assert '![](imagenes/img-001.png)' in con and list(imagenes) == ['imagenes/img-001.png']
    assert '![]' not in sin
    assert sin == con.replace('![](imagenes/img-001.png)\n\n', '')


# --- EPUB a PDF -----------------------------------------------------------

@pytest.mark.parametrize('pagina, ancho', [('a5', 420), ('a4', 595), ('lector', 255)])
def test_el_libro_sale_con_el_tamano_de_pagina_pedido(cliente, pagina, ancho):
    respuesta = post(cliente, '/api/tools/epub-a-pdf', file_ids=[subir(libro_epub(), 'libro.epub')],
                     pagina=pagina)
    assert respuesta.status_code == 201
    with fitz.open(stream=leer_salida(respuesta), filetype='pdf') as pdf:
        assert round(pdf[0].rect.width) == ancho
        assert pdf.metadata['title'] == 'Libro EPUB'
        # El índice del libro, como marcadores del PDF.
        assert [titulo for _, titulo, _ in pdf.get_toc()] == ['Capítulo 1', 'Capítulo 2', 'Capítulo 3']
        assert any(pagina.get_images() for pagina in pdf), 'la imagen del primer capítulo se ha perdido'


def test_con_letra_grande_salen_mas_paginas(cliente):
    paginas = {}
    for letra in ('pequena', 'grande'):
        respuesta = post(cliente, '/api/tools/epub-a-pdf', file_ids=[subir(libro_epub(), f'{letra}.epub')],
                         letra=letra)
        with fitz.open(stream=leer_salida(respuesta), filetype='pdf') as pdf:
            paginas[letra] = pdf.page_count
    assert paginas['grande'] > paginas['pequena']


def test_un_epub_roto_se_dice(cliente):
    roto = io.BytesIO()
    with zipfile.ZipFile(roto, 'w') as zipf:
        zipf.writestr('mimetype', 'application/epub+zip')
        zipf.writestr('META-INF/container.xml', '<container>sin cerrar')
    respuesta = post(cliente, '/api/tools/epub-a-pdf', file_ids=[subir(roto.getvalue(), 'roto.epub')])
    assert respuesta.status_code == 422


def test_un_epub_con_drm_no_se_intenta(cliente):
    """Sin mirarlo, MuPDF lo abre y saca páginas de basura."""
    datos = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(libro_epub())) as origen, zipfile.ZipFile(datos, 'w') as destino:
        for info in origen.infolist():
            destino.writestr(info, origen.read(info.filename))
        destino.writestr('META-INF/encryption.xml',
                         '<encryption><EncryptedData><EncryptionMethod '
                         'Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>')
    respuesta = post(cliente, '/api/tools/epub-a-pdf', file_ids=[subir(datos.getvalue(), 'comprado.epub')])
    assert respuesta.status_code == 422
    assert 'DRM' in respuesta.get_json()['error']


def test_las_fuentes_ofuscadas_no_son_drm():
    """El ofuscado de fuentes lleva `encryption.xml` y es legal y muy común."""
    from api.tools import epub_a_pdf
    datos = io.BytesIO()
    with zipfile.ZipFile(datos, 'w') as zipf:
        zipf.writestr('META-INF/encryption.xml',
                      '<encryption><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></encryption>')
    ruta = io.BytesIO(datos.getvalue())
    assert epub_a_pdf._con_drm(ruta) is False
