"""La lógica de comparar, sin archivos ni servidor.

Lo que se prueba aquí es lo que hace útil la herramienta: que meter una página
en medio no desplace todo lo demás, y que un cambio que no toca ninguna letra
—una firma, un logotipo— salga igualmente.
"""
import pytest
from PIL import Image, ImageDraw


@pytest.fixture
def comparacion(entorno):
    entorno()
    from api import comparacion as modulo
    return modulo


# --- alinear ---------------------------------------------------------------

def test_dos_documentos_iguales_se_emparejan_uno_a_uno(comparacion):
    parejas = comparacion.alinear(['uno', 'dos', 'tres'], ['uno', 'dos', 'tres'])

    assert [p.estado for p in parejas] == [comparacion.IGUAL] * 3
    assert [(p.a, p.b) for p in parejas] == [(0, 0), (1, 1), (2, 2)]


def test_una_pagina_metida_en_medio_no_desplaza_a_las_demas(comparacion):
    """Casar por posición diría que ha cambiado todo de ahí para abajo."""
    parejas = comparacion.alinear(['uno', 'dos', 'tres'], ['uno', 'nueva', 'dos', 'tres'])

    assert [p.estado for p in parejas] == [
        comparacion.IGUAL, comparacion.ANADIDA, comparacion.IGUAL, comparacion.IGUAL]
    # La tercera del original sigue siendo la tercera, aunque ahora sea la cuarta.
    assert [(p.a, p.b) for p in parejas] == [(0, 0), (None, 1), (1, 2), (2, 3)]


def test_una_pagina_quitada_sale_como_quitada(comparacion):
    parejas = comparacion.alinear(['uno', 'dos', 'tres'], ['uno', 'tres'])

    assert [p.estado for p in parejas] == [
        comparacion.IGUAL, comparacion.QUITADA, comparacion.IGUAL]


def test_una_pagina_retocada_sale_como_cambiada(comparacion):
    parejas = comparacion.alinear(['uno', 'dos'], ['uno', 'dos y medio'])

    assert parejas[1].estado == comparacion.CAMBIADA
    assert (parejas[1].a, parejas[1].b) == (1, 1)


def test_los_espacios_y_las_mayusculas_no_cuentan(comparacion):
    parejas = comparacion.alinear(['Hola   mundo'], ['hola mundo'])

    assert parejas[0].estado == comparacion.IGUAL


# --- diferencias de texto --------------------------------------------------

def test_un_parrafo_cambiado_sale_con_el_antes_y_el_despues(comparacion):
    diferencias = comparacion.diferencias_de_texto('Uno\nDos\nTres', 'Uno\nDos y medio\nTres')

    assert len(diferencias) == 1
    assert diferencias[0].tipo == comparacion.CAMBIADO
    assert (diferencias[0].antes, diferencias[0].despues) == ('Dos', 'Dos y medio')


def test_lo_que_se_anade_y_lo_que_se_quita(comparacion):
    diferencias = comparacion.diferencias_de_texto('Uno\nDos', 'Uno\nDos\nTres')
    assert [(d.tipo, d.despues) for d in diferencias] == [(comparacion.ANADIDO, 'Tres')]

    diferencias = comparacion.diferencias_de_texto('Uno\nDos\nTres', 'Uno\nDos')
    assert [(d.tipo, d.antes) for d in diferencias] == [(comparacion.QUITADO, 'Tres')]


def test_dos_textos_iguales_no_tienen_diferencias(comparacion):
    assert comparacion.diferencias_de_texto('Uno\n\nDos\n', '  Uno\nDos') == []


# --- zonas cambiadas -------------------------------------------------------

def pagina(marcas=()):
    imagen = Image.new('RGB', (300, 400), 'white')
    lapiz = ImageDraw.Draw(imagen)
    lapiz.rectangle((20, 20, 280, 40), fill='black')     # una "cabecera" común
    for caja in marcas:
        lapiz.rectangle(caja, fill='black')
    return imagen


def test_dos_paginas_identicas_no_tienen_zonas(comparacion):
    assert comparacion.zonas_cambiadas(pagina(), pagina()) == []


def test_una_mancha_nueva_sale_como_zona(comparacion):
    zonas = comparacion.zonas_cambiadas(pagina(), pagina([(100, 200, 160, 240)]))

    assert len(zonas) == 1
    x0, y0, x1, y1 = zonas[0]
    assert (x0, y0) == (100, 200)
    assert (x1, y1) == (161, 241)  # `getbbox` da el límite exclusivo


def test_dos_cambios_separados_salen_por_separado(comparacion):
    zonas = comparacion.zonas_cambiadas(pagina(), pagina([(50, 100, 90, 130),
                                                          (50, 300, 90, 330)]))

    assert len(zonas) == 2
    assert zonas[0][1] < zonas[1][1]


def test_una_linea_fina_no_se_pierde(comparacion):
    """Promediar la fila daría cero y el subrayado no aparecería."""
    zonas = comparacion.zonas_cambiadas(pagina(), pagina([(40, 250, 260, 252)]))

    assert len(zonas) == 1


def test_paginas_de_distinto_tamano_se_miden_en_la_nueva(comparacion):
    """Los recuadros se pintan sobre la página nueva, así que van en sus píxeles."""
    pequena = pagina().resize((150, 200))
    nueva = pagina([(100, 200, 160, 240)])

    zonas = comparacion.zonas_cambiadas(pequena, nueva)

    assert zonas, 'la mancha nueva tiene que salir'
    assert all(0 <= x0 <= x1 <= nueva.width and 0 <= y0 <= y1 <= nueva.height
               for x0, y0, x1, y1 in zonas)
