"""De Markdown a HTML, lo que comparten «Markdown a PDF» y el visor de Markdown.

Va aparte de `api/tools/markdown_a_pdf.py` porque aquello es maquetar con
WeasyPrint y esto no lo necesita: el visor enseña el mismo HTML en pantalla, y
así el documento que se ve es el que saldría en el PDF, con las mismas tablas
marcadas, las mismas listas de tareas y el mismo código coloreado. También
permite probar el render sin cargar WeasyPrint, que es lento.

Las razones de fondo —por qué markdown-it-py, por qué `html=True`, por qué los
saltos de línea sueltos se respetan por defecto— están en la cabecera de
`markdown_a_pdf.py`, y valen igual aquí.
"""
import re

from markdown_it import MarkdownIt
from markdown_it.token import Token
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

from errors import ApiError

# Lo que se le añade a CommonMark: las dos cosas de GitHub que escribe todo el
# mundo y que CommonMark no lleva de serie.
ANADIDOS = ['table', 'strikethrough']

# Color de acento: tiñe el filete del título, la banda de los apartados, la
# cabecera de las tablas, los enlaces y la barra de las citas. `oscuro` es la
# variante para texto sobre fondo claro y `tenue`, el fondo de las bandas.
COLORES_ACENTO = {
    'azul': {'base': '#1a56a8', 'oscuro': '#123f7c', 'tenue': '#eaf1fa'},
    'rojo': {'base': '#b3122c', 'oscuro': '#8a0d21', 'tenue': '#fbecee'},
    'verde': {'base': '#186b4c', 'oscuro': '#0f4f37', 'tenue': '#e8f3ee'},
    'grafito': {'base': '#3a4148', 'oscuro': '#23282d', 'tenue': '#eef0f2'},
}

NUMERICO = re.compile(r'^[−\-+]?\s*[\d.,\s]*\d\s*(€|%|\$|£)?$')


def cuerpo_html(texto: str, saltos: bool = True, portada: bool = True) -> str:
    """El Markdown convertido a HTML —sólo el cuerpo—, con las tablas ya leídas
    y marcadas.

    Se hace en dos tiempos —analizar, retocar, escribir— porque lo que se marca
    depende del contenido de las celdas, y retocar los tokens es más honrado que
    buscar `<tr>` con una expresión regular sobre el HTML ya escrito.

    `saltos` decide qué se hace con un salto de línea suelto: ver la cabecera
    de `markdown_a_pdf.py`. `portada` compone como portada lo que abre el
    documento antes del primer salto de página; es cosa de imprenta y en
    pantalla no se pide.
    """
    lector = MarkdownIt(
        'commonmark',
        {'html': True, 'breaks': saltos, 'highlight': _resaltar},
    ).enable(ANADIDOS)
    tokens = lector.parse(texto)

    _marcar_casillas(tokens)
    indice = 0
    while indice < len(tokens):
        if tokens[indice].type == 'table_open':
            fin = next(i for i in range(indice, len(tokens)) if tokens[i].type == 'table_close')
            _marcar_tabla(tokens[indice:fin + 1])
            indice = fin
        indice += 1

    cuerpo = lector.renderer.render(tokens, lector.options, {})
    if portada:
        cuerpo = _con_portada(tokens, cuerpo)
    return cuerpo.replace('<pre><code class="language-', '<pre class="resaltado"><code class="language-')


def _resaltar(codigo: str, lenguaje: str, _atributos) -> str:
    """Colorea un bloque de código si dice en qué lenguaje está."""
    if not lenguaje:
        return ''
    try:
        lexer = get_lexer_by_name(lenguaje.split()[0])
    except ClassNotFound:
        return ''
    return highlight(codigo, lexer, HtmlFormatter(nowrap=True, cssclass='resaltado'))


CASILLA = re.compile(r'^\[([ xX])\]\s+')


def _marcar_casillas(tokens) -> None:
    """Las listas de tareas de GitHub (`- [x] hecho`) con su casilla dibujada.

    La casilla es un `span` con borde y no un carácter ☐/☑: Inter no los trae
    y dependería de qué fuente de símbolos haya instalada.
    """
    for posicion, token in enumerate(tokens):
        if token.type != 'inline' or posicion < 2 or tokens[posicion - 2].type != 'list_item_open':
            continue
        primero = token.children[0] if token.children else None
        coincidencia = CASILLA.match(primero.content) if primero and primero.type == 'text' else None
        if not coincidencia:
            continue
        marcada = coincidencia.group(1) != ' '
        primero.content = primero.content[coincidencia.end():]
        casilla = Token('html_inline', '', 0)
        casilla.content = f'<span class="casilla{" marcada" if marcada else ""}"></span>'
        token.children.insert(0, casilla)
        tokens[posicion - 2].attrJoin('class', 'tarea')


