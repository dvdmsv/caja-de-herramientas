"""Las anotaciones del visor que no son marcas ni texto: notas, dibujos, formas,
sellos, imágenes (la firma dibujada) y las que traía el PDF y se quitan.

Aparte de `tools/visor.py` para que el guardado se siga leyendo de un tirón:
aquí está cómo se valida cada lista y cómo se escribe cada cosa. Lo mismo que
allí: todo llega en proporciones de 0 a 1, arriba a la izquierda, sobre la
página **sin el giro que le haya dado el usuario**, y PyMuPDF guarda las
anotaciones en el espacio sin el giro del archivo, así que cada punto pasa por
`derotation_matrix`.

Van como **anotaciones** (`Text`, `Ink`, `Square`, `Circle`, `Line`,
`FreeText`) y no en el contenido de la página: son lo que cualquier lector
enseña como comentarios, se pueden ocultar al imprimir y se pueden quitar
después. La imagen es la excepción: una firma estampada tiene que ser parte de
la página, como la de «Firmar documento».
"""
import base64
import re

import fitz  # PyMuPDF

from api.tipografia import COLORES_TEXTO
from errors import ApiError

FIGURAS = {'rectangulo', 'elipse', 'linea', 'flecha'}
GIROS = {0, 90, 180, 270}

MAXIMO_NOTAS = 500
MAXIMO_CARACTERES_NOTA = 4000
MAXIMO_TRAZOS = 500
# Puntos de todos los dibujos juntos. Llegan ya simplificados (`trazo.ts`): una
# firma a mano son un par de cientos.
MAXIMO_PUNTOS = 100_000
MAXIMO_FORMAS = 500
MAXIMO_SELLOS = 200
MAXIMO_CARACTERES_SELLO = 80
MAXIMO_IMAGENES = 30
# Una firma reducida en el navegador ocupa decenas de kB; esto es un tope de
# seguridad, no de producto.
MAXIMO_BYTES_IMAGEN = 3 * 1024 * 1024
MAXIMO_BORRADAS = 2000

GROSOR_MINIMO = 0.5
GROSOR_MAXIMO = 24

# pdf.js llama a cada anotación por su referencia: «12R», o «12R3» si la
# generación no es cero.
ID_DE_PDFJS = re.compile(r'^(\d{1,9})R(\d{0,5})$')

