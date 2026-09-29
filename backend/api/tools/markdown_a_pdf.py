"""Herramienta: maquetar un Markdown y entregarlo como PDF.

Es la vuelta de "Documento a Markdown", que cierra el círculo: de un PDF sale el
texto para dárselo a un LLM, y lo que el LLM devuelve —que casi siempre es
Markdown— vuelve a ser un documento presentable sin pasar por un editor. La
vara de medir es esa: que el PDF que sale **se reconozca como el documento del
que salió el Markdown** —sus apartados, sus tablas, sus importes alineados— y
que tenga aspecto de documento cuidado, no de volcado de texto.

**Quién lo maqueta: WeasyPrint.** Convierte HTML y CSS de impresión en PDF, sin
navegador y sin programas de fuera. La primera versión usaba `fitz.Story` de
PyMuPDF, y MuPDF entiende un subconjunto de CSS que se quedaba corto justo en lo
que hace que un documento parezca un documento: las tablas no se pueden
estirar al ancho de la página (siempre se encogen al contenido), no hay fondos
en elementos en línea (el `código` no se distingue), no entiende `nth-child`,
no numera páginas y cada nivel de lista a partir del segundo pide una fuente de
símbolos entera. WeasyPrint hace todo eso con CSS normal: `@page` con el pie
«Página n de N», cabeceras de tabla que se repiten al saltar de página, filas
que no se parten, bloques de código que no se cortan si caben enteros.
Chromium habría sido todavía más fiel, pero son cientos de megas en la imagen y
un proceso por petición.

**Quién lee el Markdown, y por qué éste y no otro.** `markdown-it-py`, que sigue
CommonMark. La primera versión usaba Python-Markdown y **se equivocaba con
documentos normales**: exige una línea en blanco antes de cada tabla, cosa que
casi nadie escribe, y aplana las listas anidadas con dos espacios de sangría.
**Los saltos de línea sueltos se respetan por defecto**, que es lo contrario de
lo que manda el estándar. En Markdown, dos líneas seguidas son un mismo párrafo,
y eso está bien para quien escribe prosa partida a lo ancho. Pero lo que más
entra aquí no es eso: es texto sacado de otro documento —el que devuelve
"Documento a Markdown", por ejemplo— con una línea por renglón y ninguna línea
en blanco. Fundirlas convierte el documento en un ladrillo: el título, el
subtítulo y los apartados acaban en la misma frase, y así llegó la queja que
originó esta opción. Se puede desmarcar, y entonces manda el estándar.

Va con `html=True` para que el `<br>` de dentro de una celda sea un salto de
línea de verdad, y para respetar el `<p align="…">` con el que "Documento a
Markdown" conserva un texto centrado o a la derecha.

**Las tablas se leen antes de pintarlas.** Al pasar los tokens a HTML se marca
cada tabla con lo que el Markdown dice sin decirlo: una fila con todas las
celdas en negrita es una fila de etiquetas (como en un impreso), la última en
negrita es la de totales, y una tabla de dos columnas cortas con importes es un
cuadro de totales, que va a la derecha y no a todo el ancho, como en una factura.
Las columnas numéricas se alinean a la derecha aunque el Markdown no lo pida.

**Tipografías.** Inter para la de palo seco, Charis SIL para la de remates y
DejaVu Sans Mono para el código, instaladas en la imagen desde Debian
(`fonts-inter`, `fonts-sil-charis`, `fonts-dejavu-mono`). Se nombran por su
nombre y no con las genéricas de CSS para que el resultado no dependa de lo que
fontconfig decida elegir. WeasyPrint incrusta sólo los caracteres usados, así
que el PDF pesa decenas de kB y no cientos, y el € sale entero.

**Nada se sale a buscar.** El `URLFetcher` sólo admite `data:`: un
`![](/etc/hostname)` o un `src` con `http://` no leen nada del disco ni piden
nada a la red —además no hay `base_url`, así que una ruta relativa ni siquiera
llega a pedirse—. Lo único que se incrusta son las imágenes que el propio
archivo trae dentro. Lo demás deja el hueco y se sigue.

**Lo que no hace.** No resuelve imágenes enlazadas, por lo mismo de arriba.
"""
import logging

