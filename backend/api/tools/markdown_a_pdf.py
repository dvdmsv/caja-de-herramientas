"""Herramienta: maquetar un Markdown y entregarlo como PDF.

Es la vuelta de "Documento a Markdown", que cierra el círculo: de un PDF sale el
texto para dárselo a un LLM, y lo que el LLM devuelve —que casi siempre es
Markdown— vuelve a ser un documento presentable sin pasar por un editor.

**Quién lo maqueta.** PyMuPDF, con `fitz.Story`: se convierte el Markdown a HTML
y se le da a MuPDF, que lo va colocando en páginas. No hace falta ningún
programa de fuera, así que esta herramienta no pasa por el turno de
`api/conversion.py` como "Documento a PDF": es código de esta misma casa y
trabaja en milisegundos. Medido: 135 kB de Markdown, 156 páginas, 220 ms.

**Quién lee el Markdown, y por qué éste y no otro.** `markdown-it-py`, que sigue
CommonMark. La primera versión usaba Python-Markdown y **se equivocaba con
documentos normales**: es el más estricto de los tres motores de Python y exige
una línea en blanco antes de cada tabla, cosa que casi nadie escribe. Sin ella
escupía la tabla en crudo —los `|` y los `---` como texto corrido—, que es
exactamente lo que le pasó a un usuario con una rutina de gimnasio. Medido sobre
los mismos ejemplos, Python-Markdown fallaba cuatro casos que markdown-it
resuelve:

- una tabla que sigue a un párrafo sin línea en blanco (lo de arriba);
- una lista anidada con **dos espacios** de sangría, que es como se escribe en
  todas partes; Python-Markdown exige cuatro y, si no, aplana los niveles;
- una lista pegada al párrafo anterior;
- el tachado `~~así~~`.

**Los saltos de línea sueltos se respetan por defecto**, que es lo contrario de
lo que manda el estándar. En Markdown, dos líneas seguidas son un mismo párrafo,
y eso está bien para quien escribe prosa partida a lo ancho. Pero lo que más
entra aquí no es eso: es texto sacado de otro documento —el que devuelve
"Documento a Markdown", por ejemplo— con una línea por renglón y ninguna línea
en blanco. Fundirlas convierte el documento en un ladrillo: el título, el
subtítulo y los apartados acaban en la misma frase, y así llegó la queja que
originó esta opción. Se puede desmarcar, y entonces manda el estándar.

Va con `html=True` para que el `<br>` de dentro de una celda sea un salto de
línea de verdad: las tablas que escribe un LLM lo usan constantemente para poner
una nota debajo del nombre, y con el HTML desactivado saldría el literal `<br>`
en mitad del texto. Lo que entra por ahí es HTML que acaba en MuPDF, que ni lee
del disco ni sale a la red (ver abajo): lo peor que puede hacer un documento
raro es quedar raro.

El parser se construye en cada petición, no una vez en el módulo: cuesta 0,11 ms
—nada al lado de los 20 ms de maquetar— y así no hay que preguntarse si es
seguro compartirlo entre los cuatro hilos del worker.

LibreOffice era la alternativa —convertir a HTML y dárselo—, y se descartó por
tres razones: tarda segundos en arrancar, ocuparía el turno que hoy se reparten
el OCR y la ofimática, y no da control sobre la maquetación. Pandoc pedía un
motor de PDF aparte (LaTeX o Chromium), que son cientos de megas en la imagen
por una herramienta que aquí sale gratis.

**Nada se sale a buscar.** `fitz.Story` sólo resuelve imágenes contra un
`Archive`, y aquí no se le da ninguno: comprobado, un `![](/etc/hostname)` no
lee nada del disco y un `src` con `http://` no pide nada a la red. Lo único que
se incrusta son las imágenes `data:` que el propio archivo trae dentro. Con
cualquier otra, MuPDF deja el hueco y sigue.

**Por qué el PDF pesa lo que pesa.** Unos 100 kB con una página, y unos 390 si el
documento lleva listas anidadas: MuPDF incrusta enteras las tipografías con las
que compone —no sabe referenciar las catorce de serie sin incrustarlas— y para
el `○` del segundo nivel de una lista carga una fuente de símbolos entera, 285
kB para dibujar un círculo. Se intentó evitarla con `list-style-type`, pero
MuPDF sólo atiende ese ajuste en el primer nivel de anidamiento.

PyMuPDF trae `subset_fonts()` para recortar lo que no se usa —deja ese mismo
archivo en 82 kB, medido— y **no se usa a propósito**: en la versión que lleva
este proyecto (1.24.10) el recorte se come el **signo del euro**. Comprobado
carácter a carácter, es el único que se pierde: £, ¥, ©, ®, ™, †, ‰, æ y las
vocales acentuadas sobreviven, y el € desaparece dejando su hueco —con el texto
todavía en el archivo, así que ni copiándolo se nota—. Un documento que se
manda o se imprime no puede perder precisamente ese carácter, así que aquí pesa
más y sale entero. Si algún día sube la versión de PyMuPDF, esto se vuelve a
medir antes de tocarlo.

**Lo que no hace.** No resuelve las imágenes enlazadas —el servidor no tiene esos
archivos, y salir a por ellos convertiría esto en un mensajero para pedir cosas
en nombre del servidor— y no colorea el código.
"""
import fitz  # PyMuPDF
from flask import Blueprint, jsonify
from markdown_it import MarkdownIt

