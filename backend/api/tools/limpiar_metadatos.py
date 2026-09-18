"""Herramienta: ver qué cuentan de ti tus archivos, corregirlo o borrarlo.

Un PDF lleva dentro quién lo escribió y con qué programa; una foto de móvil lleva
el modelo de la cámara, la fecha exacta y, muy a menudo, **las coordenadas del
sitio donde se hizo**. Se reparte sin querer cada vez que se manda un archivo.

Va en dos fases, y ese es todo el punto de la herramienta:

1. ``/limpiar-metadatos/inspeccionar`` mira los archivos y cuenta lo que llevan
   dentro **sin tocarlos**. Cada dato viene con una clave, para poder señalarlo,
   y con su valor entero, para poder cambiarlo.
2. ``/limpiar-metadatos`` recibe qué claves hay que borrar de cada archivo
   (``seleccion``) y cuáles hay que reescribir (``cambios``). Se puede tirar el
   GPS de una foto y conservar la fecha de la toma, o corregir el autor de un PDF
   que salió con el nombre de otro.

Borrar y cambiar el mismo dato a la vez es un error: no hay forma de adivinar
cuál de las dos cosas quería quien lo pidió.

De un PDF se enseñan **siempre** sus ocho campos, con valor o sin él: son un
juego fijo y corto, y así se puede rellenar el que falte. De una foto sólo lo que
lleva: inventarle un "número de serie" a una cámara no significa nada.

En los JPEG los metadatos se arrancan **sin recomprimir la imagen**: si se borra
todo el EXIF se omite su segmento, y si se borra sólo una parte se reconstruye el
segmento con lo que se conserva. Los datos de la imagen se copian tal cual, así
que limpiar nunca cuesta calidad.
"""
import os
import shutil
from datetime import datetime

import fitz  # PyMuPDF
from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS
from flask import Blueprint, jsonify

from api import current_session, imaging, params
from api.formatos import extension_de, extensiones_de_entrada, salidas_disponibles
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('limpiar_metadatos', __name__, url_prefix='/api/tools')

# Campos de un PDF, con el nombre que se le enseña al usuario. La clave es la
# misma que usa PyMuPDF, así que sirve tal cual para borrarlos.
CAMPOS_PDF = [
    ('title', 'Título'),
    ('author', 'Autor'),
    ('subject', 'Asunto'),
    ('keywords', 'Palabras clave'),
    ('creator', 'Creado con'),
    ('producer', 'Generado por'),
    ('creationDate', 'Fecha de creación'),
    ('modDate', 'Fecha de modificación'),
]

# Etiquetas EXIF que se enseñan una por una: las que dicen algo de quién hizo la
# foto, con qué y cuándo. El resto van juntas bajo `exif:otros`.
CAMPOS_EXIF = {
    0x010F: 'Marca de la cámara',
    0x0110: 'Modelo de la cámara',
    0xA434: 'Objetivo',
    0x0131: 'Software',
    0x0132: 'Fecha',
    0x9003: 'Fecha de la toma',
    0x013B: 'Autor',
    0x8298: 'Copyright',
    0x013C: 'Equipo',
    0xA431: 'Número de serie',
}

# Claves que no son etiquetas EXIF sueltas.
CLAVE_GPS = 'gps'
CLAVE_OTROS = 'exif:otros'
CLAVE_XMP = 'xmp'
CLAVE_IPTC = 'iptc'
CLAVE_COMENTARIO = 'comentario'

# Cómo se reconoce cada bloque de metadatos dentro de un JPEG. No basta el
# marcador: en APP1 caben tanto el EXIF como el XMP, y se borran por separado.
FIRMAS_JPEG = [
    (0xE1, b'Exif\x00\x00', 'exif'),
    (0xE1, b'http://ns.adobe.com/xap/', CLAVE_XMP),
    (0xED, b'Photoshop', CLAVE_IPTC),
    (0xFE, b'', CLAVE_COMENTARIO),
]

