"""Escribir un EPUB 3 a partir de Markdown, sin Flask y sin archivos.

Lo usa «PDF a EPUB»: el PDF pasa a Markdown con `pdf_estructura` (títulos,
listas, tablas e imágenes en su sitio), y aquí se parte en capítulos por los
títulos, se pasa a XHTML y se empaqueta.

**Por qué a mano y no con una biblioteca**: un EPUB son unos pocos archivos de
texto con una forma fija dentro de un ZIP, y lo delicado —que cada capítulo sea
XML bien formado y que el `mimetype` vaya el primero y sin comprimir— hay que
cuidarlo igual con biblioteca o sin ella. Así no entra otra dependencia en la
imagen ni en el ejecutable de Windows.

Se escriben las dos formas de índice: `nav.xhtml`, la de EPUB 3, y `toc.ncx`,
la de EPUB 2, que es la que siguen leyendo muchos lectores antiguos.
"""
from __future__ import annotations

import io
import re
import uuid
import zipfile
from collections import Counter
from datetime import datetime, timezone
from html import escape

from markdown_it import MarkdownIt

# El lector de Markdown: XHTML (`<br />`, `<img />`), que es lo que exige un EPUB,
# y el HTML en línea permitido, porque `pdf_estructura` escribe algún `<p align>`.
_LECTOR = MarkdownIt('commonmark', {'html': True, 'xhtmlOut': True}).enable('table')

TITULO = re.compile(r'^(#{1,6})\s+(.*?)\s*#*\s*$')
VALLA = re.compile(r'^\s*(```|~~~)')

TIPOS = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif'}

ESTILO = """body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3, h4 { font-family: sans-serif; line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 1.6em; margin: 1.5em 0 1em; }
p { margin: 0 0 0.8em; text-align: justify; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
table { border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.2em 0.4em; }
pre, code { font-family: monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; }
blockquote { margin: 1em 5%; font-style: italic; }
.portada { text-align: center; margin: 0; padding: 0; }
.portada img { max-height: 95vh; margin: 0 auto; }
"""


# ─── Capítulos ───────────────────────────────────────────────────────────────


# Tamaño a partir del cual un capítulo se parte por un nivel de título más
# bajo. Un capítulo de un megabyte hace que muchos lectores tarden en abrirlo y
# deja el índice sin entradas: el Quijote, cortado por sus dos partes, salía en
# cuatro capítulos.
CAPITULO_GRANDE = 150_000


def capitulos(texto: str, sin_titulo: str = 'Inicio') -> list[tuple[str, str]]:
    """Parte el Markdown en capítulos: `(título, markdown)`.

    Se corta por el nivel de título más alto que se repite: en un libro, el
    título del libro suele ser el único `#` y los capítulos van con `##`, y
    cortar por el `#` daría un capítulo con el libro entero. Si así sale algún
    capítulo mayor que `CAPITULO_GRANDE`, se prueba con el siguiente nivel que
    se repita (las partes de un libro, y dentro sus capítulos); si ninguno los
    deja por debajo, se corta por el más alto. Si ningún nivel se repite, por el
    más alto que haya; sin títulos, un capítulo solo.

    Un capítulo que aun así pase de `CAPITULO_GRANDE` se reparte en trozos
    seguidos, por párrafos. Los de continuación van con el título vacío: están en
    el orden de lectura pero no en el índice.

    Lo que haya antes del primer corte va en un capítulo propio (`sin_titulo`),
    que suele ser la portadilla. No se mira dentro de los bloques de código: un
    `# comentario` ahí no es un título.
    """
    lineas = texto.splitlines()
    niveles = _niveles_de_titulo(lineas)
    if not niveles:
        partes = [(sin_titulo, texto.strip())] if texto.strip() else []
    else:
        repetidos = sorted(nivel for nivel, veces in niveles.items() if veces >= 2) or [min(niveles)]
        intentos = (_partir(lineas, corte, sin_titulo) for corte in repetidos)
        partes = next((intento for intento in intentos
                       if max(len(cuerpo) for _, cuerpo in intento) <= CAPITULO_GRANDE), None)
        partes = partes or _partir(lineas, repetidos[0], sin_titulo)
    return [trozo for titulo, cuerpo in partes for trozo in _repartir(titulo, cuerpo)]


