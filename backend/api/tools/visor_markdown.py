"""Herramienta: ver un Markdown en pantalla, bonito y sin guardar nada.

«Markdown a PDF» sirve para tener el documento; esto, para **leerlo** un momento.
Se sube un `.md` o se pega el texto y se enseña ya maquetado, sin escribir
ningún archivo: no usa `storage.reserve_output`, y en la sesión no queda más que
lo que el usuario haya subido.

**Lo dibuja el servidor con el mismo motor que el PDF** (`api/markdown_html.py`),
no una librería de JavaScript: así una tabla con importes, una lista de tareas
o un bloque de código se ven en pantalla igual que saldrían impresos, y no hay
dos intérpretes de Markdown que se desvíen en cuanto se toque uno.

**Seguridad.** El PDF lee el Markdown con `html=True`, y aquí ese HTML acaba en
el navegador de quien lo abre, así que se defiende en tres capas:

1. El documento lleva una CSP `default-src 'none'`: ni scripts, ni red, ni
   fuentes, ni marcos. Sólo estilos en línea e imágenes `data:`.
2. Se le quitan las etiquetas `<meta>`, `<base>` y `<link>` de dentro del texto:
   la CSP no cubre una redirección `<meta http-equiv="refresh">`, y `<base>`
   cambiaría a dónde apuntan los enlaces.
3. El cliente lo pone en un `<iframe sandbox>` sin `allow-scripts` y sin
   `allow-same-origin`.

Como en el PDF, las imágenes enlazadas no se descargan: se ven las que el propio
archivo trae incrustadas.
"""
import re

from flask import Blueprint, jsonify
from pygments.formatters import HtmlFormatter

from api import current_session, params
from api.markdown_html import COLORES_ACENTO, cuerpo_html, leer
from errors import ApiError
from storage import storage

bp = Blueprint('visor_markdown', __name__, url_prefix='/api/tools')

EXTENSIONES_ADMITIDAS = {'.md'}

# Un Markdown de verdad no llega ni a una décima parte de esto: es la red para
# que nadie pida maquetar cien megas de texto.
MAXIMO_CARACTERES = 2_000_000

TEMAS = {'claro', 'oscuro'}

# Sin nombres de fuente que sólo estén en la imagen del servidor: quien lee es
# el navegador, y con lo que haya en su equipo. Inter y Charis van primero por
# si las tiene, y detrás lo corriente de cada sistema.
FAMILIAS = {
    'sans': "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif",
    'serif': "'Charis SIL', Georgia, Cambria, 'Times New Roman', 'DejaVu Serif', serif",
}
MONO = "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace"

# Lo que no debe llegar al navegador de lo que trae el Markdown en HTML crudo:
# ver el punto 2 de la cabecera.
ETIQUETAS_PROHIBIDAS = re.compile(r'<\s*(?:meta|base|link)\b[^>]*>', re.IGNORECASE)

CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"

# Los colores que cambian con el tema. `acento` y `acento_texto` los rellena
# `_variables` a partir del color elegido.
PALETAS = {
    'claro': {
        'fondo': '#ffffff', 'texto': '#1f2328', 'titulo': '#14181c', 'suave': '#4a535c',
        'borde': '#d9dee3', 'zebra': '#f6f8fa', 'codigo': '#eef1f4', 'bloque': '#f6f8fa',
        'borde_bloque': '#dfe4e9', 'linea': '#d5dbe1', 'casilla': '#8a949e',
        'hecha': '#6b747d', 'etiqueta': '#eef1f4', 'borde_form': '#c9d0d7',
        'sobre_acento': '#ffffff',
    },
    'oscuro': {
        'fondo': '#16191d', 'texto': '#d7dce1', 'titulo': '#f1f3f5', 'suave': '#a5aeb8',
        'borde': '#33393f', 'zebra': '#1d2126', 'codigo': '#262b31', 'bloque': '#1d2126',
        'borde_bloque': '#33393f', 'linea': '#3a4148', 'casilla': '#7b8590',
        'hecha': '#8a949e', 'etiqueta': '#242a30', 'borde_form': '#3d454c',
        'sobre_acento': '#ffffff',
    },
}

# Pygments: el mismo `friendly` que el PDF en claro y uno oscuro en oscuro.
RESALTADO = {'claro': 'friendly', 'oscuro': 'monokai'}