MAXIMO_VALOR = 120

# Longitud máxima de un valor escrito a mano. Ni el título de un PDF ni el autor
# de una foto necesitan más, y sin tope cualquiera podría meter un megabyte de
# texto en una cabecera.
MAXIMO_EDITADO = 500

CLAVES_PDF = {clave for clave, _ in CAMPOS_PDF}

# Formatos en los que se acepta una fecha escrita a mano: los mismos en los que
# se enseña. Guardarla es pasarla a la sintaxis de fechas del PDF.
FORMATOS_FECHA = ('%d/%m/%Y %H:%M', '%d/%m/%Y')


def _extensiones_admitidas() -> set:
    return {'.pdf'} | extensiones_de_entrada()


@bp.post('/limpiar-metadatos/inspeccionar')
def inspeccionar():
    """Lo que llevan dentro los archivos. No escribe nada."""
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un archivo.')

    informe = []
    for record, ruta in _entradas(session_id, file_ids):
        if record.ext == '.pdf':
            campos, ubicacion = _mirar_pdf(ruta, record.name)
        else:
            campos, ubicacion = _mirar_imagen(ruta, record.name)
        informe.append({'id': record.id, 'archivo': record.name,
                        'campos': campos, 'ubicacion': ubicacion})

    return jsonify({'metadatos': informe})


@bp.post('/limpiar-metadatos')
def limpiar_metadatos():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un archivo.')
    a_fondo = params.booleano(datos, 'a_fondo', False)
    entradas = _entradas(session_id, file_ids)
    seleccion = _leer_seleccion(datos, file_ids)
    cambios = _leer_cambios(datos, entradas, seleccion)

    resultados = []
    for record, origen in entradas:
        marcadas = seleccion.get(record.id, set())
        nuevos = cambios.get(record.id, {})
        base = os.path.splitext(nombre_seguro(record.name))[0]
        # El nombre cuenta lo que se ha hecho: si sólo se han corregido valores,
        # el archivo no se queda "sin metadatos".
        sufijo = 'sin-metadatos' if marcadas is None or marcadas or a_fondo else 'metadatos'

        if record.ext == '.pdf':
            destino, salida = storage.reserve_output(session_id, f'{base}-{sufijo}.pdf')
            _limpiar_pdf(origen, destino, record.name, marcadas, nuevos, a_fondo)
        else:
            formato, extension = _formato_de_salida(record.ext)
            destino, salida = storage.reserve_output(
                session_id, f'{base}-{sufijo}{extension}')
            _limpiar_imagen(origen, destino, record.name, marcadas, nuevos, formato)

        resultados.append(storage.commit_output(session_id, salida).to_json())

    return jsonify({'files': resultados}), 201


def _entradas(session_id: str, file_ids: list[str]) -> list:
    """Resuelve y valida todos los archivos antes de tocar ninguno."""
    admitidas = _extensiones_admitidas()
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in admitidas:
            raise ApiError(f'"{record.name}" no es un PDF ni una imagen.', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))
    return entradas


def _leer_seleccion(datos: dict, file_ids: list[str]) -> dict:
    """Qué claves hay que borrar de cada archivo.

    Sin `seleccion` se borra todo, que es lo que espera quien llame a la API a
    mano sin haber pasado por la inspección.
    """
    crudo = datos.get('seleccion')
    if crudo is None:
        return {file_id: None for file_id in file_ids}  # None = todo
    if not isinstance(crudo, dict):
        raise ApiError('La selección de metadatos no es válida.', 400)

    seleccion = {}
    for file_id in file_ids:
        claves = crudo.get(file_id, [])
        if not isinstance(claves, list) or not all(isinstance(c, str) for c in claves):
            raise ApiError('La selección de metadatos no es válida.', 400)
        seleccion[file_id] = set(claves)
    return seleccion