def _repartir(titulo: str, cuerpo: str) -> list[tuple[str, str]]:
    """Un capítulo demasiado grande, en trozos por párrafos, nunca dentro de un bloque de código."""
    if len(cuerpo) <= CAPITULO_GRANDE:
        return [(titulo, cuerpo)]
    trozos, actual, tamano, en_codigo = [], [], 0, False
    for parrafo in cuerpo.split('\n\n'):
        if tamano > CAPITULO_GRANDE and not en_codigo:
            trozos.append('\n\n'.join(actual))
            actual, tamano = [], 0
        actual.append(parrafo)
        tamano += len(parrafo) + 2
        if sum(1 for linea in parrafo.splitlines() if VALLA.match(linea)) % 2:
            en_codigo = not en_codigo
    trozos.append('\n\n'.join(actual))
    return [(titulo if i == 0 else '', trozo) for i, trozo in enumerate(trozos) if trozo.strip()]


def _partir(lineas: list[str], corte: int, sin_titulo: str) -> list[tuple[str, str]]:
    resultado: list[tuple[str, list[str]]] = [(sin_titulo, [])]
    en_codigo = False
    for linea in lineas:
        if VALLA.match(linea):
            en_codigo = not en_codigo
        titulo = None if en_codigo else TITULO.match(linea)
        if titulo and len(titulo.group(1)) == corte:
            resultado.append((texto_plano(titulo.group(2)) or sin_titulo, [linea]))
        else:
            resultado[-1][1].append(linea)
    partes = [(titulo, '\n'.join(cuerpo).strip()) for titulo, cuerpo in resultado]
    return [(titulo, cuerpo) for titulo, cuerpo in partes if cuerpo]


def _niveles_de_titulo(lineas: list[str]) -> Counter:
    """Cuántos títulos hay de cada nivel, fuera de los bloques de código."""
    niveles, en_codigo = Counter(), False
    for linea in lineas:
        if VALLA.match(linea):
            en_codigo = not en_codigo
        elif not en_codigo and (titulo := TITULO.match(linea)):
            niveles[len(titulo.group(1))] += 1
    return niveles


def texto_plano(markdown_en_linea: str) -> str:
    """El texto de un título sin su formato, para el índice."""
    html = _LECTOR.renderInline(markdown_en_linea)
    return re.sub(r'\s+', ' ', _entidades(re.sub(r'<[^>]+>', '', html))).strip()


def _entidades(texto: str) -> str:
    return (texto.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
            .replace('&#39;', "'").replace('&amp;', '&'))


def a_xhtml(markdown: str) -> str:
    """El cuerpo de un capítulo en XHTML bien formado.

    `markdown-it` ya escribe `<br />` e `<img />`; lo que queda es el HTML que
    trae el propio Markdown de `pdf_estructura`: `<br>` sin cerrar y
    `<p align="…">`, que XHTML 5 ya no admite y se pasa a estilo.
    """
    html = _LECTOR.render(markdown)
    html = re.sub(r'<br\s*>', '<br />', html)
    html = re.sub(r'<p align="(left|center|right|justify)">', r'<p style="text-align: \1">', html)
    # Un salto de página marcado a mano no tiene sentido en un texto que fluye.
    html = html.replace('<div style="page-break-after: always"></div>', '')
    return html


# ─── El paquete ──────────────────────────────────────────────────────────────