from flask import Blueprint, jsonify
from pygments.formatters import HtmlFormatter
from weasyprint import CSS, HTML
from weasyprint.text.fonts import FontConfiguration
from weasyprint.urls import URLFetcher

import config
from api import current_session, params, progreso
from api import limites
from api.markdown_html import COLORES_ACENTO, cuerpo_html, leer
from errors import ApiError
from storage import storage, cambiar_extension

bp = Blueprint('markdown_a_pdf', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('MARKDOWN_TIMEOUT_SECONDS', 120)

# WeasyPrint y fontTools cuentan cada paso y cada glifo recortado a nivel INFO:
# decenas de líneas por documento que ahogarían el registro del servidor.
for _ruidoso in ('weasyprint', 'weasyprint.progress', 'fontTools'):
    logging.getLogger(_ruidoso).setLevel(logging.WARNING)

EXTENSIONES_ADMITIDAS = {'.md'}

# Tamaños de página en milímetros, para `@page { size }`.
PAGINAS = {'a4': (210, 297), 'carta': (215.9, 279.4)}
ORIENTACIONES = {'vertical', 'horizontal'}

FAMILIAS = {
    'sans': "'Inter', 'DejaVu Sans', sans-serif",
    'serif': "'Charis SIL', 'DejaVu Serif', serif",
}
MONO = "'DejaVu Sans Mono', monospace"

MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM, MARGEN_POR_DEFECTO_MM = 10, 40, 20

# 11 pt es el cuerpo de un documento de oficina. Por debajo de 8 no se lee en
# papel y por encima de 16 no es un documento, es un cartel.
CUERPO_MINIMO, CUERPO_MAXIMO, CUERPO_POR_DEFECTO = 8, 16, 11

# Tope de páginas. Es una red, no un límite de producto: WeasyPrint tarda unos
# 75 ms por página con tablas (medido: 63 páginas en 4,6 s), así que 1000
# páginas rondan los 75 s, holgados dentro de los 300 de gunicorn. Un documento
# más largo se parte.
MAXIMO_PAGINAS = 1000

ESTILOS = """
@page {{
  size: {ancho}mm {alto}mm;
  margin: {margen}mm {margen}mm {margen_inferior}mm {margen}mm;
  @bottom-left {{
    content: string(titulo);
    font: {pie}pt {familia}; color: #7b8590;
  }}
  @bottom-right {{
    content: "Página " counter(page) " de " counter(pages);
    font: {pie}pt {familia}; color: #7b8590;
  }}
}}

html {{ font-family: {familia}; font-size: {cuerpo}pt; line-height: 1.5; color: #1f2328; }}
body {{ margin: 0; }}

h1, h2, h3, h4, h5, h6 {{ line-height: 1.25; break-after: avoid; font-weight: 700; }}
h1 {{ string-set: titulo content(); font-size: 2em; color: #14181c; letter-spacing: -0.01em;
     margin: 0 0 0.7em; padding-bottom: 0.3em; border-bottom: 2.5pt solid {acento}; }}
h2 {{ font-size: 1.2em; color: {acento_oscuro}; background: {acento_tenue};
     border-left: 3pt solid {acento}; padding: 0.3em 0.6em; margin: 1.4em 0 0.7em; }}
h3 {{ font-size: 1.07em; color: {acento_oscuro}; margin: 1.2em 0 0.45em; }}
h4, h5, h6 {{ font-size: 1em; color: #2b3137; margin: 1em 0 0.35em; }}
h1 + h2, h2 + h3 {{ margin-top: 0.6em; }}

p {{ margin: 0 0 0.65em; orphans: 2; widows: 2; }}
p[align="center"] {{ text-align: center; }}
p[align="right"] {{ text-align: right; }}
h1 + p {{ color: #4a535c; }}
a {{ color: {acento}; text-decoration: none; }}
strong {{ color: #14181c; }}
hr {{ border: 0; border-top: 0.6pt solid #d5dbe1; margin: 1.2em 0; }}
img {{ max-width: 100%; }}

ul, ol {{ margin: 0 0 0.65em; padding-left: 1.4em; }}
li {{ margin: 0.15em 0; }}
li > ul, li > ol {{ margin: 0.1em 0 0.2em; }}
ul > li::marker {{ color: {acento}; }}
ol > li::marker {{ color: {acento_oscuro}; font-weight: 600; }}

table {{ width: 100%; border-collapse: collapse; margin: 0.35em 0 1em; font-size: 0.92em;
        line-height: 1.35; }}
thead {{ display: table-header-group; }}
tr {{ break-inside: avoid; }}
th {{ background: {acento}; color: #ffffff; font-weight: 600; text-align: left;
     padding: 0.45em 0.65em; border: 0.5pt solid {acento}; }}
td {{ padding: 0.42em 0.65em; border-bottom: 0.5pt solid #d9dee3; vertical-align: top; }}
tbody tr:nth-child(even) td {{ background: #f6f8fa; }}
td.numero, th.numero {{ text-align: right; white-space: nowrap; }}
tr.etiquetas td {{ background: #eef1f4; color: #4a535c; font-size: 0.85em;
                  padding-top: 0.3em; padding-bottom: 0.3em; }}
tr.etiquetas td strong {{ color: #4a535c; font-weight: 600; }}
tr.total td {{ background: {acento_tenue}; border-top: 1pt solid {acento}; border-bottom: 0; }}
table.cuadro {{ width: auto; min-width: 45%; margin-left: auto; }}
table.cuadro td {{ border-bottom: 0.5pt solid #d9dee3; }}

table.cuadro th {{ background: none; color: inherit; font-weight: 400; border: 0;
                 border-bottom: 0.5pt solid #d9dee3; }}
table.formulario th, table.formulario tr.etiquetas td {{ background: #eef1f4; color: #4a535c;
    font-size: 0.85em; font-weight: 600; border: 0.5pt solid #c9d0d7; padding: 0.3em 0.65em; }}
table.formulario td {{ border: 0.5pt solid #c9d0d7; background: none; }}
table.formulario tbody tr:nth-child(even) td {{ background: none; }}
table.formulario tbody tr.etiquetas td {{ background: #eef1f4; }}

section.portada {{ break-after: page; padding: 32% 0 0 1.1em; border-left: 7pt solid {acento};
                  min-height: 60%; }}
section.portada h1 {{ font-size: 2.7em; border: 0; color: {acento_oscuro}; margin-bottom: 0.5em; }}
section.portada p {{ font-size: 1.2em; color: #4a535c; }}

li.tarea {{ list-style: none; margin-left: -1.1em; }}
.casilla {{ display: inline-block; width: 0.8em; height: 0.8em; margin-right: 0.45em;
           border: 0.9pt solid #8a949e; border-radius: 2pt; vertical-align: -0.08em; }}
.casilla.marcada {{ background: {acento}; border-color: {acento}; }}
li.tarea:has(.marcada) {{ color: #6b747d; }}

blockquote {{ margin: 0.2em 0 0.9em; padding: 0.5em 0.9em; border-left: 3pt solid {acento};
             background: #f6f8fa; color: #3d4650; }}
blockquote p:last-child {{ margin-bottom: 0; }}

code {{ font-family: {mono}; font-size: 0.86em; background: #eef1f4; border-radius: 2.5pt;
       padding: 0.05em 0.3em; }}
pre {{ font-family: {mono}; font-size: 0.82em; line-height: 1.45; background: #f6f8fa;
      border: 0.5pt solid #dfe4e9; border-radius: 4pt; padding: 0.75em 0.9em;
      margin: 0.2em 0 0.9em; white-space: pre-wrap; break-inside: avoid; }}
pre code {{ background: none; padding: 0; font-size: 1em; }}
"""


@bp.post('/markdown-a-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La maquetación')
def markdown_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un archivo Markdown.')

    opciones = {
        'pagina': params.opcion(datos, 'pagina', PAGINAS, 'a4'),
        'orientacion': params.opcion(datos, 'orientacion', ORIENTACIONES, 'vertical'),
        'familia': params.opcion(datos, 'familia', FAMILIAS, 'sans'),
        'acento': params.opcion(datos, 'acento', COLORES_ACENTO, 'azul'),
        # Viene marcado: el caso corriente aquí es texto pegado o sacado de otro
        # documento, donde cada renglón es una línea y fundirlas arruina la página.
        'saltos': params.booleano(datos, 'saltos', True),
        'cuerpo': params.entero(datos, 'cuerpo', CUERPO_POR_DEFECTO, CUERPO_MINIMO, CUERPO_MAXIMO),
        'margen': params.entero(datos, 'margen', MARGEN_POR_DEFECTO_MM,
                                MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM),
    }

    # Se resuelve y valida todo antes de maquetar nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in EXTENSIONES_ADMITIDAS:
            raise ApiError(f'"{record.name}" no es un archivo Markdown (.md).', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))

    resultados = []
    for record, ruta in progreso.contando(entradas, len(entradas),
                                         'Maquetando documentos'):
        pdf = generar(leer(ruta, record.name), record.name, **opciones)
        destino, salida = storage.reserve_output(
            session_id, cambiar_extension(record.name, '.pdf'))
        with open(destino, 'wb') as fichero:
            fichero.write(pdf)
        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def generar(texto: str, nombre: str, pagina: str = 'a4', orientacion: str = 'vertical',
            familia: str = 'sans', acento: str = 'azul', cuerpo: int = CUERPO_POR_DEFECTO,
            margen: int = MARGEN_POR_DEFECTO_MM, saltos: bool = True) -> bytes:
    """El Markdown maquetado como PDF, en bytes."""
    html = _a_html(texto, saltos)
    fuentes = FontConfiguration()
    hoja = CSS(string=_estilos(pagina, orientacion, familia, acento, cuerpo, margen),
               font_config=fuentes)
    try:
        documento = HTML(string=html, url_fetcher=URLFetcher(allowed_protocols={'data'})) \
            .render(stylesheets=[hoja], font_config=fuentes)
    except Exception as err:
        raise ApiError(f'No se ha podido maquetar "{nombre}": {err}', 422) from err
    if len(documento.pages) > MAXIMO_PAGINAS:
        raise ApiError(
            f'"{nombre}" pasa de {MAXIMO_PAGINAS} páginas maquetado. Pártelo en varios '
            'archivos o sube el margen y baja el cuerpo de letra.', 413)
    return documento.write_pdf()