def _leer_cambios(datos: dict, entradas: list, seleccion: dict) -> dict:
    """Qué valor nuevo lleva cada clave, por archivo.

    Se valida contra el tipo del archivo: en un PDF sólo caben sus ocho campos, y
    en una foto sólo las etiquetas EXIF que la herramienta enseña.
    """
    crudo = datos.get('cambios')
    if crudo is None:
        return {}
    if not isinstance(crudo, dict):
        raise ApiError('Los cambios de metadatos no son válidos.', 400)

    cambios = {}
    for record, _ in entradas:
        campos = crudo.get(record.id) or {}
        if not isinstance(campos, dict):
            raise ApiError('Los cambios de metadatos no son válidos.', 400)

        marcadas = seleccion.get(record.id)
        limpio = {}
        for clave, valor in campos.items():
            if not isinstance(valor, str):
                raise ApiError('Los cambios de metadatos no son válidos.', 400)
            if len(valor) > MAXIMO_EDITADO:
                raise ApiError(f'El valor que has escrito en "{record.name}" es demasiado largo '
                               f'(máximo {MAXIMO_EDITADO} caracteres).', 400)
            if not _clave_editable(clave, record.ext == '.pdf'):
                raise ApiError(f'"{clave}" no es un dato que se pueda cambiar.', 400)
            # Con `marcadas is None` se ha pedido borrarlo todo y volver a
            # escribir lo que venga: eso no es una contradicción. Marcar **este**
            # dato para borrarlo y a la vez darle un valor, sí.
            if marcadas is not None and clave in marcadas:
                raise ApiError(f'No se puede borrar y cambiar el mismo dato de "{record.name}".',
                               400)
            limpio[clave] = valor.strip()
        if limpio:
            cambios[record.id] = limpio
    return cambios


def _clave_editable(clave: str, es_pdf: bool) -> bool:
    if es_pdf:
        return clave in CLAVES_PDF
    etiqueta = clave[5:] if clave.startswith('exif:') else ''
    return etiqueta.isdigit() and int(etiqueta) in CAMPOS_EXIF


# --- PDF -------------------------------------------------------------------

def _mirar_pdf(ruta: str, nombre: str) -> tuple[list, bool]:
    with _abrir_pdf(ruta, nombre) as documento:
        campos = _campos_pdf(documento.metadata or {})
        if documento.xref_xml_metadata() != 0:
            campos.append(_bloque(CLAVE_XMP, 'Metadatos XMP',
                                  'un bloque incrustado en el documento'))
    return campos, False


def _limpiar_pdf(origen: str, destino: str, nombre: str, marcadas, cambios: dict,
                 a_fondo: bool) -> None:
    with _abrir_pdf(origen, nombre) as documento:
        todo = marcadas is None
        if not todo and not marcadas and not cambios and not a_fondo:
            shutil.copyfile(origen, destino)  # no hay nada que hacer
            return

        if a_fondo:
            # `remove_links=False` a propósito: quitar los enlaces se llevaría
            # por delante el índice del documento, y eso no es un metadato.
            documento.scrub(remove_links=False)

        if todo:
            # Con el diccionario vacío PyMuPDF los borra todos; con uno lleno
            # sólo toca los campos que se nombran y conserva el resto.
            documento.set_metadata({})
            documento.del_xml_metadata()
        else:
            campos = {clave: '' for clave, _ in CAMPOS_PDF if clave in marcadas}
            if campos:
                documento.set_metadata(campos)
            if CLAVE_XMP in marcadas:
                documento.del_xml_metadata()

        if cambios:
            # Después del borrado: así "bórralo todo y ponle este título" hace
            # las dos cosas y en ese orden.
            documento.set_metadata({clave: _valor_pdf(clave, valor)
                                    for clave, valor in cambios.items()})

        try:
            documento.save(destino, deflate=True, garbage=4, clean=True)
        except Exception as err:
            raise ApiError(f'No se ha podido guardar "{nombre}": {err}', 422) from err