from api import current_session, params
from errors import ApiError
from storage import storage, cambiar_extension

bp = Blueprint('markdown_a_pdf', __name__, url_prefix='/api/tools')

EXTENSIONES_ADMITIDAS = {'.md'}

# Tamaños de página en puntos PostScript, los mismos que "Imagen a PDF".
PAGINAS = {'a4': (595.28, 841.89), 'carta': (612.0, 792.0)}
ORIENTACIONES = {'vertical', 'horizontal'}

# Qué familia pide el CSS.
#
# Se nombran las dos clásicas del PDF en vez de las genéricas de CSS a
# propósito: MuPDF resuelve `Helvetica` y `Times` a Nimbus Sans y Nimbus Roman,
# que son las equivalentes métricas de las que usa el resto de la aplicación
# (`api/tipografia.py`), mientras que `serif` a secas le saca una Charis SIL que
# aquí no pinta nada. Lo mismo escrito, la misma letra.
FAMILIAS = {'sans': 'Helvetica', 'serif': 'Times'}

MILIMETRO = 72 / 25.4
MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM, MARGEN_POR_DEFECTO_MM = 10, 40, 20

# 11 pt es el cuerpo de un documento de oficina. Por debajo de 8 no se lee en
# papel y por encima de 16 no es un documento, es un cartel.
CUERPO_MINIMO, CUERPO_MAXIMO, CUERPO_POR_DEFECTO = 8, 16, 11

# Lo que se le añade a CommonMark: las dos cosas de GitHub que escribe todo el
# mundo y que CommonMark no lleva de serie. Los bloques cercados con ``` y las
# listas numeradas ya vienen dentro.
ANADIDOS = ['table', 'strikethrough']

# Tope de páginas, y no de tamaño del archivo.
#
# No es un límite de producto, es una red: el bucle de maquetación repite hasta
# que MuPDF dice que ya no queda contenido, y si algún día un documento no
# convergiera, ese bucle escribiría páginas hasta llenar el disco. Se probaron
# los casos que lo tentarían —una palabra de 5000 letras, una tabla de 40
# columnas, 200 citas anidadas, un área de 2 pt— y todos terminan, así que esto
# no debería saltar nunca. Acota de paso el disparate: 2000 páginas son unos
# 1,7 MB de Markdown, bastante más de lo que nadie maqueta de una vez.
MAXIMO_PAGINAS = 2000

# Color de acento: lo que separa un documento de un volcado de texto. Tiñe el
# filete del título, los subtítulos, los enlaces y la barra de las citas.
COLORES_ACENTO = {
    'azul': '#1a56a8',
    'rojo': '#b3122c',
    'verde': '#186b4c',
    'grafito': '#3a4148',
}

# Fondo de las filas pares de una tabla. No se puede pedir con
# `tr:nth-child(even)` —MuPDF no entiende ese selector, comprobado—, así que las
# filas se marcan una a una con la clase `rayada` al convertir el Markdown.
CLASE_RAYADA = 'rayada'