SALTO = re.compile(r'<div[^>]*page-break-after:\s*always[^>]*>\s*</div>', re.IGNORECASE)


def _con_portada(tokens, html: str) -> str:
    """Si el documento abre con un título y poco más antes del primer salto de
    página, eso es una portada, y se compone como tal."""
    salto = SALTO.search(html)
    if not salto:
        return html
    antes = []
    for token in tokens:
        if token.type == 'html_block' and SALTO.search(token.content):
            break
        if token.nesting == 1 or token.type in ('fence', 'code_block', 'hr', 'html_block'):
            antes.append(token.type)
    permitido = {'heading_open', 'paragraph_open'}
    if 'heading_open' not in antes or set(antes) - permitido or len(antes) > 6:
        return html
    return f'<section class="portada">{html[:salto.start()]}</section>{html[salto.end():]}'


def _marcar_tabla(tokens) -> None:
    """Clases de fila, de columna y de tabla deducidas del contenido."""
    filas = []  # (token tr_open, [(token td/th, contenido)])
    for posicion, token in enumerate(tokens):
        if token.type == 'tr_open':
            filas.append((token, []))
        elif token.type in ('td_open', 'th_open') and filas:
            contenido = tokens[posicion + 1].content if posicion + 1 < len(tokens) else ''
            filas[-1][1].append((token, contenido.strip()))
    if not filas:
        return

    cuerpo = filas[1:]
    columnas = max(len(celdas) for _, celdas in filas)

    def en_negrita(celdas):
        llenas = [c for _, c in celdas if c]
        return bool(llenas) and all(re.fullmatch(r'\*\*.+\*\*|__.+__', c) for c in llenas)

    for numero, (tr, celdas) in enumerate(cuerpo):
        if en_negrita(celdas):
            tr.attrJoin('class', 'total' if numero == len(cuerpo) - 1 and numero > 0 else 'etiquetas')

    etiquetas = {id(tr) for tr, celdas in cuerpo if 'etiquetas' in (tr.attrGet('class') or '')}
    for columna in range(columnas):
        valores = [celdas[columna][1].strip('*_ ') for tr, celdas in cuerpo
                   if id(tr) not in etiquetas and columna < len(celdas) and celdas[columna][1]]
        if valores and sum(bool(NUMERICO.match(v)) for v in valores) >= len(valores) * 0.7:
            for tr, celdas in filas:
                if columna < len(celdas) and id(tr) not in etiquetas:
                    celdas[columna][0].attrJoin('class', 'numero')

    # Dos columnas cortas con importes: un cuadro de totales, no una tabla.
    textos = [c for _, celdas in filas for _, c in celdas]
    numerica = any('numero' in (celdas[-1][0].attrGet('class') or '') for _, celdas in cuerpo)
    if columnas == 2 and numerica and max((len(t) for t in textos), default=0) <= 32:
        tokens[0].attrJoin('class', 'cuadro')
    elif etiquetas:
        tokens[0].attrJoin('class', 'formulario')


def leer(ruta: str, nombre: str) -> str:
    """El texto del archivo, sea cual sea la codificación con la que lo guardaron.

    UTF-8 primero, que es lo que escribe cualquier cosa de este siglo, y con
    `-sig` para que un archivo hecho en Windows no empiece con un carácter
    invisible. Si no es UTF-8, casi siempre es la página de códigos de Windows.
    """
    with open(ruta, 'rb') as fh:
        crudo = fh.read()
    if not crudo.strip():
        raise ApiError(f'"{nombre}" está vacío: no hay nada que maquetar.', 422)
    for codificacion in ('utf-8-sig', 'cp1252'):
        try:
            return crudo.decode(codificacion)
        except UnicodeDecodeError:
            continue
    raise ApiError(f'No se ha podido leer el texto de "{nombre}": no parece un archivo '
                   'de texto.', 422)