def _abrir_pdf(ruta: str, nombre: str):
    try:
        documento = fitz.open(ruta)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err
    if documento.needs_pass:
        documento.close()
        raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422)
    return documento


def _campos_pdf(metadatos: dict) -> list[dict]:
    """Los ocho campos, con valor o sin él: los vacíos se pueden rellenar."""
    campos = []
    for clave, etiqueta in CAMPOS_PDF:
        valor = _fecha_legible((metadatos.get(clave) or '').strip())
        campos.append({'clave': clave, 'etiqueta': etiqueta,
                       'valor': _recortar(valor), 'texto': valor, 'editable': True})
    return campos


def _valor_pdf(clave: str, valor: str) -> str:
    """Lo que se escribe en el PDF; las fechas vuelven a su sintaxis."""
    if clave not in ('creationDate', 'modDate') or not valor:
        return valor
    for formato in FORMATOS_FECHA:
        try:
            return datetime.strptime(valor, formato).strftime('D:%Y%m%d%H%M%S')
        except ValueError:
            continue
    raise ApiError(f'"{valor}" no es una fecha. Escríbela como 31/12/2026 o 31/12/2026 09:30.',
                   400)


def _fecha_legible(valor: str) -> str:
    """"D:20260901083704Z'" -> "01/09/2026 08:37". Lo demás se deja como está."""
    if not valor.startswith('D:') or len(valor) < 10:
        return valor
    crudo = valor[2:]
    try:
        fecha = f'{crudo[6:8]}/{crudo[4:6]}/{crudo[0:4]}'
        return f'{fecha} {crudo[8:10]}:{crudo[10:12]}' if len(crudo) >= 12 else fecha
    except (IndexError, ValueError):
        return valor


# --- imágenes --------------------------------------------------------------

def _mirar_imagen(ruta: str, nombre: str) -> tuple[list, bool]:
    with imaging.abrir(ruta, nombre) as imagen:
        campos, ubicacion = _campos_exif(imagen)
        for clave, etiqueta in ((CLAVE_XMP, 'Metadatos XMP'),
                                (CLAVE_IPTC, 'Datos IPTC (pies de foto, autoría)'),
                                (CLAVE_COMENTARIO, 'Comentario')):
            if _tiene_bloque(imagen, clave):
                campos.append(_bloque(clave, etiqueta, 'un bloque incrustado en el archivo'))
    return campos, ubicacion


def _bloque(clave: str, etiqueta: str, valor: str) -> dict:
    """Un metadato que sólo se puede conservar o tirar entero, nunca escribir."""
    return {'clave': clave, 'etiqueta': etiqueta, 'valor': valor,
            'texto': '', 'editable': False}


def _tiene_bloque(imagen: Image.Image, clave: str) -> bool:
    claves = {CLAVE_XMP: ('xmp', 'XML:com.adobe.xmp'),
              CLAVE_IPTC: ('iptc', 'photoshop'),
              CLAVE_COMENTARIO: ('comment',)}[clave]
    return any(imagen.info.get(nombre) for nombre in claves)


def _campos_exif(imagen: Image.Image) -> tuple[list[dict], bool]:
    try:
        exif = imagen.getexif()
    except Exception:
        return [], False
    if not exif:
        return [], False

    campos = []
    for etiqueta, valor in exif.items():
        if etiqueta in CAMPOS_EXIF and valor not in (None, ''):
            texto = _texto_exif(valor)
            campos.append({'clave': f'exif:{etiqueta}', 'etiqueta': CAMPOS_EXIF[etiqueta],
                           'valor': _recortar(texto), 'texto': texto, 'editable': True})

    ubicacion = False
    try:
        gps = exif.get_ifd(0x8825)
    except Exception:
        gps = None
    if gps:
        ubicacion = True
        campos.append(_bloque(CLAVE_GPS, 'Ubicación', _coordenadas(gps)))

    # Lo que no se enseña de una en una también se puede decidir: si no
    # apareciera aquí, se borraría sin que el usuario lo hubiera visto.
    otras = [e for e in exif if e not in CAMPOS_EXIF and e != 0x8825]
    if otras:
        campos.append(_bloque(CLAVE_OTROS, 'Otros datos de la cámara',
                              f'{len(otras)} campos técnicos (exposición, resolución…)'))

    return campos, ubicacion