# La hoja de estilos. Va aquí y no en un archivo aparte porque es corta y porque
# leerla al lado de lo que la usa ahorra el viaje.
#
# Cada regla está comprobada contra MuPDF, que entiende un subconjunto de CSS y
# no avisa de lo que ignora. Lo que **sí** respeta y se usa aquí: familias,
# cuerpos, colores de texto y de fondo, márgenes, rellenos, bordes por lado,
# `text-transform`, `letter-spacing` y los selectores por clase. Lo que ignora,
# y por eso no está: `width` en las tablas (siempre se ajustan al contenido, se
# les pida lo que se les pida), `nth-child`, y los fondos y rellenos sobre
# elementos en línea como `span`.
ESTILOS = """
body {{ font-family: {familia}; font-size: {cuerpo}pt; line-height: 1.45; color: #1f2328; }}

h1 {{ font-size: {h1:.1f}pt; color: #14181c; margin: 0 0 9pt 0;
     border-bottom: 2pt solid {acento}; padding-bottom: 5pt; }}
h2 {{ font-size: {h2:.1f}pt; color: #14181c; margin: 17pt 0 6pt 0;
     border-bottom: 0.6pt solid #dde1e5; padding-bottom: 3pt; }}
h3 {{ font-size: {h3:.1f}pt; color: {acento}; margin: 14pt 0 5pt 0; }}
h4, h5, h6 {{ font-size: {h4:.1f}pt; color: #3a4148; margin: 12pt 0 4pt 0; }}

p {{ margin: 0 0 {parrafo:.1f}pt 0; }}
ul, ol {{ margin: 0 0 {parrafo:.1f}pt 0; }}
li {{ margin: 0 0 3pt 0; }}
a {{ color: {acento}; }}
hr {{ border: none; border-top: 0.6pt solid #dde1e5; margin: 14pt 0; }}

table {{ margin: 4pt 0 {parrafo:.1f}pt 0; border-collapse: collapse; }}
th {{ background-color: #23272b; color: #ffffff; text-align: left;
     font-size: {cabecera:.1f}pt; text-transform: uppercase; letter-spacing: 0.5pt;
     padding: 5pt; }}
td {{ padding: 5pt; border-bottom: 0.5pt solid #e4e7ea; }}
tr.{rayada} {{ background-color: #f4f6f8; }}

blockquote {{ border-left: 3pt solid {acento}; background-color: #f7f9fb;
             padding: 6pt; margin: 0 0 {parrafo:.1f}pt 0; color: #46505a; }}

code {{ font-family: monospace; font-size: {codigo:.1f}pt; background-color: #eef1f4; }}
pre {{ font-family: monospace; font-size: {codigo:.1f}pt; background-color: #f7f9fb;
      border-left: 3pt solid #c9d2db; padding: 7pt; margin: 0 0 {parrafo:.1f}pt 0; }}
"""


@bp.post('/markdown-a-pdf')
def markdown_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un archivo Markdown.')

    tamano = params.opcion(datos, 'pagina', PAGINAS, 'a4')
    orientacion = params.opcion(datos, 'orientacion', ORIENTACIONES, 'vertical')
    familia = params.opcion(datos, 'familia', FAMILIAS, 'sans')
    acento = params.opcion(datos, 'acento', COLORES_ACENTO, 'azul')
    # Viene marcado: el caso corriente aquí es texto pegado o sacado de otro
    # documento, donde cada renglón es una línea y fundirlas arruina la página.
    saltos = params.booleano(datos, 'saltos', True)
    cuerpo = params.entero(datos, 'cuerpo', CUERPO_POR_DEFECTO, CUERPO_MINIMO, CUERPO_MAXIMO)
    margen = params.entero(datos, 'margen', MARGEN_POR_DEFECTO_MM,
                           MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM) * MILIMETRO

    # Se resuelve y valida todo antes de maquetar nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in EXTENSIONES_ADMITIDAS:
            raise ApiError(f'"{record.name}" no es un archivo Markdown (.md).', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))

    marco = _marco(tamano, orientacion)
    estilos = _estilos(familia, cuerpo, acento)

    resultados = []
    for record, ruta in entradas:
        documento = _maquetar(_leer(ruta, record.name), record.name, marco, margen,
                              estilos, saltos)
        destino, salida = storage.reserve_output(
            session_id, cambiar_extension(record.name, '.pdf'))
        with documento:
            documento.save(destino, deflate=True, garbage=3)
        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _marco(tamano: str, orientacion: str) -> fitz.Rect:
    """El tamaño de página elegido, tumbado si se ha pedido horizontal."""
    ancho, alto = PAGINAS[tamano]
    if orientacion == 'horizontal':
        ancho, alto = alto, ancho
    return fitz.Rect(0, 0, ancho, alto)


