"""Efecto escáner: que aplane la luz, no que suba el contraste.

La lógica está en `api/escaneo.py`, sin archivos ni Flask, así que se puede
fabricar una «foto» con una sombra medida y comprobar con números que la sombra
desaparece. Es la única forma honrada de probar esto: mirar la imagen a ojo no
distingue entre corregir la iluminación y quemar la mitad clara.
"""
import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter

from tests.conftest import SESION, subida

ANCHO, ALTO = 600, 800


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def foto(desnivel=0.45, papel=(238, 232, 214), grosor=0):
    """Un folio con texto, papel amarillento y una sombra que cruza la hoja.

    `grosor` engorda el trazo. Hace falta para las pruebas con desenfoque: la
    letra por defecto de Pillow tiene un píxel de ancho y se deshace con un
    desenfoque de 0,6 **en el propio original**, así que ahí no se estaría
    midiendo el algoritmo. Una foto de un A4 a 12 puntos trae trazos de varios
    píxeles, que es lo que imita el grosor.
    """
    papel = Image.new('RGB', (ANCHO, ALTO), papel)
    pincel = ImageDraw.Draw(papel)
    for fila in range(18):
        pincel.text((50, 60 + fila * 38), 'Texto de ejemplo con acentos: ñ á é ' * 2,
                    fill=(40, 40, 45), stroke_width=grosor, stroke_fill=(40, 40, 45))
    datos = np.asarray(papel, dtype=np.float32)
    filas, columnas = np.mgrid[0:ALTO, 0:ANCHO]
    sombra = 1.0 - desnivel * np.clip((columnas / ANCHO) * 0.7 + (filas / ALTO) * 0.6 - 0.25, 0, 1)
    return Image.fromarray(np.clip(datos * sombra[:, :, None], 0, 255).astype(np.uint8))


def fondo_de(imagen, franja):
    """Cómo de claro es el papel en una franja: el percentil alto del gris."""
    gris = np.asarray(imagen.convert('L'), dtype=np.float32)
    return float(np.percentile(gris[:, franja], 90))


