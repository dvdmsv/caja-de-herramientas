"""Herramienta: estampar una firma sobre un PDF o una imagen.

La firma es una imagen cualquiera (una foto del trazo sobre papel, un PNG
recortado o lo que dibuje el usuario en el navegador) y se coloca donde se
quiera, con su tamaño y su giro.

En los PDF la firma se inserta como imagen sobre la página: el documento
conserva su texto, sus fuentes y sus marcadores, porque no se rasteriza nada.
"""
import io
import os

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify, send_file

from api import current_session, imaging, params
from api.formatos import salidas_disponibles
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('firmar', __name__, url_prefix='/api/tools')

# Anchura de la firma en fracción del ancho de la página.
ANCHO_MINIMO, ANCHO_MAXIMO, ANCHO_POR_DEFECTO = 0.05, 1.0, 0.25

# Umbral a partir del cual un píxel se considera fondo. Por debajo de 200 se
# empezaría a comer el trazo de un bolígrafo azul flojo.
UMBRAL_MINIMO, UMBRAL_MAXIMO, UMBRAL_POR_DEFECTO = 200, 255, 240

ROTACION_MAXIMA = 180.0

# Resolución a la que se rasteriza la firma dentro del PDF, para que el trazo no
# se vea pixelado al ampliar el documento.
PPP_FIRMA = 300

CALIDAD_IMAGEN = 95


@bp.post('/firmar/preparar')
def preparar():
    """Devuelve la firma ya procesada, para que el navegador enseñe lo mismo
    que se va a estampar.

    Que este trabajo lo haga el servidor y no el navegador evita tener el
    recorte del fondo implementado dos veces, en Python y en TypeScript, con el
    riesgo de que dejen de coincidir.
    """
    session_id = current_session()
    firma = firma_preparada(session_id, params.cuerpo())

    buffer = io.BytesIO()
    firma.save(buffer, 'PNG', optimize=True)
    buffer.seek(0)
    return send_file(buffer, mimetype='image/png')


@bp.post('/firmar')
def firmar():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona el documento que quieres firmar.')

    # La posición es el centro de la firma, no su esquina: así el giro cae donde
    # el navegador lo pinta, que rota sobre el centro.
    x = params.decimal(datos, 'x', 0.5, 0.0, 1.0)
    y = params.decimal(datos, 'y', 0.8, 0.0, 1.0)
    ancho = params.decimal(datos, 'ancho', ANCHO_POR_DEFECTO, ANCHO_MINIMO, ANCHO_MAXIMO)
    rotacion = params.decimal(datos, 'rotacion', 0.0, -ROTACION_MAXIMA, ROTACION_MAXIMA)
    todas = params.booleano(datos, 'todas', False)

    record = storage.record_of(session_id, file_ids[0])
    origen = storage.path_of(session_id, file_ids[0])
    firma = firma_preparada(session_id, datos)

    base = os.path.splitext(nombre_seguro(record.name))[0]

    if record.ext == '.pdf':
        destino, salida = storage.reserve_output(session_id, f'{base}-firmado.pdf')
        pagina = params.entero(datos, 'pagina', 1, 1, 100_000)
        _firmar_pdf(origen, destino, firma, x, y, ancho, rotacion, pagina, todas)
    else:
        formato, extension = _formato_de_salida(record.ext)
        destino, salida = storage.reserve_output(session_id, f'{base}-firmado{extension}')
        _firmar_imagen(origen, destino, record.name, firma, x, y, ancho, rotacion, formato)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def firma_preparada(session_id: str, datos: dict, clave: str = 'firma_id',
                    obligatoria: bool = True) -> Image.Image | None:
    """Abre la firma, le quita el fondo si se pide y la recorta.

    Es pública porque "Firmar con certificado" reutiliza el mismo trazo dentro
    de su sello, con otro nombre de parámetro (`trazo_id`) y sin ser obligatorio.
    """
    firma_id = datos.get(clave)
    if not isinstance(firma_id, str) or not firma_id:
        if not obligatoria:
            return None
        raise ApiError('Falta la firma: súbela o dibújala antes de continuar.', 400)

    record = storage.record_of(session_id, firma_id)
    if record.ext == '.pdf':
        raise ApiError('La firma tiene que ser una imagen, no un PDF.', 400)

    quitar_fondo = params.booleano(datos, 'quitar_fondo', True)
    umbral = params.entero(datos, 'umbral', UMBRAL_POR_DEFECTO, UMBRAL_MINIMO, UMBRAL_MAXIMO)

    with imaging.abrir(storage.path_of(session_id, firma_id), record.name) as imagen:
        preparada = imaging.quitar_fondo_claro(imagen, umbral) if quitar_fondo else imagen
        recortada = imaging.recortar_transparente(preparada)

    if recortada.width < 2 or recortada.height < 2:
        raise ApiError(
            'Al quitar el fondo no ha quedado nada de la firma. Prueba a bajar el umbral.', 422)
    return recortada