def _estilos(familia: str, cuerpo: int, acento: str) -> str:
    """La hoja de estilos con los tamaños y el color ya resueltos.

    Los encabezados y el código se calculan **a partir del cuerpo** en vez de
    fijarse en puntos: quien sube el cuerpo a 14 porque va a imprimir para
    alguien que no ve bien espera que los títulos suban con él.

    La cabecera de las tablas va al revés, más pequeña que el texto: es una
    etiqueta en versalitas, no una frase, y a tamaño completo compite con el
    contenido en vez de ordenarlo.
    """
    return ESTILOS.format(
        familia=FAMILIAS[familia],
        acento=COLORES_ACENTO[acento],
        rayada=CLASE_RAYADA,
        cuerpo=cuerpo,
        h1=cuerpo * 1.9,
        h2=cuerpo * 1.45,
        h3=cuerpo * 1.2,
        h4=cuerpo * 1.05,
        codigo=cuerpo * 0.88,
        cabecera=cuerpo * 0.8,
        parrafo=cuerpo * 0.6,
    )


def _a_html(texto: str, saltos: bool) -> str:
    """El Markdown convertido, con las filas pares de cada tabla ya marcadas.

    `saltos` decide qué se hace con un salto de línea suelto. En Markdown
    estándar no significa nada: las líneas seguidas se funden en un párrafo, que
    es lo que quiere quien escribe prosa partida a lo ancho. Pero el texto que
    sale de "Documento a Markdown" —o el que se pega desde cualquier sitio—
    trae **una línea por renglón y ninguna línea en blanco**, y ahí esa regla
    convierte el documento entero en un ladrillo: el título, el subtítulo y los
    apartados acaban en la misma frase. Con `saltos` cada línea se queda donde
    estaba.

    Se hace en dos tiempos —analizar, retocar, escribir— en vez de renderizar
    de un tirón porque la raya cebra no se puede pedir por CSS: MuPDF no
    entiende `tr:nth-child(even)`. Retocar los tokens es más honrado que buscar
    `<tr>` con una expresión regular sobre el HTML ya escrito, que se rompería
    con la primera tabla dentro de una cita.
    """
    lector = MarkdownIt('commonmark', {'html': True, 'breaks': saltos}).enable(ANADIDOS)
    tokens = lector.parse(texto)

    en_cuerpo, fila = False, 0
    for token in tokens:
        if token.type == 'tbody_open':
            en_cuerpo, fila = True, 0
        elif token.type == 'tbody_close':
            en_cuerpo = False
        elif token.type == 'tr_open' and en_cuerpo:
            # La cabecera va en `thead` y queda fuera: la raya empieza a contar
            # en la primera fila de datos.
            fila += 1
            if fila % 2 == 0:
                token.attrJoin('class', CLASE_RAYADA)

    return lector.renderer.render(tokens, lector.options, {})


def _leer(ruta: str, nombre: str) -> str:
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


def _maquetar(texto: str, nombre: str, marco: fitz.Rect, margen: float,
              estilos: str, saltos: bool = True) -> fitz.Document:
    """Convierte el Markdown en un PDF ya paginado.

    Va por `write_with_links` y no por el bucle a mano con `DocumentWriter`
    porque es lo único que conserva los enlaces: sin él, un `[texto](url)` sale
    subrayado y en azul pero no se puede pulsar, que es peor que no ponerlo.
    """
    html = _a_html(texto, saltos)
    area = marco + (margen, margen, -margen, -margen)

    def donde_va(numero: int, _relleno: float):
        """Qué página toca ahora. La llama MuPDF una vez por página."""
        if numero >= MAXIMO_PAGINAS:
            raise ApiError(
                f'"{nombre}" pasa de {MAXIMO_PAGINAS} páginas maquetado. Pártelo en varios '
                'archivos o sube el margen y baja el cuerpo de letra.', 413)
        return marco, area, None

    try:
        return fitz.Story(html=html, user_css=estilos).write_with_links(donde_va)
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido maquetar "{nombre}": {err}', 422) from err