def desnivel_de(imagen):
    """Cuánto se diferencia el papel de un lado al del otro."""
    return abs(fondo_de(imagen, slice(0, ANCHO // 3)) - fondo_de(imagen, slice(2 * ANCHO // 3, None)))


def tinta_de(imagen, original):
    """Cómo de oscuro ha quedado lo que en el original **era** tinta.

    Se mide sobre la máscara del original y no sobre un percentil de la imagen
    entera: en un folio con dieciocho renglones la tinta es el 2 % de los
    píxeles, así que cualquier percentil global estaría midiendo el papel.
    """
    mascara = np.asarray(original.convert('L')) < 90
    gris = np.asarray(imagen.convert('L'), dtype=np.float32)
    return float(np.percentile(gris[mascara], 25))


# --- lo que hace, medido -------------------------------------------------

def test_la_foto_de_partida_tiene_el_problema_que_se_quiere_arreglar():
    """Sin esto, los tests de abajo podrían estar pasando sobre una foto plana."""
    original = foto()

    assert desnivel_de(original) > 25
    assert fondo_de(original, slice(0, ANCHO)) < 245
    # Y tiene tinta de verdad, aunque sea poca: es el 2 % de los píxeles.
    assert 0.01 < (np.asarray(original.convert('L')) < 90).mean() < 0.10


@pytest.mark.parametrize('modo', ['blanco-y-negro', 'gris', 'color'])
def test_la_sombra_desaparece_y_el_papel_se_vuelve_blanco(modo):
    from api.escaneo import limpiar

    original = foto()
    limpia = limpiar(original, modo, 50)

    assert desnivel_de(limpia) <= 2
    assert fondo_de(limpia, slice(0, ANCHO)) >= 250
    assert tinta_de(limpia, original) <= 90


def test_en_blanco_y_negro_solo_quedan_dos_valores():
    from api.escaneo import limpiar

    limpia = limpiar(foto(), 'blanco-y-negro', 50)

    assert limpia.mode == 'L'
    assert set(np.unique(np.asarray(limpia))) <= {0, 255}


def test_el_color_sigue_siendo_color():
    """Una firma azul tiene que seguir siendo azul; sólo se blanquea el papel."""
    from api.escaneo import limpiar

    original = foto()
    ImageDraw.Draw(original).rectangle([60, 700, 300, 760], fill=(30, 60, 190))

    limpia = limpiar(original, 'color', 50)

    assert limpia.mode == 'RGB'
    trozo = np.asarray(limpia, dtype=np.float32)[710:750, 80:280]
    assert trozo[:, :, 2].mean() > trozo[:, :, 0].mean() + 40


def test_mas_intensidad_deja_el_fondo_mas_limpio():
    from api.escaneo import limpiar

    floja = limpiar(foto(), 'gris', 0)
    fuerte = limpiar(foto(), 'gris', 100)

    assert fondo_de(fuerte, slice(0, ANCHO)) >= fondo_de(floja, slice(0, ANCHO))


def test_una_imagen_ya_limpia_no_se_estropea():
    """Lo que ya era blanco con tinta negra tiene que salir igual."""
    from api.escaneo import limpiar

    limpia = Image.new('RGB', (400, 400), (255, 255, 255))
    ImageDraw.Draw(limpia).text((40, 40), 'Ya estaba bien', fill=(0, 0, 0))

    resultado = limpiar(limpia, 'gris', 50)

    assert fondo_de(resultado, slice(0, 400)) >= 254
    assert tinta_de(resultado, limpia) <= 90


def test_un_modo_inventado_no_pasa():
    from api.escaneo import limpiar

    with pytest.raises(ValueError):
        limpiar(foto(), 'sepia', 50)


# --- banco de fotos de verdad --------------------------------------------
#
# El folio sintético de arriba no se parece a una foto: no tiene ruido, ni
# compresión, ni dominante de color, y la hoja llena el encuadre. Estas son las
# degradaciones que sí trae una foto hecha con el móvil, y la métrica va sobre la
# **máscara de tinta del folio sin degradar**, que se conoce exactamente. Medirla
# sobre la imagen degradada es lo que engaña: con una sombra profunda el papel
# oscuro baja de cualquier umbral y se cuenta como tinta.

SEMILLA = 7


def con_ruido(imagen, sigma=8):
    """Ruido de sensor, que es lo que sale con poca luz."""
    datos = np.asarray(imagen, dtype=np.float32)
    generador = np.random.default_rng(SEMILLA)
    return Image.fromarray(
        np.clip(datos + generador.normal(0, sigma, datos.shape), 0, 255).astype(np.uint8))


def con_jpeg(imagen, calidad=35):
    """Lo que hace el móvil al guardar: bloques y halos alrededor de las letras."""
    import io

    buzon = io.BytesIO()
    imagen.save(buzon, 'JPEG', quality=calidad)
    buzon.seek(0)
    return Image.open(buzon).convert('RGB')


def sobre_la_mesa(imagen, margen=0.18):
    """La hoja sin llenar el encuadre, con la mesa oscura alrededor."""
    ancho = int(imagen.width * (1 + 2 * margen))
    alto = int(imagen.height * (1 + 2 * margen))
    mesa = Image.new('RGB', (ancho, alto), (55, 45, 38))
    mesa.paste(imagen, (int(imagen.width * margen), int(imagen.height * margen)))
    return mesa


def con_foto_pegada(imagen):
    """Una foto oscura dentro del documento, que **no** es una sombra."""
    generador = np.random.default_rng(3)
    trozo = generador.integers(10, 70, (ALTO // 4, ANCHO // 2, 3)).astype(np.uint8)
    copia = imagen.copy()
    copia.paste(Image.fromarray(trozo), (ANCHO // 6, int(ALTO * 0.62)))
    return copia


def sombra_de_esquina(imagen, fuerza=0.75):
    """Lo peor que hace una mano: una sombra dura en una esquina."""
    datos = np.asarray(imagen, dtype=np.float32)
    filas, columnas = np.mgrid[0:imagen.height, 0:imagen.width]
    radio = np.sqrt(((columnas - imagen.width) / imagen.width) ** 2
                    + ((filas - imagen.height) / imagen.height) ** 2)
    caida = 1.0 - fuerza * np.clip(1.1 - radio, 0, 1)
    return Image.fromarray(np.clip(datos * caida[:, :, None], 0, 255).astype(np.uint8))


def realista(**extras):
    """El folio del banco: trazo de varios píxeles, como una foto de verdad."""
    return foto(grosor=1, **extras)


def mascara_de_tinta():
    """Dónde hay tinta en el folio **antes** de estropearlo."""
    return np.asarray(realista(desnivel=0).convert('L')) < 90


@pytest.mark.parametrize('nombre, estropear', [
    ('ruido', con_ruido),
    ('compresión JPEG', con_jpeg),
    ('ruido y JPEG', lambda im: con_jpeg(con_ruido(im))),
    ('desenfoque', lambda im: im.filter(ImageFilter.GaussianBlur(1.2))),
    ('sombra de esquina', sombra_de_esquina),
])
def test_aguanta_lo_que_trae_una_foto_de_movil(nombre, estropear):
    """Ninguna de estas puede dejar el papel gris ni comerse el texto."""
    from api.escaneo import limpiar

    tinta = mascara_de_tinta()
    limpia = limpiar(estropear(realista()), 'blanco-y-negro', 50)
    gris = np.asarray(limpia, dtype=np.float32)

    assert np.median(gris[tinta]) <= 60, f'{nombre}: se ha comido el texto'
    assert np.median(gris[~tinta]) >= 250, f'{nombre}: el papel no ha quedado blanco'


@pytest.mark.parametrize('nombre, estropear', [
    ('ruido', con_ruido),
    ('ruido y JPEG', lambda im: con_jpeg(con_ruido(im))),
])
def test_el_ruido_no_deja_el_papel_moteado(nombre, estropear):
    """En blanco y negro, el ruido puede cruzar el umbral y dejar puntos negros
    sobre el papel. Es el defecto que a ojo se ve enseguida y que ningún test
    miraba."""
    from api.escaneo import limpiar

    tinta = mascara_de_tinta()
    gris = np.asarray(limpiar(estropear(realista()), 'blanco-y-negro', 50), dtype=np.float32)
    manchas = float((gris[~tinta] < 128).mean()) * 100

    assert manchas < 1.0, f'{nombre}: {manchas:.2f} % del papel ha salido moteado'


def test_una_foto_pegada_no_se_trata_como_una_sombra():
    """La regresión que motivó el suelo relativo del fondo.

    El estimador no distingue «esta zona está en penumbra» de «aquí hay una foto
    oscura»: en las dos ve oscuro. Sin suelo, el 77 % de la foto se convertía en
    blanco, o sea se destruía.
    """
    from api.escaneo import limpiar

    original = con_foto_pegada(realista())
    zona = (slice(int(ALTO * 0.62), int(ALTO * 0.62) + ALTO // 4),
            slice(ANCHO // 6, ANCHO // 6 + ANCHO // 2))

    # Se mide en grises y en color, que es donde una foto tiene sentido: pasar
    # una foto por un umbral la convierte en trama, y eso no es un fallo sino lo
    # que hace un umbral. Lo que no puede pasar es que se vaya en blanco.
    for modo in ('gris', 'color'):
        gris = np.asarray(limpiar(original, modo, 50).convert('L'), dtype=np.float32)
        blancos = float((gris[zona] > 240).mean()) * 100
        assert blancos < 5.0, f'{modo}: la foto se ha ido en blanco ({blancos:.1f} %)'
        assert gris[zona].mean() < 160, f'{modo}: la foto ha salido lavada'


def test_la_luz_calida_no_deja_el_papel_amarillo():
    """Una bombilla de interior tira el papel a amarillo; en color tiene que
    salir blanco y el texto seguir siendo texto."""
    from api.escaneo import limpiar

    tinta = mascara_de_tinta()
    calido = realista(papel=(245, 228, 190))
    limpia = limpiar(calido, 'color', 50)
    datos = np.asarray(limpia, dtype=np.float32)

    papel = datos[~tinta]
    assert papel.mean() >= 245
    # Y blanco de verdad: sin dominante de color que quede.
    canales = [papel_canal.mean() for papel_canal in
               (datos[:, :, 0][~tinta], datos[:, :, 1][~tinta], datos[:, :, 2][~tinta])]
    assert max(canales) - min(canales) < 8, f'sigue habiendo dominante: {canales}'


def test_la_hoja_no_tiene_que_llenar_el_encuadre():
    """Con la mesa oscura alrededor, el folio sigue teniendo que salir bien."""
    from api.escaneo import limpiar

    tinta = mascara_de_tinta()
    margen = 0.18
    con_mesa = sobre_la_mesa(realista(), margen)
    x0, y0 = int(ANCHO * margen), int(ALTO * margen)

    gris = np.asarray(limpiar(con_mesa, 'blanco-y-negro', 50), dtype=np.float32)
    dentro = gris[y0:y0 + ALTO, x0:x0 + ANCHO]

    assert np.median(dentro[tinta]) <= 60
    assert np.median(dentro[~tinta]) >= 250


# --- la herramienta ------------------------------------------------------

def bytes_de(imagen, formato='JPEG'):
    import io

    buzon = io.BytesIO()
    imagen.save(buzon, formato, quality=92)
    return buzon.getvalue()


def subir(datos, nombre='folio.jpg'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def test_el_resultado_sale_en_png_cuando_es_blanco_y_negro(cliente):
    """El JPEG ensucia los bordes de las letras, que es lo que penaliza al OCR."""
    respuesta = cliente.post('/api/tools/efecto-escaner', headers={'X-Session-Id': SESION},
                             json={'file_ids': [subir(bytes_de(foto()))],
                                   'modo': 'blanco-y-negro', 'intensidad': 50})

    assert respuesta.status_code == 201
    assert respuesta.get_json()['files'][0]['name'] == 'folio-escaneado.png'


def test_en_color_sale_en_jpeg(cliente):
    respuesta = cliente.post('/api/tools/efecto-escaner', headers={'X-Session-Id': SESION},
                             json={'file_ids': [subir(bytes_de(foto()))], 'modo': 'color'})

    assert respuesta.get_json()['files'][0]['name'] == 'folio-escaneado.jpg'


def test_la_vista_previa_devuelve_una_imagen(cliente):
    respuesta = cliente.post('/api/tools/efecto-escaner/previsualizar',
                             headers={'X-Session-Id': SESION},
                             json={'file_ids': [subir(bytes_de(foto()))], 'modo': 'gris'})

    assert respuesta.status_code == 200
    assert respuesta.mimetype == 'image/jpeg'


def test_la_vista_previa_y_el_resultado_leen_las_mismas_opciones(cliente):
    """Si cada uno leyera lo suyo, dejarían de coincidir al tocar un rango."""
    from api.tools.efecto_escaner import _leer_ajustes

    assert _leer_ajustes({'modo': 'color', 'intensidad': 80}) == ('color', 80)
    assert _leer_ajustes({}) == ('blanco-y-negro', 50)
    # Los rangos se recortan, no se rechazan.
    assert _leer_ajustes({'intensidad': 500})[1] == 100


def test_un_pdf_manda_al_ocr(cliente):
    from storage import storage

    ident = storage.save_upload(SESION, subida(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'doc.pdf')).id
    respuesta = cliente.post('/api/tools/efecto-escaner', headers={'X-Session-Id': SESION},
                             json={'file_ids': [ident]})

    assert respuesta.status_code == 400
    assert 'OCR' in respuesta.get_json()['error']