def _texto_exif(valor) -> str:
    """Lo que dice una etiqueta EXIF, con los acentos en su sitio.

    El EXIF declara sus campos de texto como ASCII, así que Pillow los lee como
    latin-1 y "José" llega como "JosÃ©". Casi todo el mundo —exiftool incluido—
    escribe ahí UTF-8, que es también lo que escribe esta herramienta, así que se
    intenta interpretarlo como tal y se deja como estaba si no cuela.
    """
    texto = str(valor).strip()
    try:
        return texto.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return texto


def _valor_exif(texto: str):
    """Lo que se escribe en una etiqueta EXIF.

    Pillow cambia por "?" lo que no sea ASCII, así que un nombre con acentos
    quedaría destrozado. En bytes sí lo escribe tal cual, y en UTF-8 es como lo
    espera cualquier lector moderno.
    """
    return texto if texto.isascii() else texto.encode('utf-8')


def _coordenadas(gps: dict) -> str:
    """Las coordenadas en grados, para que se vea que no es un dato abstracto."""
    partes = {GPSTAGS.get(clave, clave): valor for clave, valor in gps.items()}
    try:
        latitud = _grados(partes['GPSLatitude'], partes.get('GPSLatitudeRef', 'N'))
        longitud = _grados(partes['GPSLongitude'], partes.get('GPSLongitudeRef', 'E'))
        return f'{latitud:.5f}, {longitud:.5f}'
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return 'sí, con coordenadas dentro'


def _grados(valor, referencia: str) -> float:
    grados, minutos, segundos = (float(parte) for parte in valor)
    resultado = grados + minutos / 60 + segundos / 3600
    return -resultado if referencia in ('S', 'W') else resultado


def _limpiar_imagen(origen: str, destino: str, nombre: str, marcadas, cambios: dict,
                    formato: str) -> None:
    todo = marcadas is None
    if not todo and not marcadas and not cambios:
        shutil.copyfile(origen, destino)  # no hay nada que hacer
        return

    with imaging.abrir(origen, nombre) as imagen:
        original = imagen.format
        exif = _exif_resultante(imagen, marcadas, cambios)

    # Si se toca cualquier cosa del EXIF, el bloque original sobra entero: lo que
    # se conserva se vuelve a escribir ya filtrado y con los valores nuevos.
    exif_tocado = todo or bool(cambios) or any(
        clave == CLAVE_GPS or clave.startswith('exif:') for clave in marcadas)

    if original == 'JPEG':
        # Sin recomprimir: se copian los bytes cambiando sólo las cabeceras.
        _reescribir_jpeg(origen, destino, marcadas, exif, exif_tocado)
        return

    with imaging.abrir(origen, nombre) as imagen:
        # Pillow reescribe lo que encuentre en `info`, así que se vacía lo que
        # el usuario ha marcado antes de guardar.
        for clave in (CLAVE_XMP, CLAVE_IPTC, CLAVE_COMENTARIO):
            if todo or clave in marcadas:
                for nombre_info in {'xmp': ('xmp', 'XML:com.adobe.xmp'),
                                    'iptc': ('iptc', 'photoshop'),
                                    'comentario': ('comment',)}[clave]:
                    imagen.info.pop(nombre_info, None)
        imagen.info.pop('exif', None)
        if exif is not None:
            imagen.info['exif'] = exif
        imaging.guardar(imagen, destino, formato, 95)


