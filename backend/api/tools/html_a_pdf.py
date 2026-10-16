"""Herramienta: pasar una página HTML a PDF.

Para lo que ya viene hecho en HTML —una factura que manda un programa de
gestión, un informe exportado, una página guardada con «Guardar como»— y hay que
archivar, imprimir o presentar como documento. Lo que sale tiene que ser **la
página que se ve**: su CSS (el de `<style>` y el de `style="…"`), sus imágenes
incrustadas y su texto como texto, seleccionable y con los enlaces pulsables.

**Quién lo maqueta: WeasyPrint**, el mismo motor que "Markdown a PDF" y por las
mismas razones (ver la cabecera de `markdown_a_pdf.py`): CSS de impresión de
verdad sin cargar con un navegador. También entiende los atributos de
presentación del HTML antiguo (`<font color>`, `<td bgcolor>`, `<table
border>`), que es como siguen escribiendo el HTML muchos programas de gestión.

**Lo que se elige en la pantalla manda.** El tamaño, la orientación y el margen
van con `!important` sobre el `@page` que traiga el documento: quien elige Carta
quiere Carta, aunque la página se diseñara para A5. El resto del CSS del
documento no se toca.

**Nada se sale a buscar, y nada del servidor entra en el PDF.** Un HTML subido
es contenido de un desconocido, y WeasyPrint, por defecto, va a buscar lo que el
HTML le pida: por HTTP, y también con `file://` del disco del servidor. Se
cierra en tres capas, porque cada una tapa lo que a la otra se le escaparía:

- El `URLFetcher` sólo admite `data:`. Ésa es la valla de verdad, y vale para
  todo lo que se descarga: imágenes, hojas de estilo, `@import`, `@font-face`,
  fondos, `<object>`, `<embed>` y lo que pida un SVG desde dentro de otro SVG.
  Lo bloqueado deja su hueco y la conversión sigue.
- No hay `base_url`, y se quitan las etiquetas `<base>`: sin ellas, una ruta
  relativa no se resuelve contra nada, ni siquiera contra la carpeta de trabajo.
- Se quitan los adjuntos (`rel="attachment"`). WeasyPrint incrusta en el PDF el
  archivo que enlazan: con una ruta del servidor sería sacar ese archivo dentro
  del documento, y con `data:`, meter en el PDF un archivo que no se ve. El
  enlace se queda como texto.

**Ni JavaScript.** WeasyPrint no lo ejecuta, así que un `<script>` ni corre ni
se pinta. Los enlaces con un esquema que no sea `http`, `https`, `mailto` o
`tel` —`javascript:`, `file:`, `data:`— pierden el destino y quedan como texto:
un PDF con un enlace `javascript:` es una sorpresa para quien lo abra. Las
anclas internas (`#apartado`) siguen funcionando.

**Codificación.** Si el archivo es UTF-8 válido se lee como UTF-8, lo diga o no:
es lo que escribe cualquier cosa de este siglo, y el estándar de HTML, sin
declaración, mandaría leerlo como Windows-1252 y estropearía cada tilde. Si no
lo es, el analizador de HTML hace lo que haría un navegador: mira el
`<meta charset>` y, sin él, prueba Windows-1252.

**Lo que no hace.** No descarga nada de una URL ni resuelve imágenes o estilos
enlazados, por lo mismo de arriba: se pinta lo que el archivo trae dentro.
"""
import io
import re

from flask import Blueprint, jsonify
from weasyprint import CSS, HTML
from weasyprint.urls import URLFetcher

from api import current_session, limites, params, progreso
from api.tools.markdown_a_pdf import MAXIMO_PAGINAS, ORIENTACIONES, PAGINAS, PLAZO_EN_PROCESO
from errors import ApiError
from storage import storage, cambiar_extension

bp = Blueprint('html_a_pdf', __name__, url_prefix='/api/tools')

EXTENSIONES_ADMITIDAS = {'.html', '.htm'}

# Sin mínimo: hay páginas que ya traen su propio margen en el CSS y sólo
# quieren el papel. 15 mm es lo que deja de serie la impresión de un navegador.
MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM, MARGEN_POR_DEFECTO_MM = 0, 40, 15

PAGINA = '@page {{ size: {ancho}mm {alto}mm !important; margin: {margen}mm !important; }}'

# Los enlaces que conservan su destino. Los demás se quedan en texto.
ESQUEMAS_DE_ENLACE = {'http', 'https', 'mailto', 'tel'}

