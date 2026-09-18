"""Comparar dos documentos: qué páginas se corresponden y en qué se diferencian.

Está aparte de la herramienta a propósito, como `pdf_estructura.py`: aquí no hay
archivos, ni sesión, ni Flask, así que se puede probar con listas y con imágenes
hechas a mano.

Son tres preguntas independientes y se responden por separado:

1. **Qué página de un documento es cuál en el otro** (`alinear`). Si alguien mete
   una página en medio, las demás no cambian: lo que cambia es su número. Casar
   por posición diría que ha cambiado todo de ahí para abajo.
2. **Qué dice cada uno** (`diferencias_de_texto`), sobre el Markdown que saca
   `pdf_estructura`, que es lo que ya se usa para leer un PDF como texto.
3. **Qué se ve distinto** (`zonas_cambiadas`). Una firma nueva o un logotipo
   cambiado no tocan una sola letra, así que el texto no los ve.
"""
import difflib
from dataclasses import dataclass

from PIL import Image, ImageChops

IGUAL = 'igual'
CAMBIADA = 'cambiada'
ANADIDA = 'añadida'
QUITADA = 'quitada'

ANADIDO = 'añadido'
QUITADO = 'quitado'
CAMBIADO = 'cambiado'


@dataclass(frozen=True)
class Pareja:
    """Una página del documento A frente a la que le corresponde en el B.

    `a` y `b` son índices desde cero; uno de los dos es `None` cuando la página
    sólo está en un lado.
    """
    estado: str
    a: int | None
    b: int | None


@dataclass(frozen=True)
class Diferencia:
    tipo: str
    antes: str
    despues: str


def alinear(paginas_a: list[str], paginas_b: list[str]) -> list[Pareja]:
    """Empareja las páginas de los dos documentos por lo que dicen.

    Dos páginas con el mismo texto salen como iguales aunque se vean distintas:
    quien compare también los píxeles puede ascender una pareja a `cambiada`.
    """
    huellas_a = [_huella(texto) for texto in paginas_a]
    huellas_b = [_huella(texto) for texto in paginas_b]
    comparador = difflib.SequenceMatcher(None, huellas_a, huellas_b, autojunk=False)

    parejas: list[Pareja] = []
    for etiqueta, i1, i2, j1, j2 in comparador.get_opcodes():
        if etiqueta == 'equal':
            parejas += [Pareja(IGUAL, i, j) for i, j in zip(range(i1, i2), range(j1, j2))]
        elif etiqueta == 'replace':
            # Se emparejan de una en una las que caen en el mismo sitio, y lo que
            # sobra de un lado es una página que se ha quitado o que se ha puesto.
            comunes = min(i2 - i1, j2 - j1)
            parejas += [Pareja(CAMBIADA, i1 + k, j1 + k) for k in range(comunes)]
            parejas += [Pareja(QUITADA, i, None) for i in range(i1 + comunes, i2)]
            parejas += [Pareja(ANADIDA, None, j) for j in range(j1 + comunes, j2)]
        elif etiqueta == 'delete':
            parejas += [Pareja(QUITADA, i, None) for i in range(i1, i2)]
        else:  # insert
            parejas += [Pareja(ANADIDA, None, j) for j in range(j1, j2)]
    return parejas


def _huella(texto: str) -> str:
    """El texto de una página sin lo que no distingue: espacios y mayúsculas."""
    return ' '.join(texto.split()).lower()


def diferencias_de_texto(antes: str, despues: str) -> list[Diferencia]:
    """Qué párrafos se añaden, se quitan o cambian, en el orden en que salen.

    Se compara línea a línea sobre el Markdown: cada línea es un párrafo, un
    título o una fila de tabla, que es la unidad que una persona reconoce.
    """
    lineas_antes = _lineas(antes)
    lineas_despues = _lineas(despues)
    comparador = difflib.SequenceMatcher(None, lineas_antes, lineas_despues, autojunk=False)

    diferencias: list[Diferencia] = []
    for etiqueta, i1, i2, j1, j2 in comparador.get_opcodes():
        if etiqueta == 'equal':
            continue
        if etiqueta == 'replace':
            comunes = min(i2 - i1, j2 - j1)
            for k in range(comunes):
                diferencias.append(Diferencia(CAMBIADO, lineas_antes[i1 + k],
                                              lineas_despues[j1 + k]))
            diferencias += [Diferencia(QUITADO, lineas_antes[i], '')
                            for i in range(i1 + comunes, i2)]
            diferencias += [Diferencia(ANADIDO, '', lineas_despues[j])
                            for j in range(j1 + comunes, j2)]
        elif etiqueta == 'delete':
            diferencias += [Diferencia(QUITADO, lineas_antes[i], '') for i in range(i1, i2)]
        else:
            diferencias += [Diferencia(ANADIDO, '', lineas_despues[j]) for j in range(j1, j2)]
    return diferencias


def _lineas(texto: str) -> list[str]:
    return [linea.strip() for linea in texto.splitlines() if linea.strip()]


def zonas_cambiadas(imagen_a: Image.Image, imagen_b: Image.Image, umbral: int = 40,
                    hueco: int = 10, minimo: int = 3) -> list[tuple[int, int, int, int]]:
    """Los rectángulos donde las dos páginas no coinciden, en píxeles de la B.

    `umbral` es cuánto tiene que cambiar un píxel para contar: por debajo están
    el ruido del antialiasing y las diferencias de rasterizado, que si no
    marcarían la página entera. Las filas con algo se agrupan en bandas —`hueco`
    dice cuántas filas en blanco no rompen una— y de cada banda sale su recuadro.
    """
    if imagen_a.size != imagen_b.size:
        # Páginas de distinto tamaño: se comparan a la medida de la nueva, que es
        # la que se va a enseñar.
        imagen_a = imagen_a.resize(imagen_b.size)

    diferencia = ImageChops.difference(imagen_a.convert('L'), imagen_b.convert('L'))
    mascara = diferencia.point(lambda valor: 255 if valor >= umbral else 0)
    if mascara.getbbox() is None:
        return []

    ancho, alto = mascara.size
    # `getextrema()` de cada fila y no un `resize` a una columna: el promedio de
    # una fila de 900 píxeles con tres cambiados da cero y se perdería un
    # subrayado fino.
    con_algo = [mascara.crop((0, y, ancho, y + 1)).getextrema()[1] > 0 for y in range(alto)]

    zonas = []
    for y0, y1 in _bandas(con_algo, hueco, minimo):
        caja = mascara.crop((0, y0, ancho, y1)).getbbox()
        if caja:
            zonas.append((caja[0], y0 + caja[1], caja[2], y0 + caja[3]))
    return zonas


def _bandas(con_algo: list[bool], hueco: int, minimo: int) -> list[tuple[int, int]]:
    """Tramos de filas seguidas con algo, admitiendo `hueco` filas en blanco."""
    bandas: list[list[int]] = []
    for y, hay in enumerate(con_algo):
        if not hay:
            continue
        if bandas and y - bandas[-1][1] <= hueco:
            bandas[-1][1] = y + 1
        else:
            bandas.append([y, y + 1])
    return [(y0, y1) for y0, y1 in bandas if y1 - y0 >= minimo]