def _exif_resultante(imagen: Image.Image, marcadas, cambios: dict) -> bytes | None:
    """El EXIF que hay que escribir, ya serializado. `None` si no queda nada.

    Se reconstruye con Pillow en vez de tocar los bytes originales: sabe
    serializar el bloque entero, y así conservar la fecha mientras se tira el
    GPS —o corregir el autor— no obliga a recomprimir la imagen.
    """
    try:
        exif = imagen.getexif()
    except Exception:
        exif = Image.Exif()

    if marcadas is None:
        # Borrarlo todo y volver a escribir sólo lo que se haya corregido.
        exif = Image.Exif()
    else:
        if CLAVE_GPS in marcadas:
            exif.pop(0x8825, None)
        for etiqueta in list(exif):
            clave = f'exif:{etiqueta}'
            borrar = clave in marcadas if etiqueta in CAMPOS_EXIF else CLAVE_OTROS in marcadas
            if borrar and etiqueta != 0x8825:
                del exif[etiqueta]

    for clave, valor in cambios.items():
        etiqueta = int(clave[5:])
        if valor:
            exif[etiqueta] = _valor_exif(valor)
        else:
            exif.pop(etiqueta, None)  # dejar un campo en blanco es quitarlo

    if not list(exif) and not exif.get_ifd(0x8825):
        return None
    return exif.tobytes()


def _reescribir_jpeg(origen: str, destino: str, marcadas, exif: bytes | None,
                     exif_tocado: bool) -> None:
    """Copia el JPEG con las cabeceras que toquen, sin tocar la imagen."""
    with open(origen, 'rb') as fichero:
        datos = fichero.read()

    if not datos.startswith(b'\xff\xd8'):
        shutil.copyfile(origen, destino)  # no es lo que decía ser: mejor no tocarlo
        return

    salida = bytearray(datos[:2])
    if exif is not None:
        # El EXIF que se conserva va en su sitio de siempre: el primer APP1.
        salida += b'\xff\xe1' + (len(exif) + 2).to_bytes(2, 'big') + exif

    i = 2
    while i < len(datos) - 1 and datos[i] == 0xFF:
        marcador = datos[i + 1]
        if marcador == 0xDA:  # empiezan los datos comprimidos: el resto va tal cual
            salida += datos[i:]
            break
        longitud = int.from_bytes(datos[i + 2:i + 4], 'big')
        if longitud < 2:
            salida += datos[i:]
            break
        contenido = datos[i + 4:i + 2 + longitud]
        if not _sobra_segmento(marcador, contenido, marcadas, exif_tocado):
            salida += datos[i:i + 2 + longitud]
        i += 2 + longitud
    else:
        salida += datos[i:]

    with open(destino, 'wb') as fichero:
        fichero.write(bytes(salida))


def _sobra_segmento(marcador: int, contenido: bytes, marcadas, exif_tocado: bool) -> bool:
    """Si este segmento del JPEG lleva algo que el usuario ha marcado.

    Lo que no encaje con ninguna firma se queda: APP0 es el JFIF y APP2 suele
    llevar el perfil de color, y quitarlos estropearía la imagen.
    """
    for esperado, firma, familia in FIRMAS_JPEG:
        if marcador == esperado and contenido.startswith(firma):
            if familia == 'exif':
                # El EXIF que se conserve se vuelve a escribir aparte, filtrado y
                # con los valores nuevos, así que en cuanto se toque algo de él
                # sobra el original.
                return exif_tocado
            if marcadas is None:
                return True
            return familia in marcadas
    return False


def _formato_de_salida(extension: str) -> tuple[str, str]:
    """El mismo formato que traía, si esta instalación sabe escribirlo."""
    escribibles = {f['id'] for f in salidas_disponibles()} - {'PDF'}
    formato = Image.EXTENSION.get(extension.lower())
    if formato in escribibles:
        return formato, extension_de(formato) or extension.lower()
    return 'PNG', '.png'


def _recortar(valor: str) -> str:
    return valor if len(valor) <= MAXIMO_VALOR else valor[:MAXIMO_VALOR - 1] + '…'
