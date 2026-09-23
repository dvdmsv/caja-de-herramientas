"""Herramienta: reducir el peso de un PDF.

Casi todo el peso de un PDF suele estar en sus imágenes, así que el trabajo real
es recomprimirlas. Además se limpia la estructura del documento: objetos
huérfanos, flujos sin comprimir y fuentes duplicadas.

Se puede pedir por nivel o **por tamaño**: «que no pase de 2 MB», que es lo que
dicen las sedes electrónicas. Con un tamaño, se busca la compresión más suave
que lo cumple —para no estropear las fotos más de lo necesario— en vez de ir
probando niveles a mano.
"""
import io
import os
import shutil
import tempfile

import fitz  # PyMuPDF
from PIL import Image
from flask import Blueprint, jsonify

import config
from api import current_session, params, progreso
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('comprimir_pdf', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Calidad JPEG y lado mayor admitido para las imágenes de dentro del PDF.
#
# `ninguno` no toca las imágenes: limpiar la estructura casi no baja nada en un
# PDF normal, porque el peso está en las imágenes. Existe para quien sólo quiere
# optimizar el archivo para la web sin degradar sus fotos.
NIVELES = {
    'ninguno': None,
    'suave': {'calidad': 85, 'lado_maximo': 2200},
    'media': {'calidad': 70, 'lado_maximo': 1600},
    'fuerte': {'calidad': 45, 'lado_maximo': 1100},
}

# Los pasos que se prueban cuando se pide un tamaño, de más suave a más fuerte.
# El primero no toca las imágenes: a veces basta con limpiar la estructura.
# Los extremos van más allá de "fuerte" a propósito: quien pide un tamaño
# prefiere unas fotos peores a un archivo que la sede le rechaza.
ESCALERA = [
    None,
    {'calidad': 85, 'lado_maximo': 2200},
    {'calidad': 75, 'lado_maximo': 1800},
    {'calidad': 65, 'lado_maximo': 1500},
    {'calidad': 55, 'lado_maximo': 1200},
    {'calidad': 45, 'lado_maximo': 1000},
    {'calidad': 35, 'lado_maximo': 800},
    {'calidad': 25, 'lado_maximo': 600},
]

# Tope del tamaño que se puede pedir, en MB. Sólo para cortar un número absurdo.
OBJETIVO_MAXIMO_MB = 1000

# Recomprimir una imagen ya pequeña casi nunca compensa y sí degrada.
MINIMO_BYTES = 20 * 1024
MINIMO_LADO = 80


@bp.post('/comprimir-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La compresión')
def comprimir_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    nivel = params.opcion(datos, 'nivel', NIVELES, 'media')
    # Linearizar: reordena el archivo para que un visor pueda enseñar la primera
    # página sin haberlo descargado entero. No cambia lo que se ve.
    para_web = params.booleano(datos, 'web', False)
    # Tamaño máximo en MB; 0 es comprimir por nivel.
    objetivo_mb = params.decimal(datos, 'objetivo_mb', 0.0, 0.0, OBJETIVO_MAXIMO_MB)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}-comprimido.pdf')
    tamano_original = os.path.getsize(origen)

    if objetivo_mb > 0:
        objetivo = int(objetivo_mb * 1024 * 1024)
        logrado = _hasta_tamano(origen, destino, objetivo, para_web)
        resultado = storage.commit_output(session_id, salida)
        return jsonify({
            'files': [resultado.to_json()],
            'resumen': {'antes': tamano_original, 'despues': resultado.size},
            'objetivo': {'bytes': objetivo, 'logrado': logrado},
        }), 201

    _comprimir(origen, destino, NIVELES[nivel], para_web)

    # Si el "comprimido" pesa más (pasa con PDF ya optimizados), se entrega el
    # original: nadie quiere descargar una versión peor de su archivo.
    #
    # Salvo que se haya pedido optimizar para la web: ahí el archivo puede
    # engordar unos kilobytes a propósito —la tabla que permite empezar a leer
    # sin descargarlo entero ocupa—, y devolver el original sería deshacer en
    # silencio justo lo que se ha pedido.
    if not para_web and os.path.getsize(destino) >= tamano_original:
        shutil.copyfile(origen, destino)

    resultado = storage.commit_output(session_id, salida)
    return jsonify({
        'files': [resultado.to_json()],
        'resumen': {'antes': tamano_original, 'despues': resultado.size},
    }), 201


@bp.post('/comprimir-pdf/minimo')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El cálculo del mínimo')
def minimo():
    """Lo más que puede bajar un PDF, para decirlo **antes** de pedir un tamaño.

    Sin esto, quien pide «1 MB» para un PDF que no baja de 3 se entera después
    de esperar. No es una estimación: es comprimirlo con el paso más fuerte de
    la escalera, que es lo más ligero que daría la herramienta. Por eso cuesta
    una compresión entera, y por eso va al servicio de trabajos pesados y la
    pantalla sólo lo pide cuando se elige comprimir por tamaño.
    """
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])
    original = os.path.getsize(origen)

    with tempfile.TemporaryDirectory() as temporal:
        prueba = os.path.join(temporal, 'minimo.pdf')
        _comprimir(origen, prueba, ESCALERA[-1], False, etapa='Calculando hasta dónde baja')
        # Si comprimir no lo aligera, la herramienta entrega el original.
        return jsonify({'minimo': min(os.path.getsize(prueba), original), 'original': original})


