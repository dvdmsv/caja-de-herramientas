"""Herramienta: recortar, girar y redimensionar una imagen.

Las tres cosas que se le piden a una foto antes de mandarla a cualquier sitio, y
para las que hoy hay que abrir un editor. Van juntas en una sola pantalla porque
se hacen juntas: se recorta el folio, se endereza y se baja de tamaño.

Todo el trabajo sale de `api/imaging.py`, que ya abre respetando la orientación
de la cámara, controla el tope de megapíxeles y sabe guardar en cada formato.

**El orden importa y es éste**: se abre (y con ello se aplica la orientación
EXIF), se recorta, se voltea, se gira y se redimensiona. El recorte va primero
porque sus coordenadas están referidas a la imagen **tal como se ve antes de
girarla**, que es lo que el navegador tiene delante cuando se arrastra el
recuadro. Girar antes obligaría a rotar también las coordenadas, que es la clase
de conversión que acaba desviándose entre los dos lados.

El formato se conserva: esto es un editor, no un conversor. Para cambiar de
formato está «Convertir imagen».
"""
import os

from PIL import Image
from flask import Blueprint, jsonify

import config
from api import current_session, imaging, limites, params, progreso
from api.formatos import extension_de, extensiones_de_entrada
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('editar_imagen', __name__, url_prefix='/api/tools')

PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Formato de salida según el de entrada. Se conserva siempre que Pillow sepa
# escribirlo; lo que no, va a un formato sin pérdida para no estropear de paso
# lo que se venía a recortar. El HEIC es la excepción: se recorta para usarlo
# fuera del móvil, y fuera del móvil casi nada lo abre.
EQUIVALENCIAS = {
    'JPEG': 'JPEG', 'MPO': 'JPEG', 'WEBP': 'WEBP', 'AVIF': 'AVIF',
    'PNG': 'PNG', 'BMP': 'BMP', 'TIFF': 'TIFF',
    'GIF': 'PNG', 'HEIF': 'JPEG',
}

GIROS = {0, 90, 180, 270}

CALIDAD_MINIMA, CALIDAD_MAXIMA, CALIDAD_POR_DEFECTO = 20, 100, 90

# 0 significa "no redimensionar".
LADO_MAXIMO_MINIMO, LADO_MAXIMO_MAXIMO = 320, 8000

# Por debajo de esto el recorte no es un recorte, es un error de arrastre.
LADO_MINIMO_PX = 8


@bp.post('/editar-imagen')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La edición')
def editar_imagen():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona una imagen.')
    ajustes = _leer_ajustes(datos)

    resultados = []
    for file_id in progreso.contando(file_ids, len(file_ids), 'Editando imágenes'):
        record = storage.record_of(session_id, file_id)
        if record.ext not in extensiones_de_entrada():
            pista = ' Para un PDF, usa "Organizar PDF".' if record.ext == '.pdf' else ''
            raise ApiError(f'"{record.name}" no es una imagen.{pista}', 400)
        ruta = storage.path_of(session_id, file_id)

        with imaging.abrir(ruta, record.name) as imagen:
            formato = EQUIVALENCIAS.get(imagen.format or '', 'PNG')
            base = os.path.splitext(nombre_seguro(record.name))[0]
            destino, salida = storage.reserve_output(
                session_id, f'{base}-editada{extension_de(formato)}')
            imaging.guardar(_editar(imagen, ajustes, record.name), destino,
                            formato, ajustes['calidad'])

        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _leer_ajustes(datos: dict) -> dict:
    """Las opciones, validadas y ya dentro de rango."""
    recorte = datos.get('recorte')
    if recorte is not None and not isinstance(recorte, dict):
        raise ApiError('El recorte no es válido.', 400)

    return {
        'recorte': _leer_recorte(recorte) if recorte else None,
        'giro': _leer_giro(datos),
        'espejo': params.booleano(datos, 'espejo', False),
        'lado_maximo': _leer_lado(datos),
        'calidad': params.entero(datos, 'calidad', CALIDAD_POR_DEFECTO,
                                 CALIDAD_MINIMA, CALIDAD_MAXIMA),
    }


def _leer_giro(datos: dict) -> int:
    """Sólo los cuatro giros rectos: un ángulo libre obligaría a rellenar las
    esquinas con algo, y eso ya no es girar una foto, es retocarla."""
    valor = datos.get('giro', 0)
    if not isinstance(valor, int) or isinstance(valor, bool) or valor not in GIROS:
        raise ApiError('El giro sólo puede ser 0, 90, 180 o 270 grados.', 400)
    return valor


def _leer_lado(datos: dict) -> int:
    if not datos.get('lado_maximo'):
        return 0
    return params.entero(datos, 'lado_maximo', 0, LADO_MAXIMO_MINIMO, LADO_MAXIMO_MAXIMO)


def _leer_recorte(recorte: dict) -> dict:
    """El recuadro, en proporciones de 0 a 1 desde arriba a la izquierda.

    Es la convención de todo el proyecto —la misma de `coordenadas.ts`,
    `visor.py` y `firmar.py`—, y está referida a la imagen **antes** del giro que
    el usuario haya pedido aquí. Que sea la misma en todas partes vale más que
    que fuera cómoda en cada una.
    """
    x = params.decimal(recorte, 'x', 0.0, 0.0, 1.0)
    y = params.decimal(recorte, 'y', 0.0, 0.0, 1.0)
    ancho = params.decimal(recorte, 'ancho', 1.0, 0.0, 1.0)
    alto = params.decimal(recorte, 'alto', 1.0, 0.0, 1.0)

    # Se recorta contra el borde en vez de rechazar: un arrastre que se pasa unos
    # píxeles del lado derecho es lo normal, no un error que merezca un diálogo.
    ancho = min(ancho, 1.0 - x)
    alto = min(alto, 1.0 - y)
    if ancho <= 0 or alto <= 0:
        raise ApiError('El recorte se queda fuera de la imagen.', 400)
    return {'x': x, 'y': y, 'ancho': ancho, 'alto': alto}


def _editar(imagen: Image.Image, ajustes: dict, nombre: str) -> Image.Image:
    """Recorta, voltea, gira y redimensiona, en ese orden."""
    resultado = imagen
    recorte = ajustes['recorte']
    if recorte:
        izquierda = round(recorte['x'] * resultado.width)
        arriba = round(recorte['y'] * resultado.height)
        derecha = round((recorte['x'] + recorte['ancho']) * resultado.width)
        abajo = round((recorte['y'] + recorte['alto']) * resultado.height)
        if derecha - izquierda < LADO_MINIMO_PX or abajo - arriba < LADO_MINIMO_PX:
            raise ApiError(
                f'El recorte de "{nombre}" es demasiado pequeño: no llega a '
                f'{LADO_MINIMO_PX} píxeles de lado.', 400)
        resultado = resultado.crop((izquierda, arriba, derecha, abajo))

    if ajustes['espejo']:
        resultado = resultado.transpose(Image.FLIP_LEFT_RIGHT)

    if ajustes['giro']:
        # `Image.ROTATE_*` gira en sentido antihorario y el usuario pide en
        # horario, que es como lo entiende todo el mundo y como lo hace
        # "Organizar PDF". De ahí el 360 menos.
        resultado = resultado.transpose({
            90: Image.ROTATE_270, 180: Image.ROTATE_180, 270: Image.ROTATE_90,
        }[ajustes['giro']])

    return imaging.redimensionar(resultado, ajustes['lado_maximo'])