def _firmar_pdf(origen: str, destino: str, firma: Image.Image, x: float, y: float,
                ancho: float, rotacion: float, numero: int, todas: bool) -> None:
    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña.', 422)
        if documento.page_count == 0:
            raise ApiError('El PDF no tiene páginas.', 422)
        if not todas and numero > documento.page_count:
            raise ApiError(
                f'El PDF tiene {documento.page_count} páginas y has pedido la {numero}.', 400)

        paginas = list(documento) if todas else [documento[numero - 1]]

        # La firma se rasteriza una sola vez, con el tamaño que le toca en la
        # primera página, y las demás reutilizan el mismo recurso del PDF.
        referencia = paginas[0].rect.width * ancho
        estampa, ancho_relativo, alto_relativo = _estampa(firma, referencia, rotacion)
        xref = 0

        for pagina in paginas:
            caja = pagina.rect
            # Al girar, la caja que ocupa la firma crece; el trazo mantiene su
            # tamaño. Es lo mismo que hace el `rotate()` del navegador, y sin
            # esto la firma girada saldría más pequeña de lo que se veía.
            medio_ancho = ancho * caja.width * ancho_relativo / 2
            medio_alto = ancho * caja.width * alto_relativo / 2
            centro_x, centro_y = caja.x0 + x * caja.width, caja.y0 + y * caja.height
            rect = fitz.Rect(centro_x - medio_ancho, centro_y - medio_alto,
                             centro_x + medio_ancho, centro_y + medio_alto)
            # insert_image usa coordenadas de la página sin girar. El giro
            # antihorario de la imagen compensa el giro horario del visor.
            rect = rect * pagina.derotation_matrix
            xref = pagina.insert_image(rect, xref=xref, stream=None if xref else estampa,
                                       rotate=pagina.rotation, overlay=True)

        documento.save(destino, deflate=True, garbage=3)


def _firmar_imagen(origen: str, destino: str, nombre: str, firma: Image.Image, x: float,
                   y: float, ancho: float, rotacion: float, formato: str) -> None:
    with imaging.abrir(origen, nombre) as documento:
        lienzo = documento.convert('RGBA')

    ancho_px = max(1, round(ancho * lienzo.width))
    alto_px = max(1, round(ancho_px * firma.height / firma.width))
    estampa = _rotar(firma.resize((ancho_px, alto_px), Image.LANCZOS), rotacion)

    # Se compone sobre una capa del tamaño del documento: así la firma puede
    # sobresalir por un borde sin que reviente el pegado.
    capa = Image.new('RGBA', lienzo.size, (0, 0, 0, 0))
    capa.paste(estampa, (round(x * lienzo.width - estampa.width / 2),
                         round(y * lienzo.height - estampa.height / 2)))

    imaging.guardar(Image.alpha_composite(lienzo, capa), destino, formato, CALIDAD_IMAGEN)


def _estampa(firma: Image.Image, ancho_pt: float, rotacion: float) -> tuple[bytes, float, float]:
    """Rasteriza y gira la firma.

    Devuelve el PNG y cuánto mide su caja —ya girada— en relación al ancho que
    se pidió, para que quien la coloque sepa cuánto ocupa de verdad.
    """
    escala = PPP_FIRMA / 72
    ancho_px = max(1, round(ancho_pt * escala))
    alto_px = max(1, round(ancho_px * firma.height / firma.width))
    girada = _rotar(firma.resize((ancho_px, alto_px), Image.LANCZOS), rotacion)

    buffer = io.BytesIO()
    girada.save(buffer, 'PNG', optimize=True)
    return buffer.getvalue(), girada.width / ancho_px, girada.height / ancho_px


def _rotar(imagen: Image.Image, rotacion: float) -> Image.Image:
    """Gira en el mismo sentido que el `rotate()` de CSS, que es el horario."""
    if not rotacion:
        return imagen
    return imagen.rotate(-rotacion, resample=Image.BICUBIC, expand=True)


def _formato_de_salida(extension: str) -> tuple[str, str]:
    """Con qué formato se guarda una imagen firmada.

    Se conserva el de entrada siempre que sea uno de los que la aplicación sabe
    escribir bien; si no (un GIF, por ejemplo), se pasa a PNG, que admite el
    alfa y no pierde calidad.
    """
    escribibles = {f['id'] for f in salidas_disponibles()} - {'PDF'}
    formato = Image.EXTENSION.get(extension.lower())
    if formato in escribibles:
        return formato, extension.lower()
    return 'PNG', '.png'