def _comprimir(origen: str, destino: str, ajustes: dict | None, para_web: bool,
               etapa: str = 'Recomprimiendo imágenes') -> None:
    """Una pasada de compresión con unos ajustes, del original a `destino`."""
    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña.', 422)
        if ajustes:
            _recomprimir_imagenes(documento, etapa=etapa, **ajustes)
        # Limpiar la estructura y escribirlo entero no es despreciable en un
        # PDF grande, y no se puede contar: se dice al menos qué está pasando.
        progreso.fase('Guardando el documento', cancelable=False)
        documento.save(destino, garbage=4, deflate=True, deflate_images=True,
                       deflate_fonts=True, clean=True, linear=para_web)


def _hasta_tamano(origen: str, destino: str, objetivo: int, para_web: bool) -> bool:
    """Deja en `destino` la compresión más suave que no pasa de `objetivo`.

    Si ni la más fuerte llega, deja la más ligera que se ha conseguido y
    devuelve `False`: mejor acercarse que no entregar nada, y quien lo pidió
    decide si le vale.

    Se busca por bisección en `ESCALERA` en vez de probar los pasos en orden:
    cada intento es recomprimir el documento entero, y así son tres o cuatro
    intentos en vez de hasta ocho. Funciona porque cada paso pesa menos que el
    anterior, o casi siempre.
    """
    if not para_web and os.path.getsize(origen) <= objetivo:
        # Ya cabe: nada que estropear.
        shutil.copyfile(origen, destino)
        return True

    with tempfile.TemporaryDirectory() as temporal:
        pesos: dict[int, int] = {}

        def probar(paso: int) -> int:
            if paso not in pesos:
                intento = os.path.join(temporal, f'{paso}.pdf')
                _comprimir(origen, intento, ESCALERA[paso], para_web,
                           etapa=f'Intento {len(pesos) + 1}: recomprimiendo imágenes')
                pesos[paso] = os.path.getsize(intento)
            return pesos[paso]

        # Primero el más fuerte: si ése no llega, ninguno llega.
        ultimo = len(ESCALERA) - 1
        if probar(ultimo) > objetivo:
            mejor = min(pesos, key=pesos.get)
            logrado = False
        else:
            bajo, alto = 0, ultimo
            while bajo < alto:
                medio = (bajo + alto) // 2
                if probar(medio) <= objetivo:
                    alto = medio
                else:
                    bajo = medio + 1
            mejor, logrado = alto, True

        # Si ni así baja del original, el original: nadie quiere una versión
        # peor de su archivo que además pesa más.
        if not para_web and pesos[mejor] >= os.path.getsize(origen):
            shutil.copyfile(origen, destino)
        else:
            shutil.copyfile(os.path.join(temporal, f'{mejor}.pdf'), destino)
        return logrado


def _recomprimir_imagenes(documento, calidad: int, lado_maximo: int,
                          etapa: str = 'Recomprimiendo imágenes') -> None:
    """Sustituye las imágenes del PDF por versiones JPEG más ligeras."""
    procesados: set[int] = set()

    for pagina in progreso.contando(documento, documento.page_count, etapa):
        for informacion in pagina.get_images(full=True):
            xref = informacion[0]
            if xref in procesados:
                continue
            procesados.add(xref)

            try:
                original = documento.extract_image(xref)
            except Exception:
                continue  # imagen ilegible: se deja como está

            # Las imágenes con transparencia se saltan: al pasarlas a JPEG
            # perderían el canal alfa y aparecerían recuadros negros.
            if original.get('smask'):
                continue
            if len(original['image']) < MINIMO_BYTES:
                continue

            nueva = _a_jpeg(original['image'], calidad, lado_maximo)
            if nueva and len(nueva) < len(original['image']):
                try:
                    pagina.replace_image(xref, stream=nueva)
                except Exception:
                    continue  # el PDF se queda con la imagen original


def _a_jpeg(datos: bytes, calidad: int, lado_maximo: int) -> bytes | None:
    """Reescala y recomprime una imagen; devuelve None si no se puede."""
    try:
        with Image.open(io.BytesIO(datos)) as imagen:
            if min(imagen.size) < MINIMO_LADO:
                return None
            imagen = imagen.convert('RGB')
            if max(imagen.size) > lado_maximo:
                imagen.thumbnail((lado_maximo, lado_maximo), Image.LANCZOS)
            destino = io.BytesIO()
            imagen.save(destino, 'JPEG', quality=calidad, optimize=True, progressive=True)
            return destino.getvalue()
    except Exception:
        return None