def _estilos(pagina: str, orientacion: str, familia: str, acento: str, cuerpo: int,
             margen: int) -> str:
    """La hoja de estilos con la página, la letra y el color ya resueltos.

    Los títulos y el código van en `em`, así que suben con el cuerpo: quien lo
    sube a 14 porque va a imprimir para alguien que no ve bien espera que los
    títulos suban con él. El margen inferior deja sitio al pie de página.
    """
    ancho, alto = PAGINAS[pagina]
    if orientacion == 'horizontal':
        ancho, alto = alto, ancho
    color = COLORES_ACENTO[acento]
    estilos = ESTILOS.format(
        ancho=ancho, alto=alto, margen=margen, margen_inferior=margen + 4,
        familia=FAMILIAS[familia], mono=MONO, cuerpo=cuerpo, pie=max(7, round(cuerpo * 0.72, 1)),
        acento=color['base'], acento_oscuro=color['oscuro'], acento_tenue=color['tenue'],
    )
    return estilos + HtmlFormatter(style='friendly').get_style_defs('.resaltado')


def _a_html(texto: str, saltos: bool = True) -> str:
    """El documento HTML completo que se le da a WeasyPrint."""
    cuerpo = cuerpo_html(texto, saltos)
    return f'<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>{cuerpo}</body></html>'