FIRMAS_DE_IMAGEN = (b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff')


# --- lectura y validación -------------------------------------------------

def leer(datos: dict, total: int) -> dict:
    """Todas las listas, validadas. Las que no lleguen, vacías."""
    return {
        'borradas': _leer_borradas(datos.get('anotaciones_borradas'), total),
        'notas': _lista(datos.get('notas'), 'notas', MAXIMO_NOTAS, total, _leer_nota),
        'trazos': _leer_trazos(datos.get('trazos'), total),
        'formas': _lista(datos.get('formas'), 'formas', MAXIMO_FORMAS, total, _leer_forma),
        'sellos': _lista(datos.get('sellos'), 'sellos', MAXIMO_SELLOS, total, _leer_sello),
        'imagenes': _lista(datos.get('imagenes'), 'imágenes', MAXIMO_IMAGENES, total,
                           _leer_imagen),
    }


def hay_algo(leidas: dict) -> bool:
    return any(leidas.values())


def _lista(valor, nombre: str, maximo: int, total: int, leer_una) -> list:
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ApiError(f'La lista de {nombre} no es válida.', 400)
    if len(valor) > maximo:
        raise ApiError(f'Hay demasiadas {nombre}: el máximo son {maximo}.', 413)
    leidas = []
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError(f'La lista de {nombre} no es válida.', 400)
        leidas.append({'pagina': _pagina(entrada, total), 'color': _color(entrada),
                       **leer_una(entrada)})
    return leidas


def _pagina(entrada: dict, total: int) -> int:
    numero = entrada.get('pagina')
    if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= total:
        raise ApiError(f'Hay una anotación en la página {numero}, que no existe.', 400)
    return numero


def _color(entrada: dict):
    color = entrada.get('color', 'negro')
    if color not in COLORES_TEXTO:
        raise ApiError(f'Color de anotación no válido. Admitidos: {", ".join(COLORES_TEXTO)}.', 400)
    return COLORES_TEXTO[color]


def _proporcion(valor) -> float:
    if not isinstance(valor, (int, float)) or isinstance(valor, bool) or not 0 <= valor <= 1:
        raise ApiError('Hay una anotación con coordenadas fuera de la página.', 400)
    return float(valor)


def _par(valor) -> tuple:
    if not isinstance(valor, list) or len(valor) != 2:
        raise ApiError('Hay una anotación con coordenadas fuera de la página.', 400)
    return _proporcion(valor[0]), _proporcion(valor[1])


def _rect(valor) -> tuple:
    if not isinstance(valor, list) or len(valor) != 4:
        raise ApiError('Hay una anotación con coordenadas fuera de la página.', 400)
    x0, y0, x1, y1 = (_proporcion(v) for v in valor)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        raise ApiError('Hay una anotación sin tamaño.', 400)
    return x0, y0, x1, y1


def _grosor(entrada: dict) -> float:
    grosor = entrada.get('grosor', 2)
    if not isinstance(grosor, (int, float)) or isinstance(grosor, bool):
        raise ApiError('El grosor de una anotación no es válido.', 400)
    return min(GROSOR_MAXIMO, max(GROSOR_MINIMO, float(grosor)))


def _texto(entrada: dict, maximo: int, nombre: str) -> str:
    texto = entrada.get('texto', '')
    if not isinstance(texto, str):
        raise ApiError(f'El texto de {nombre} no es válido.', 400)
    if len(texto) > maximo:
        raise ApiError(f'El texto de {nombre} es demasiado largo: el máximo son {maximo} '
                       'caracteres.', 413)
    return texto


def _leer_nota(entrada: dict) -> dict:
    return {'x': _proporcion(entrada.get('x')), 'y': _proporcion(entrada.get('y')),
            'texto': _texto(entrada, MAXIMO_CARACTERES_NOTA, 'una nota')}


def _leer_forma(entrada: dict) -> dict:
    figura = entrada.get('figura')
    if figura not in FIGURAS:
        raise ApiError(f'Figura no válida. Admitidas: {", ".join(sorted(FIGURAS))}.', 400)
    return {'figura': figura, 'desde': _par(entrada.get('desde')),
            'hasta': _par(entrada.get('hasta')), 'grosor': _grosor(entrada)}


def _leer_sello(entrada: dict) -> dict:
    texto = _texto(entrada, MAXIMO_CARACTERES_SELLO, 'un sello').strip()
    if not texto:
        raise ApiError('Hay un sello sin texto.', 400)
    return {'rect': _rect(entrada.get('rect')), 'texto': texto, 'rotacion': _giro(entrada)}


def _leer_imagen(entrada: dict) -> dict:
    datos = entrada.get('datos')
    coincide = re.match(r'^data:image/(png|jpeg);base64,', datos) if isinstance(datos, str) else None
    if not coincide:
        raise ApiError('Una de las imágenes no es un PNG ni un JPEG.', 400)
    if len(datos) > MAXIMO_BYTES_IMAGEN * 4 // 3 + 64:
        raise ApiError('Una de las imágenes es demasiado grande.', 413)
    try:
        contenido = base64.b64decode(datos[coincide.end():], validate=True)
    except ValueError as err:
        raise ApiError('Una de las imágenes no se puede leer.', 400) from err
    # Lo que dice ser y lo que es: lo mismo que `contenido.py` con las subidas.
    if not contenido.startswith(FIRMAS_DE_IMAGEN):
        raise ApiError('Una de las imágenes no es un PNG ni un JPEG.', 400)
    return {'rect': _rect(entrada.get('rect')), 'contenido': contenido, 'rotacion': _giro(entrada)}


def _giro(entrada: dict) -> int:
    """El giro del visor con el que se puso un sello o una imagen, como en los textos."""
    giro = entrada.get('rotacion', 0)
    if giro not in GIROS or isinstance(giro, bool):
        raise ApiError('El giro de una anotación no es válido.', 400)
    return giro


def _leer_trazos(valor, total: int) -> list:
    trazos = _lista(valor, 'dibujos', MAXIMO_TRAZOS, total, _leer_dibujo)
    if sum(len(linea) for trazo in trazos for linea in trazo['lineas']) > MAXIMO_PUNTOS:
        raise ApiError('Los dibujos tienen demasiados puntos.', 413)
    return trazos


def _leer_dibujo(entrada: dict) -> dict:
    lineas = entrada.get('trazos')
    if not isinstance(lineas, list) or not lineas:
        raise ApiError('Hay un dibujo vacío.', 400)
    leidas = []
    for linea in lineas:
        if not isinstance(linea, list) or not linea or len(linea) > MAXIMO_PUNTOS:
            raise ApiError('Hay un dibujo vacío.', 400)
        leidas.append([_par(punto) for punto in linea])
    return {'lineas': leidas, 'grosor': _grosor(entrada)}


def _leer_borradas(valor, total: int) -> list:
    if valor is None:
        return []
    if not isinstance(valor, list) or len(valor) > MAXIMO_BORRADAS:
        raise ApiError('La lista de anotaciones que quitar no es válida.', 400)
    borradas = []
    for entrada in valor:
        coincide = ID_DE_PDFJS.match(str(entrada.get('id', ''))) if isinstance(entrada, dict) else None
        if not coincide:
            raise ApiError('La lista de anotaciones que quitar no es válida.', 400)
        borradas.append((_pagina(entrada, total), int(coincide.group(1))))
    return borradas


# --- escritura ---------------------------------------------------------------

def _punto(pagina, x: float, y: float) -> fitz.Point:
    """De proporciones de lo que se ve al espacio sin girar de PyMuPDF."""
    caja = pagina.rect
    punto = fitz.Point(caja.x0 + x * caja.width, caja.y0 + y * caja.height)
    return punto * pagina.derotation_matrix if pagina.rotation else punto


def _rect_en(pagina, x0: float, y0: float, x1: float, y1: float) -> fitz.Rect:
    rect = fitz.Rect(_punto(pagina, x0, y0), _punto(pagina, x1, y1))
    rect.normalize()
    return rect


def quitar_existentes(documento, borradas: list) -> None:
    """Las anotaciones que ya traía el PDF y el usuario ha quitado en el visor.

    Por su número de objeto, que es lo que pdf.js usa de id. Los campos de
    formulario no se quitan por aquí aunque coincida el número: son parte del
    impreso, no un comentario.
    """
    por_pagina: dict = {}
    for numero, xref in borradas:
        por_pagina.setdefault(numero, set()).add(xref)
    for numero, xrefs in por_pagina.items():
        pagina = documento[numero - 1]
        for anotacion in list(pagina.annots()):
            if anotacion.xref in xrefs:
                pagina.delete_annot(anotacion)


def escribir(documento, leidas: dict) -> None:
    """Formas y dibujos, notas, sellos e imágenes, en ese orden.

    Las imágenes, las últimas: van al contenido de la página, y así no quedan
    debajo de nada que se haya pintado en el mismo sitio.
    """
    for forma in leidas['formas']:
        _forma(documento[forma['pagina'] - 1], forma)
    for trazo in leidas['trazos']:
        pagina = documento[trazo['pagina'] - 1]
        anotacion = pagina.add_ink_annot(
            [[tuple(_punto(pagina, x, y)) for x, y in linea] for linea in trazo['lineas']])
        _terminar(anotacion, trazo['color'], trazo['grosor'])
    for nota in leidas['notas']:
        pagina = documento[nota['pagina'] - 1]
        if not nota['texto'].strip():
            continue
        anotacion = pagina.add_text_annot(_punto(pagina, nota['x'], nota['y']), nota['texto'],
                                          icon='Comment')
        anotacion.set_colors(stroke=nota['color'])
        anotacion.update()
    for sello in leidas['sellos']:
        _sello(documento[sello['pagina'] - 1], sello)
    for imagen in leidas['imagenes']:
        pagina = documento[imagen['pagina'] - 1]
        # `rotate` endereza la imagen: el rectángulo ya va en el espacio sin
        # girar, pero la imagen tiene que verse derecha en la página tal y como
        # se estaba leyendo, con su giro del archivo y el que le dio el usuario
        # (que `set_rotation` aplica después). Como `insert_text` en los textos.
        pagina.insert_image(_rect_en(pagina, *imagen['rect']), stream=imagen['contenido'],
                            keep_proportion=False,
                            rotate=(pagina.rotation + imagen['rotacion']) % 360)


def _forma(pagina, forma: dict) -> None:
    (x0, y0), (x1, y1) = forma['desde'], forma['hasta']
    figura = forma['figura']
    if figura in ('linea', 'flecha'):
        anotacion = pagina.add_line_annot(_punto(pagina, x0, y0), _punto(pagina, x1, y1))
        if figura == 'flecha':
            # La punta en el final, que es donde se soltó el ratón.
            anotacion.set_line_ends(fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_OPEN_ARROW)
    else:
        rect = _rect_en(pagina, min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        if rect.is_empty:
            return
        anotacion = (pagina.add_rect_annot(rect) if figura == 'rectangulo'
                     else pagina.add_circle_annot(rect))
    _terminar(anotacion, forma['color'], forma['grosor'])


def _terminar(anotacion, color, grosor: float) -> None:
    anotacion.set_border(width=grosor)
    anotacion.set_colors(stroke=color)
    anotacion.update()


def _sello(pagina, sello: dict) -> None:
    """Un sello: el texto centrado dentro de su marco, en una `FreeText`.

    El cuerpo sale del alto del recuadro tal como se ve —con la página girada,
    el alto de lo que se ve es el ancho del rectángulo sin girar—, el mismo
    cálculo que hace el visor para enseñarlo. Y gira con el archivo y con el
    visor, como la imagen.
    """
    rect = _rect_en(pagina, *sello['rect'])
    if rect.is_empty:
        return
    giro = (pagina.rotation + sello['rotacion']) % 360
    alto_visible = rect.width if giro in (90, 270) else rect.height
    anotacion = pagina.add_freetext_annot(
        rect, sello['texto'], fontsize=max(4, round(alto_visible * 0.5, 1)), fontname='Helv',
        text_color=sello['color'], border_color=sello['color'], align=fitz.TEXT_ALIGN_CENTER,
        rotate=giro)
    anotacion.set_border(width=2)
    anotacion.update()
