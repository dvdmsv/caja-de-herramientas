"""Herramienta: reducir el peso de una o varias imágenes.

Se conserva el formato original (una foto JPG sigue siendo JPG); lo que cambia
es la calidad y, si se pide, el tamaño en píxeles.

También se puede pedir **por tamaño**: «cada foto por debajo de 200 KB», que es
lo que dicen los formularios. Se busca la calidad más alta que lo cumple y, sólo
si ni así cabe, se reduce la foto en píxeles: una foto algo más pequeña se ve
mejor que una muy machacada.
"""
import io
import os
import shutil

from PIL import Image

from flask import Blueprint, jsonify

import config
from api import current_session, imaging, params, progreso
from api.formatos import CON_CALIDAD, extension_de, extensiones_de_entrada
from api.imaging import UMBRAL_PALETA
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('comprimir_imagen', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Formato de salida según el de entrada. Los que no admiten calidad se pasan a
# JPEG, que es donde se nota la compresión.
EQUIVALENCIAS = {
    'JPEG': 'JPEG', 'MPO': 'JPEG', 'WEBP': 'WEBP', 'AVIF': 'AVIF', 'PNG': 'PNG',
    'GIF': 'PNG', 'BMP': 'JPEG', 'TIFF': 'JPEG',
}

CALIDAD_MINIMA, CALIDAD_MAXIMA, CALIDAD_POR_DEFECTO = 20, 95, 75

# 0 significa "no redimensionar".
LADO_MAXIMO_MINIMO, LADO_MAXIMO_MAXIMO = 320, 8000

# Por tamaño: por debajo de esta calidad se prefiere reducir los píxeles, y a
# esta otra se reduce. En PNG la "calidad" es la reducción de paleta de
# `imaging.guardar`, que sólo actúa por debajo de `UMBRAL_PALETA`.
CALIDAD_SUELO, CALIDAD_AL_REDUCIR = 60, 75
ESCALA_MINIMA = 0.1
# Vueltas de la bisección de la escala: con seis, el error es de un 1,4 %.
VUELTAS_ESCALA = 6
OBJETIVO_MAXIMO_KB = 100 * 1024


@bp.post('/comprimir-imagen')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La compresión')
def comprimir_imagen():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos una imagen.')
    calidad = params.entero(datos, 'calidad', CALIDAD_POR_DEFECTO, CALIDAD_MINIMA, CALIDAD_MAXIMA)
    lado_maximo = datos.get('lado_maximo') or 0
    if lado_maximo:
        lado_maximo = params.entero(datos, 'lado_maximo', 0, LADO_MAXIMO_MINIMO, LADO_MAXIMO_MAXIMO)
    # Tamaño máximo de cada imagen en KB; 0 es comprimir por calidad.
    objetivo = int(params.decimal(datos, 'objetivo_kb', 0.0, 0.0, OBJETIVO_MAXIMO_KB) * 1024)

    resultados, antes, despues, no_alcanzadas = [], 0, 0, []

    for file_id in progreso.contando(file_ids, len(file_ids), 'Comprimiendo imágenes'):
        record = storage.record_of(session_id, file_id)
        if record.ext not in extensiones_de_entrada():
            pista = ' Usa la herramienta de comprimir PDF.' if record.ext == '.pdf' else ''
            raise ApiError(f'"{record.name}" no es una imagen.{pista}', 400)
        ruta = storage.path_of(session_id, file_id)

        with imaging.abrir(ruta, record.name) as imagen:
            formato = EQUIVALENCIAS.get(imagen.format or '', 'JPEG')
            base = os.path.splitext(nombre_seguro(record.name))[0]
            destino, salida = storage.reserve_output(
                session_id, f'{base}-comprimida{extension_de(formato)}')
            if not objetivo:
                imaging.guardar(imaging.redimensionar(imagen, lado_maximo), destino, formato, calidad)
            elif record.size <= objetivo and imagen.format == formato:
                # Ya cabe y no hay que cambiarle el formato: nada que estropear.
                shutil.copyfile(ruta, destino)
            else:
                datos_imagen, logrado = _hasta_tamano(imagen, formato, objetivo)
                with open(destino, 'wb') as fichero:
                    fichero.write(datos_imagen)
                if not logrado:
                    no_alcanzadas.append(record.name)

        guardado = storage.commit_output(session_id, salida)
        resultados.append(guardado.to_json())
        antes += record.size
        despues += guardado.size

    respuesta = {'files': resultados, 'resumen': {'antes': antes, 'despues': despues}}
    if objetivo:
        respuesta['objetivo'] = {'bytes': objetivo, 'logrado': not no_alcanzadas,
                                 'no_alcanzadas': no_alcanzadas}
    return jsonify(respuesta), 201


def _hasta_tamano(imagen: Image.Image, formato: str, objetivo: int) -> tuple[bytes, bool]:
    """La versión más fiel que no pasa de `objetivo`, y si se ha conseguido.

    Primero la calidad más alta que cabe a tamaño completo; si ni la más baja
    que se admite cabe, se reduce la foto buscando la escala más grande que
    cabe. Si ni al 10 % cabe, lo más ligero que haya salido.
    """
    probadas: list[bytes] = []

    def cabe(datos: bytes) -> bool:
        probadas.append(datos)
        return len(datos) <= objetivo

    if formato in CON_CALIDAD:
        # Bisección sobre las calidades de 95 a 60, de cinco en cinco: la más
        # alta que cabe. Si ni la de 60 cabe, no hay nada que buscar aquí.
        calidades = list(range(CALIDAD_MAXIMA, CALIDAD_SUELO - 1, -5))
        suelo = _codificar(imagen, formato, calidades[-1])
        if cabe(suelo):
            mejor, bajo, alto = suelo, 0, len(calidades) - 1
            while bajo < alto:
                medio = (bajo + alto) // 2
                datos = _codificar(imagen, formato, calidades[medio])
                if cabe(datos):
                    mejor, alto = datos, medio
                else:
                    bajo = medio + 1
            return mejor, True
        calidad = CALIDAD_AL_REDUCIR
    else:
        # PNG: a todo color y, si no, con la paleta más rica que hace
        # `imaging.guardar`, que apenas se nota.
        for calidad in (CALIDAD_MAXIMA, UMBRAL_PALETA - 1):
            datos = _codificar(imagen, formato, calidad)
            if cabe(datos):
                return datos, True

    minima = _codificar(imagen, formato, calidad, ESCALA_MINIMA)
    if not cabe(minima):
        return min(probadas, key=len), False
    mejor, bajo, alto = minima, ESCALA_MINIMA, 1.0
    for _ in range(VUELTAS_ESCALA):
        medio = (bajo + alto) / 2
        datos = _codificar(imagen, formato, calidad, medio)
        if cabe(datos):
            mejor, bajo = datos, medio
        else:
            alto = medio
    return mejor, True


def _codificar(imagen: Image.Image, formato: str, calidad: int, escala: float = 1.0) -> bytes:
    if escala < 1:
        ancho, alto = imagen.size
        imagen = imagen.resize((max(1, round(ancho * escala)), max(1, round(alto * escala))),
                               Image.LANCZOS)
    memoria = io.BytesIO()
    imaging.guardar(imagen, memoria, formato, calidad)
    return memoria.getvalue()