ESTILOS = """
* { box-sizing: border-box; }
html { background: var(--fondo); color: var(--texto); font-family: var(--letra);
       font-size: 16px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
body { margin: 0; }
main { max-width: 780px; margin: 0 auto; padding: 28px 20px 56px; overflow-wrap: anywhere; }

h1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: 700; }
h1 { font-size: 2em; color: var(--titulo); letter-spacing: -0.01em; margin: 0 0 0.7em;
     padding-bottom: 0.3em; border-bottom: 3px solid var(--acento); }
h2 { font-size: 1.3em; color: var(--acento-texto); background: var(--tenue);
     border-left: 4px solid var(--acento); padding: 0.3em 0.7em; margin: 1.6em 0 0.8em; }
h3 { font-size: 1.1em; color: var(--acento-texto); margin: 1.3em 0 0.5em; }
h4, h5, h6 { font-size: 1em; color: var(--titulo); margin: 1.1em 0 0.4em; }
h1 + h2, h2 + h3 { margin-top: 0.7em; }

p { margin: 0 0 0.8em; }
p[align="center"] { text-align: center; }
p[align="right"] { text-align: right; }
h1 + p { color: var(--suave); }
a { color: var(--acento-texto); text-decoration: underline; text-underline-offset: 2px; }
strong { color: var(--titulo); }
hr { border: 0; border-top: 1px solid var(--linea); margin: 1.5em 0; }
img { max-width: 100%; height: auto; }
div[style*="page-break"] { height: 0; border-top: 1px dashed var(--linea); margin: 2em 0; }

ul, ol { margin: 0 0 0.8em; padding-left: 1.6em; }
li { margin: 0.2em 0; }
li > ul, li > ol { margin: 0.15em 0 0.25em; }
ul > li::marker { color: var(--acento-texto); }
ol > li::marker { color: var(--acento-texto); font-weight: 600; }

table { display: block; width: max-content; max-width: 100%; overflow-x: auto;
        border-collapse: collapse; margin: 0.4em 0 1.2em; font-size: 0.94em; line-height: 1.4; }
th { background: var(--acento); color: var(--sobre-acento); font-weight: 600; text-align: left;
     padding: 0.5em 0.8em; border: 1px solid var(--acento); }
td { padding: 0.45em 0.8em; border-bottom: 1px solid var(--borde); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--zebra); }
td.numero, th.numero { text-align: right; white-space: nowrap; }
tr.etiquetas td { background: var(--etiqueta); color: var(--suave); font-size: 0.88em;
                  padding-top: 0.3em; padding-bottom: 0.3em; }
tr.etiquetas td strong { color: var(--suave); font-weight: 600; }
tr.total td { background: var(--tenue); border-top: 2px solid var(--acento); border-bottom: 0; }
table.cuadro { min-width: 45%; margin-left: auto; }
table.cuadro th { background: none; color: inherit; font-weight: 400; border: 0;
                  border-bottom: 1px solid var(--borde); }
table.formulario th, table.formulario tr.etiquetas td { background: var(--etiqueta);
    color: var(--suave); font-size: 0.88em; font-weight: 600;
    border: 1px solid var(--borde-form); padding: 0.3em 0.8em; }
table.formulario td { border: 1px solid var(--borde-form); background: none; }
table.formulario tbody tr:nth-child(even) td { background: none; }
table.formulario tbody tr.etiquetas td { background: var(--etiqueta); }

li.tarea { list-style: none; margin-left: -1.3em; }
.casilla { display: inline-block; width: 0.85em; height: 0.85em; margin-right: 0.5em;
           border: 1.5px solid var(--casilla); border-radius: 3px; vertical-align: -0.1em; }
.casilla.marcada { background: var(--acento); border-color: var(--acento); }
li.tarea:has(.marcada) { color: var(--hecha); }

blockquote { margin: 0.3em 0 1em; padding: 0.5em 1em; border-left: 4px solid var(--acento);
             background: var(--bloque); color: var(--suave); }
blockquote p:last-child { margin-bottom: 0; }

code { font-family: var(--mono); font-size: 0.88em; background: var(--codigo);
       border-radius: 4px; padding: 0.1em 0.35em; }
pre { font-family: var(--mono); font-size: 0.85em; line-height: 1.5; background: var(--bloque);
      border: 1px solid var(--borde-bloque); border-radius: 6px; padding: 0.8em 1em;
      margin: 0.3em 0 1em; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 1em; }

@media (max-width: 480px) {
  html { font-size: 15px; }
  main { padding: 20px 14px 40px; }
}
"""


