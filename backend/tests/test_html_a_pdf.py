"""«HTML a PDF»: que salga la página que se ve y que no se lleve nada más.

A diferencia del resto de la suite, aquí sí se maqueta con WeasyPrint de verdad:
lo que importa de esta herramienta —que respete el CSS del archivo y que no
lea el disco ni pida nada a la red— sólo se puede comprobar convirtiendo. Cada
documento es pequeño y tarda décimas de segundo.

Lo que se comprueba del PDF se lee con PyMuPDF: el texto, su color, su tamaño,
las medidas de la página, las imágenes que lleva y los adjuntos incrustados.
"""
import fitz
import pytest

from tests.conftest import SESION, subida

RUTA = '/api/tools/html-a-pdf'

ESTILADO = b"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Factura</title>
<style>
  h1 { color: #c00000; font-size: 30pt; }
  .importe { color: rgb(0, 0, 255); font-weight: bold; }
</style></head>
<body>
  <h1>Factura 2026-17</h1>
  <p>Total a pagar: <span class="importe">121,00 \xe2\x82\xac</span></p>
  <p style="color: #008000">Gracias por su confianza.</p>
</body></html>
"""


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def subir(datos: bytes, nombre: str = 'pagina.html', sesion: str = SESION) -> str:
    from storage import storage
    return storage.save_upload(sesion, subida(datos, nombre)).id


def convertir(cliente, sesion: str = SESION, **cuerpo):
    return cliente.post(RUTA, headers={'X-Session-Id': sesion}, json=cuerpo)


def pdf_de(respuesta, indice: int = 0, sesion: str = SESION) -> fitz.Document:
    from storage import storage
    assert respuesta.status_code == 201, respuesta.get_json()
    file_id = respuesta.get_json()['files'][indice]['id']
    with open(storage.path_of(sesion, file_id), 'rb') as fh:
        return fitz.open(stream=fh.read(), filetype='pdf')


def tramos(documento: fitz.Document) -> list[dict]:
    """Cada trozo de texto con su letra, tamaño y color, de todas las páginas."""
    return [tramo for pagina in documento for bloque in pagina.get_text('dict')['blocks']
            for linea in bloque.get('lines', []) for tramo in linea['spans']]


def tramo_con(documento: fitz.Document, texto: str) -> dict:
    return next(t for t in tramos(documento) if texto in t['text'])


# --- La conversión ------------------------------------------------------------

def test_convierte_el_html_con_su_texto_y_sus_estilos(cliente):
    respuesta = convertir(cliente, file_ids=[subir(ESTILADO, 'factura.html')])

    documento = pdf_de(respuesta)
    assert respuesta.get_json()['files'][0]['name'] == 'factura.pdf'
    texto = documento[0].get_text()
    assert 'Factura 2026-17' in texto
    assert '121,00 €' in texto

    titulo = tramo_con(documento, 'Factura 2026-17')
    assert titulo['color'] == 0xC00000
    assert titulo['size'] == pytest.approx(30, abs=0.5)
    importe = tramo_con(documento, '121,00')
    assert importe['color'] == 0x0000FF
    assert 'bold' in importe['font'].lower()
    assert tramo_con(documento, 'Gracias')['color'] == 0x008000


def test_respeta_los_atributos_de_presentacion_del_html_antiguo(cliente):
    """Muchos programas de gestión siguen escribiendo `<font color>` y `bgcolor`."""
    respuesta = convertir(cliente, file_ids=[subir(
        b'<p><font color="#aa00aa">Antiguo</font></p>'
        b'<table><tr><td bgcolor="#00cc00" width="80">celda</td></tr></table>')])

    documento = pdf_de(respuesta)
    assert tramo_con(documento, 'Antiguo')['color'] == 0xAA00AA
    rellenos = {tuple(round(c, 1) for c in d['fill']) for d in documento[0].get_drawings() if d.get('fill')}
    assert (0.0, 0.8, 0.0) in rellenos


# --- Las opciones de página ---------------------------------------------------

SIN_MARGEN_PROPIO = (b'<html><body style="margin: 0"><p style="margin: 0">Arriba a la izquierda</p>'
                     b'</body></html>')

MM = 72 / 25.4


def medidas(documento: fitz.Document) -> tuple[float, float]:
    return round(documento[0].rect.width), round(documento[0].rect.height)


@pytest.mark.parametrize('opciones, esperado', [
    ({}, (595, 842)),                                             # A4 vertical, por defecto
    ({'pagina': 'carta'}, (612, 792)),
    ({'pagina': 'a4', 'orientacion': 'horizontal'}, (842, 595)),
    ({'pagina': 'carta', 'orientacion': 'horizontal'}, (792, 612)),
])
def test_tamano_y_orientacion_de_la_pagina(cliente, opciones, esperado):
    respuesta = convertir(cliente, file_ids=[subir(SIN_MARGEN_PROPIO)], **opciones)
    assert medidas(pdf_de(respuesta)) == esperado


def test_lo_elegido_manda_sobre_el_page_del_documento(cliente):
    """Quien elige Carta en la pantalla quiere Carta, diga lo que diga el CSS."""
    propio = b'<style>@page { size: A5 landscape; margin: 0 } body { margin: 0 }</style><p>Hola</p>'
    respuesta = convertir(cliente, file_ids=[subir(propio)], pagina='carta', margen=25)
    documento = pdf_de(respuesta)
    assert medidas(documento) == (612, 792)
    assert tramo_con(documento, 'Hola')['bbox'][0] == pytest.approx(25 * MM, abs=1.5)


@pytest.mark.parametrize('margen', [0, 10, 30])
def test_el_margen_aparta_el_texto_del_borde(cliente, margen):
    respuesta = convertir(cliente, file_ids=[subir(SIN_MARGEN_PROPIO)], margen=margen)
    x0, y0, *_ = tramo_con(pdf_de(respuesta), 'Arriba')['bbox']
    assert x0 == pytest.approx(margen * MM, abs=1.5)
    assert y0 == pytest.approx(margen * MM, abs=4)


def test_el_margen_fuera_de_rango_se_recorta(cliente):
    respuesta = convertir(cliente, file_ids=[subir(SIN_MARGEN_PROPIO)], margen=500)
    assert tramo_con(pdf_de(respuesta), 'Arriba')['bbox'][0] == pytest.approx(40 * MM, abs=1.5)


@pytest.mark.parametrize('opciones', [
    {'pagina': 'a3'},
    {'orientacion': 'diagonal'},
    {'margen': 'mucho'},
])
def test_una_opcion_que_no_existe_se_rechaza(cliente, opciones):
    respuesta = convertir(cliente, file_ids=[subir(SIN_MARGEN_PROPIO)], **opciones)
    assert respuesta.status_code == 400
    assert 'error' in respuesta.get_json()


# --- Lotes, validaciones y sesiones -------------------------------------------

def pdfs_generados(sesion: str = SESION) -> list[str]:
    from storage import storage
    carpeta = storage.session_dir(sesion)
    return sorted(nombre for nombre in __import__('os').listdir(carpeta) if nombre.endswith('.pdf'))


def test_un_lote_sale_como_un_pdf_por_archivo_y_en_orden(cliente):
    ids = [subir(b'<p>Primero</p>', 'uno.html'), subir(b'<p>Segundo</p>', 'dos.HTM'),
           subir(b'<p>Tercero</p>', 'TRES.HTML')]
    respuesta = convertir(cliente, file_ids=ids)

    assert [f['name'] for f in respuesta.get_json()['files']] == ['uno.pdf', 'dos.pdf', 'TRES.pdf']
    for indice, palabra in enumerate(['Primero', 'Segundo', 'Tercero']):
        assert palabra in pdf_de(respuesta, indice)[0].get_text()


def test_lo_que_no_es_html_se_rechaza_antes_de_convertir_nada(cliente):
    ids = [subir(b'<p>Bien</p>', 'bien.html'), subir(b'# Titulo', 'nota.md')]
    respuesta = convertir(cliente, file_ids=ids)

    assert respuesta.status_code == 400
    assert 'nota.md' in respuesta.get_json()['error']
    assert pdfs_generados() == []


def test_un_html_vacio_se_explica(cliente):
    respuesta = convertir(cliente, file_ids=[subir(b'  \n ', 'vacio.html')])
    assert respuesta.status_code == 422
    assert 'vacio.html' in respuesta.get_json()['error']


def test_sin_archivos_no_hay_nada_que_convertir(cliente):
    respuesta = convertir(cliente, file_ids=[])
    assert respuesta.status_code == 400
    assert 'HTML' in respuesta.get_json()['error']


def test_no_se_puede_convertir_el_archivo_de_otra_sesion(cliente):
    ajeno = subir(b'<p>Secreto ajeno</p>', 'ajeno.html', sesion='b' * 32)
    respuesta = convertir(cliente, file_ids=[ajeno])

    assert respuesta.status_code == 404
    assert pdfs_generados() == [] and pdfs_generados('b' * 32) == []


def test_el_resultado_queda_en_la_sesion_de_quien_lo_pide(cliente):
    respuesta = convertir(cliente, file_ids=[subir(b'<p>Mio</p>')])
    file_id = respuesta.get_json()['files'][0]['id']
    assert pdfs_generados() == [f'{file_id}.pdf']
    otra = cliente.get(f'/api/files/{file_id}/download', headers={'X-Session-Id': 'b' * 32})
    assert otra.status_code == 404


# --- Codificación -------------------------------------------------------------

@pytest.mark.parametrize('contenido', [
    '<meta charset="windows-1252"><p>Año de la señal: 5 €</p>'.encode('cp1252'),
    '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>Año de la señal</p>'
    .encode('latin-1'),
    '<p>Año de la señal: 5 €</p>'.encode('utf-8'),                 # sin declarar
    '﻿<p>Año de la señal: 5 €</p>'.encode('utf-8'),           # con BOM de Windows
])
def test_respeta_la_codificacion_del_archivo(cliente, contenido):
    respuesta = convertir(cliente, file_ids=[subir(contenido)])
    assert 'Año de la señal' in pdf_de(respuesta)[0].get_text()


# --- Lo que el propio archivo trae dentro sí se pinta -------------------------

def png(color=(200, 30, 30), lado=8) -> bytes:
    import io

    from PIL import Image
    salida = io.BytesIO()
    Image.new('RGB', (lado, lado), color).save(salida, 'PNG')
    return salida.getvalue()


def data_uri(datos: bytes, tipo: str = 'image/png') -> str:
    import base64
    return f'data:{tipo};base64,{base64.b64encode(datos).decode()}'


def html(texto: str) -> bytes:
    return f'<!doctype html><html><head><meta charset="utf-8"></head><body>{texto}</body></html>'.encode()


def imagenes(documento: fitz.Document) -> int:
    """Imágenes del documento entero. `page.get_images()` no basta: un fondo CSS
    va dentro de un patrón, y las de dentro de un patrón no las cuenta."""
    return sum(1 for xref in range(1, documento.xref_length())
               if documento.xref_get_key(xref, 'Subtype')[1] == '/Image')


def test_las_imagenes_data_se_incrustan(cliente):
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<img src="{data_uri(png())}" width="80">'
        f'<div style="width: 40px; height: 40px; background-image: url(\'{data_uri(png((0, 0, 200)))}\')"></div>'
    ))]))
    assert imagenes(documento) == 2


def test_un_svg_data_y_uno_en_linea_se_dibujan(cliente):
    from urllib.parse import quote
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' width='50' height='50'>"
           "<rect width='50' height='50' fill='#00ff00'/></svg>")
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<img src="data:image/svg+xml,{quote(svg)}">'
        '<svg width="30" height="30"><circle cx="15" cy="15" r="15" fill="#ff00ff"/></svg>'
    ))]))
    rellenos = {tuple(round(c, 2) for c in d['fill']) for d in documento[0].get_drawings() if d.get('fill')}
    assert (0.0, 1.0, 0.0) in rellenos
    assert (1.0, 0.0, 1.0) in rellenos


# --- Lo que no se deja hacer --------------------------------------------------

@pytest.fixture
def servidor(monkeypatch):
    """Un servidor HTTP en 127.0.0.1 que apunta cada petición que recibe.

    Sirve a todo una imagen PNG o una hoja de estilo, para que si WeasyPrint
    llegara a pedir algo, lo recibiera y lo usara. Se quitan los proxies del
    entorno: con uno puesto, la petición no llegaría aquí y el test pasaría
    sin probar nada.
    """
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    for variable in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv('no_proxy', '*')

    pedidas = []
    imagen = png()

    class Apuntador(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — nombre que impone http.server
            pedidas.append(self.path)
            css = self.path.endswith('.css')
            cuerpo = b'p { color: #ff0000 }' if css else imagen
            self.send_response(200)
            self.send_header('Content-Type', 'text/css' if css else 'image/png')
            self.send_header('Content-Length', str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def log_message(self, *_):
            pass

    servidor = ThreadingHTTPServer(('127.0.0.1', 0), Apuntador)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    yield f'http://127.0.0.1:{servidor.server_address[1]}', pedidas
    servidor.shutdown()
    servidor.server_close()


def svg_anidado(href: str) -> str:
    """Un SVG en `data:` que a su vez pide una imagen: la puerta de atrás clásica."""
    from urllib.parse import quote
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' "
           f"width='20' height='20'><image xlink:href='{href}' width='20' height='20'/></svg>")
    return f'data:image/svg+xml,{quote(svg)}'


VECTORES_DE_RED = {
    'img': '<img src="{url}/img.png">',
    'hoja de estilo': '<link rel="stylesheet" href="{url}/estilo.css"><p>x</p>',
    '@import': '<style>@import url("{url}/importado.css");</style><p>x</p>',
    'fondo css': '<div style="width: 9px; height: 9px; background-image: url(\'{url}/fondo.png\')"></div>',
    '@font-face': '<style>@font-face {{ font-family: Remota; src: url("{url}/letra.woff2") }}'
                  ' p {{ font-family: Remota }}</style><p>x</p>',
    'viñeta': '<ul style="list-style-image: url(\'{url}/vineta.png\')"><li>x</li></ul>',
    'content: url()': '<style>p::before {{ content: url("{url}/antes.png") }}</style><p>x</p>',
    'object': '<object data="{url}/objeto.png" type="image/png"></object>',
    'embed': '<embed src="{url}/embed.png" type="image/png">',
    'svg en línea': '<svg width="9" height="9"><image href="{url}/svg.png" width="9" height="9"/></svg>',
    'svg anidado en data:': '<img src="{anidado}">',
    'base': '<base href="{url}/carpeta/"><img src="relativa.png">',
    'adjunto link': '<link rel="attachment" href="{url}/adjunto.txt"><p>x</p>',
    'adjunto a': '<a rel="attachment" href="{url}/anexo.txt">anexo</a>',
}


@pytest.mark.parametrize('vector', VECTORES_DE_RED)
def test_no_pide_nada_a_la_red(cliente, servidor, vector):
    url, pedidas = servidor
    contenido = VECTORES_DE_RED[vector].format(url=url, anidado=svg_anidado(f'{url}/anidada.png'))
    respuesta = convertir(cliente, file_ids=[subir(html(contenido))])

    assert respuesta.status_code == 201, respuesta.get_json()
    assert pedidas == []


@pytest.fixture
def secretos(tmp_path):
    """Archivos del servidor que ningún HTML subido debería poder leer."""
    carpeta = tmp_path / 'secretos'
    carpeta.mkdir()
    (carpeta / 'secreto.png').write_bytes(png())
    (carpeta / 'rojo.css').write_text('p { color: #ff0000 }')
    (carpeta / 'secreto.txt').write_text('contraseña del servidor')
    return carpeta


def test_no_lee_imagenes_del_disco(cliente, secretos, monkeypatch):
    monkeypatch.chdir(secretos)  # para que una ruta relativa tuviera dónde caer
    url = secretos.as_uri()
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<img src="{url}/secreto.png">'
        f'<img src="{secretos}/secreto.png">'
        '<img src="secreto.png">'
        f'<img src="{svg_anidado(url + "/secreto.png")}">'
        f'<div style="width: 9px; height: 9px; background: url(\'{url}/secreto.png\')"></div>'
    ))]))
    assert imagenes(documento) == 0


def test_una_etiqueta_base_no_abre_el_disco(cliente, secretos):
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<base href="{secretos.as_uri()}/"><link rel="stylesheet" href="rojo.css">'
        '<p>Texto</p><img src="secreto.png">'
    ))]))
    assert imagenes(documento) == 0
    assert tramo_con(documento, 'Texto')['color'] != 0xFF0000


def test_una_etiqueta_base_no_convierte_los_enlaces_relativos_en_externos(cliente):
    """Aunque no se descargue nada, `<base>` no debe decidir adónde llevan los enlaces."""
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        '<base href="https://malo.example/"><p><a href="pagar.html">Pagar</a></p>'
    ))]))
    assert not any('malo.example' in (e.get('uri') or '') for e in documento[0].get_links())


def test_no_aplica_hojas_de_estilo_del_disco(cliente, secretos):
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<link rel="stylesheet" href="{secretos.as_uri()}/rojo.css">'
        f'<style>@import url("{secretos.as_uri()}/rojo.css");</style><p>Texto</p>'
    ))]))
    assert tramo_con(documento, 'Texto')['color'] != 0xFF0000


def test_un_svg_no_lee_el_disco_con_entidades_externas(cliente, secretos):
    from urllib.parse import quote
    svg = (f'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "{secretos.as_uri()}/secreto.txt">]>'
           "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='40'>"
           "<text x='0' y='20'>[&x;]</text></svg>")
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<p>Antes</p><img src="data:image/svg+xml,{quote(svg)}">'
    ))]))
    # El lector de XML no resuelve la entidad externa y descarta ese SVG entero;
    # lo que importa es que el secreto no llegue y el resto se convierta.
    texto = documento[0].get_text()
    assert 'Antes' in texto
    assert 'contraseña' not in texto


def test_un_documento_desmesurado_se_para_con_un_413(cliente, monkeypatch):
    from api.tools import html_a_pdf
    monkeypatch.setattr(html_a_pdf, 'MAXIMO_PAGINAS', 2)
    paginas = b''.join(b'<p style="break-after: page">Hoja</p>' for _ in range(3))

    respuesta = convertir(cliente, file_ids=[subir(paginas, 'largo.html')])
    assert respuesta.status_code == 413
    assert 'largo.html' in respuesta.get_json()['error']
    assert pdfs_generados() == []


def adjuntos(documento: fitz.Document) -> int:
    """Archivos incrustados en el documento y anotaciones de archivo adjunto."""
    anotaciones = sum(1 for pagina in documento
                      for _ in pagina.annots(types=[fitz.PDF_ANNOT_FILE_ATTACHMENT]))
    return documento.embfile_count() + anotaciones


@pytest.mark.parametrize('origen', ['disco', 'data'])
def test_no_incrusta_adjuntos(cliente, secretos, origen):
    """WeasyPrint incrusta en el PDF lo que enlaza un `rel="attachment"`. Con una
    ruta del disco sería sacar archivos del servidor dentro del PDF; con `data:`
    es meter en el PDF un archivo que no se ve. Ni lo uno ni lo otro."""
    href = (f'{secretos.as_uri()}/secreto.txt' if origen == 'disco'
            else data_uri(b'carga escondida', 'application/octet-stream'))
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        f'<link rel="attachment" href="{href}" title="adjunto">'
        f'<p><a rel="attachment" href="{href}">Anexo</a></p>'
    ))]))
    assert adjuntos(documento) == 0
    assert 'Anexo' in documento[0].get_text()


def test_no_ejecuta_javascript(cliente):
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        '<p id="x">original</p>'
        '<script>document.getElementById("x").textContent = "cambiado"; document.write("INYECTADO")</script>'
        '<p onclick="alert(1)">pulsable</p>'
    ))]))
    texto = documento[0].get_text()
    assert 'original' in texto and 'pulsable' in texto
    assert 'cambiado' not in texto and 'INYECTADO' not in texto and 'getElementById' not in texto


def test_los_enlaces_javascript_y_file_no_llegan_al_pdf(cliente, secretos):
    documento = pdf_de(convertir(cliente, file_ids=[subir(html(
        '<p><a href="javascript:alert(1)">malo</a> <a href="JaVaScRiPt:alert(2)">malo2</a> '
        f'<a href="{secretos.as_uri()}/secreto.txt">local</a> '
        '<a href="https://ejemplo.es/">web</a> <a href="mailto:ana@ejemplo.es">correo</a> '
        '<a href="#abajo">dentro</a></p><h2 id="abajo">Abajo</h2>'
    ))]))
    enlaces = documento[0].get_links()
    externos = sorted(e['uri'] for e in enlaces if e.get('uri'))
    assert externos == ['https://ejemplo.es/', 'mailto:ana@ejemplo.es']
    assert any(e.get('nameddest') == 'abajo' for e in enlaces)       # el ancla interna sigue
    assert 'malo' in documento[0].get_text() and 'local' in documento[0].get_text()