# Los navegadores ignoran los espacios y los caracteres de control dentro de una
# URL, así que `java\tscript:` es `javascript:`. Se quitan antes de mirar.
INVISIBLES = re.compile(r'[\x00-\x20\x7f]+')
ESQUEMA = re.compile(r'^([a-zA-Z][a-zA-Z0-9+.\-]*):')


@bp.post('/html-a-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La conversión')
def html_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un archivo HTML.')

    opciones = {
        'pagina': params.opcion(datos, 'pagina', PAGINAS, 'a4'),
        'orientacion': params.opcion(datos, 'orientacion', ORIENTACIONES, 'vertical'),
        'margen': params.entero(datos, 'margen', MARGEN_POR_DEFECTO_MM,
                                MARGEN_MINIMO_MM, MARGEN_MAXIMO_MM),
    }

    # Se resuelve y valida todo antes de convertir nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in EXTENSIONES_ADMITIDAS:
            raise ApiError(f'"{record.name}" no es una página HTML (.html o .htm).', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))

    resultados = []
    for record, ruta in progreso.contando(entradas, len(entradas), 'Convirtiendo páginas'):
        pdf = generar(leer(ruta, record.name), record.name, **opciones)
        destino, salida = storage.reserve_output(session_id, cambiar_extension(record.name, '.pdf'))
        with open(destino, 'wb') as fichero:
            fichero.write(pdf)
        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def leer(ruta: str, nombre: str) -> str | bytes:
    """El texto del archivo si es UTF-8; si no, los bytes, para que el analizador
    de HTML decida por su `<meta charset>`. Ver la cabecera."""
    with open(ruta, 'rb') as fh:
        crudo = fh.read()
    if not crudo.strip():
        raise ApiError(f'"{nombre}" está vacío: no hay nada que convertir.', 422)
    try:
        return crudo.decode('utf-8-sig')
    except UnicodeDecodeError:
        return crudo


def generar(html: str | bytes, nombre: str, pagina: str = 'a4', orientacion: str = 'vertical',
            margen: int = MARGEN_POR_DEFECTO_MM) -> bytes:
    """La página convertida a PDF, en bytes."""
    ancho, alto = PAGINAS[pagina]
    if orientacion == 'horizontal':
        ancho, alto = alto, ancho
    hoja = CSS(string=PAGINA.format(ancho=ancho, alto=alto, margen=margen))
    fuente = {'string': html} if isinstance(html, str) else {'file_obj': io.BytesIO(html)}
    try:
        documento = HTML(**fuente, base_url=None,
                         url_fetcher=URLFetcher(allowed_protocols={'data'}))
        _sanear(documento)
        maquetado = documento.render(stylesheets=[hoja], presentational_hints=True)
    except Exception as err:
        if limites.es_falta_de_memoria(err):
            raise
        raise ApiError(f'No se ha podido convertir "{nombre}": {err}', 422) from err
    if len(maquetado.pages) > MAXIMO_PAGINAS:
        raise ApiError(
            f'"{nombre}" pasa de {MAXIMO_PAGINAS} páginas convertido. Pártelo en varios '
            'archivos.', 413)
    return maquetado.write_pdf()


def _sanear(documento: HTML) -> None:
    """Quita del árbol ya analizado lo que abriría el disco o colaría archivos.

    Se hace sobre el árbol de WeasyPrint, antes de maquetar, y no con
    expresiones regulares sobre el texto: así se ve el documento como lo ve el
    motor, con las etiquetas mal cerradas ya resueltas. Y no se vuelve a
    escribir como HTML, que estropearía los SVG en línea.
    """
    # `<base>` ya se ha leído al analizar: hay que anularlo además de quitarlo.
    documento.base_url = None
    raiz = documento.etree_element
    padres = {hijo: padre for padre in raiz.iter() for hijo in padre}
    for elemento in list(raiz.iter()):
        if not isinstance(elemento.tag, str):
            continue  # comentarios e instrucciones de proceso
        etiqueta = elemento.tag.lower()
        if etiqueta == 'base':
            padres[elemento].remove(elemento)
            continue
        if 'attachment' in elemento.get('rel', '').lower().split():
            if etiqueta == 'link':
                padres[elemento].remove(elemento)
                continue
            del elemento.attrib['rel']
        if etiqueta == 'a' and 'href' in elemento.attrib and not _enlace_permitido(elemento.get('href')):
            del elemento.attrib['href']


def _enlace_permitido(href: str) -> bool:
    """Si el destino de un enlace puede ir al PDF: una web, un correo, un
    teléfono o un ancla del propio documento."""
    esquema = ESQUEMA.match(INVISIBLES.sub('', href))
    return esquema is None or esquema.group(1).lower() in ESQUEMAS_DE_ENLACE