@bp.post('/visor-markdown/previsualizar')
def previsualizar():
    session_id = current_session()
    datos = params.cuerpo()

    ajustes = {
        'familia': params.opcion(datos, 'familia', FAMILIAS, 'sans'),
        'acento': params.opcion(datos, 'acento', COLORES_ACENTO, 'azul'),
        # Marcado, como en «Markdown a PDF»: lo que se pega suele traer una
        # línea por renglón.
        'saltos': params.booleano(datos, 'saltos', True),
        'tema': params.opcion(datos, 'tema', TEMAS, 'claro'),
    }

    texto = _texto(session_id, datos)
    if not texto.strip():
        raise ApiError('No hay nada que ver: el texto está vacío.', 422)
    if len(texto) > MAXIMO_CARACTERES:
        raise ApiError('El texto pasa de dos millones de caracteres: es demasiado para verlo '
                       'aquí. Pártelo en varios archivos.', 413)

    return jsonify({
        'html': documento(texto, **ajustes),
        'palabras': len(re.findall(r'\w+', texto)),
    })


def _texto(session_id: str, datos: dict) -> str:
    """El Markdown que hay que enseñar: el pegado o el de un archivo subido."""
    texto = datos.get('texto')
    if texto is not None and not isinstance(texto, str):
        raise ApiError('El texto no es válido.', 400)

    if texto is not None:
        if datos.get('file_ids'):
            raise ApiError('Envía el texto o el archivo, no los dos a la vez.', 400)
        return texto

    file_ids = params.ids(datos, minimo=1, mensaje='Sube un archivo Markdown o pega el texto.')
    if len(file_ids) > 1:
        raise ApiError('El visor abre un archivo cada vez.', 400)
    record = storage.record_of(session_id, file_ids[0])
    if record.ext not in EXTENSIONES_ADMITIDAS:
        raise ApiError(f'"{record.name}" no es un archivo Markdown (.md).', 400)
    return leer(storage.path_of(session_id, file_ids[0]), record.name)


def documento(texto: str, familia: str = 'sans', acento: str = 'azul', saltos: bool = True,
              tema: str = 'claro') -> str:
    """El documento HTML completo, con su hoja de estilos y su CSP."""
    cuerpo = ETIQUETAS_PROHIBIDAS.sub('', cuerpo_html(texto, saltos, portada=False))
    resaltado = HtmlFormatter(style=RESALTADO[tema]).get_style_defs('.resaltado')
    return (
        '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<base target="_blank">'
        f'<style>{_variables(familia, acento, tema)}{ESTILOS}{resaltado}</style>'
        f'</head><body><main>{cuerpo}</main></body></html>'
    )


def _variables(familia: str, acento: str, tema: str) -> str:
    """Las variables CSS del tema y del color de acento elegidos."""
    paleta = PALETAS[tema]
    color = COLORES_ACENTO[acento]
    if tema == 'claro':
        base, texto, tenue = color['base'], color['oscuro'], color['tenue']
    else:
        # Sobre fondo oscuro, el azul del PDF apenas se lee: se aclara para el
        # texto y las bandas se tiñen de él en vez de ser casi blancas.
        base = _mezclar(color['base'], '#ffffff', 0.15)
        texto = _mezclar(color['base'], '#ffffff', 0.55)
        tenue = _mezclar(color['base'], paleta['fondo'], 0.78)
    variables = {
        **paleta, 'acento': base, 'acento_texto': texto, 'tenue': tenue,
        'letra': FAMILIAS[familia], 'mono': MONO,
    }
    cuerpo = ''.join(f'--{nombre.replace("_", "-")}:{valor};' for nombre, valor in variables.items())
    return f':root{{{cuerpo}color-scheme:{"dark" if tema == "oscuro" else "light"};}}'


def _mezclar(color: str, con: str, parte: float) -> str:
    """`color` con una `parte` (0 a 1) de `con` mezclada, como '#rrggbb'."""
    a = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(con[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * parte):02x}' for x, y in zip(a, b))
