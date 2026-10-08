"""Texto en los bordes de una página, con sus coordenadas de giro."""
import fitz

from errors import ApiError


def escribir_en_borde(pagina, texto: str, ajustes: dict) -> None:
    caja = pagina.rect
    margen, tamano = ajustes['margen'], ajustes['tamano']
    ancho = fitz.get_text_length(texto, fontname=ajustes['fuente'], fontsize=tamano)

    if ajustes['alineacion'] == 'izquierda':
        x = caja.x0 + margen
    elif ajustes['alineacion'] == 'derecha':
        x = caja.x1 - margen - ancho
    else:
        x = caja.x0 + (caja.width - ancho) / 2

    # `insert_text` sitúa la línea base: arriba hay que bajarla el cuerpo entero
    # para que el texto quede dentro del margen, no pisándolo.
    y = caja.y0 + margen + tamano if ajustes['borde'] == 'arriba' else caja.y1 - margen

    if ancho > caja.width - 2 * margen:
        raise ApiError('El texto no cabe en la página. Reduce el tamaño o el margen.', 400)

    punto = fitz.Point(x, y) * pagina.derotation_matrix
    pagina.insert_text(punto, texto, fontname=ajustes['fuente'], fontsize=tamano,
                       color=ajustes['color'], rotate=pagina.rotation)