def construir(capitulos_xhtml: list[tuple[str, str]], imagenes: dict[str, bytes], titulo: str,
              autor: str = '', idioma: str = 'es', portada: bytes | None = None) -> bytes:
    """Los bytes del EPUB.

    `capitulos_xhtml` son `(título, cuerpo en XHTML)`; `imagenes`, los bytes de
    cada imagen con la ruta con la que las nombran los capítulos
    (`imagenes/img-001.png`); `portada`, un JPEG.
    """
    identificador = f'urn:uuid:{uuid.uuid4()}'
    titulo = titulo.strip() or 'Sin título'
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # El primero y sin comprimir: los lectores reconocen un EPUB por los
        # primeros bytes del archivo, que tienen que decir justo esto.
        zipf.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        zipf.writestr('META-INF/container.xml', _CONTENEDOR)
        zipf.writestr('OEBPS/estilo.css', ESTILO)

        archivos = [(f'capitulo-{i:03d}.xhtml', nombre, cuerpo)
                    for i, (nombre, cuerpo) in enumerate(capitulos_xhtml, start=1)]
        for archivo, nombre, cuerpo in archivos:
            zipf.writestr(f'OEBPS/{archivo}', _pagina(nombre or titulo, cuerpo, idioma))
        for ruta, datos in imagenes.items():
            zipf.writestr(f'OEBPS/{ruta}', datos)
        if portada:
            zipf.writestr('OEBPS/imagenes/portada.jpg', portada)
            zipf.writestr('OEBPS/portada.xhtml', _pagina(
                titulo, f'<div class="portada"><img src="imagenes/portada.jpg" alt="{escape(titulo)}" /></div>',
                idioma))

        zipf.writestr('OEBPS/nav.xhtml', _nav(titulo, archivos, idioma))
        zipf.writestr('OEBPS/toc.ncx', _ncx(identificador, titulo, archivos))
        zipf.writestr('OEBPS/content.opf', _opf(identificador, titulo, autor, idioma, archivos,
                                                imagenes, bool(portada)))
    return salida.getvalue()


_CONTENEDOR = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""


def _pagina(titulo: str, cuerpo: str, idioma: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{idioma}" xml:lang="{idioma}">
<head>
  <meta charset="UTF-8" />
  <title>{escape(titulo)}</title>
  <link rel="stylesheet" type="text/css" href="estilo.css" />
</head>
<body>
{cuerpo}
</body>
</html>
"""


def _nav(titulo: str, archivos, idioma: str) -> str:
    puntos = '\n'.join(f'      <li><a href="{archivo}">{escape(nombre)}</a></li>'
                       for archivo, nombre, _ in archivos if nombre)
    return _pagina(titulo, f"""<nav epub:type="toc" id="toc">
  <h1>Índice</h1>
  <ol>
{puntos}
  </ol>
</nav>""", idioma)


def _ncx(identificador: str, titulo: str, archivos) -> str:
    con_titulo = [(archivo, nombre) for archivo, nombre, _ in archivos if nombre]
    puntos = '\n'.join(f"""    <navPoint id="punto-{i}" playOrder="{i}">
      <navLabel><text>{escape(nombre)}</text></navLabel>
      <content src="{archivo}"/>
    </navPoint>""" for i, (archivo, nombre) in enumerate(con_titulo, start=1))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="{identificador}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>{escape(titulo)}</text></docTitle>
  <navMap>
{puntos}
  </navMap>
</ncx>
"""


def _opf(identificador: str, titulo: str, autor: str, idioma: str, archivos, imagenes: dict,
         con_portada: bool) -> str:
    ahora = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    manifiesto = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="estilo" href="estilo.css" media-type="text/css"/>',
    ]
    orden = []
    if con_portada:
        manifiesto.append('<item id="portada-imagen" href="imagenes/portada.jpg" media-type="image/jpeg" '
                          'properties="cover-image"/>')
        manifiesto.append('<item id="portada" href="portada.xhtml" media-type="application/xhtml+xml"/>')
        orden.append('<itemref idref="portada" linear="yes"/>')
    for i, (archivo, _, _) in enumerate(archivos, start=1):
        manifiesto.append(f'<item id="capitulo-{i}" href="{archivo}" media-type="application/xhtml+xml"/>')
        orden.append(f'<itemref idref="capitulo-{i}"/>')
    for i, ruta in enumerate(imagenes, start=1):
        tipo = TIPOS.get(ruta.rsplit('.', 1)[-1].lower(), 'image/png')
        manifiesto.append(f'<item id="imagen-{i}" href="{escape(ruta)}" media-type="{tipo}"/>')

    creador = f'\n    <dc:creator>{escape(autor.strip())}</dc:creator>' if autor.strip() else ''
    portada_epub2 = '\n    <meta name="cover" content="portada-imagen"/>' if con_portada else ''
    salto = '\n    '
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id-libro" xml:lang="{idioma}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id-libro">{identificador}</dc:identifier>
    <dc:title>{escape(titulo)}</dc:title>{creador}
    <dc:language>{idioma}</dc:language>
    <meta property="dcterms:modified">{ahora}</meta>{portada_epub2}
  </metadata>
  <manifest>
    {salto.join(manifiesto)}
  </manifest>
  <spine toc="ncx">
    {salto.join(orden)}
  </spine>
</package>
"""
