"""Qué es de verdad un archivo, mirando sus primeros bytes.

Vive junto a `storage.py` y no dentro de `api/` porque lo usa el almacén al
guardar una subida, y `api/__init__.py` importa del almacén: ahí dentro sería
una importación circular.

La extensión la pone quien sube el archivo, y se equivoca a menudo: un PDF
renombrado a `.docx`, una foto que el móvil guardó como `.jpg` siendo HEIC, un
`.pdf` que en realidad es la página de error del sitio de donde se descargó.

Comprobarlo aquí no es seguridad —nada de lo que se sube se ejecuta— sino trato
al usuario: sin esto, el archivo entra, la herramienta lo intenta y falla con un
«no se ha podido abrir, puede estar dañado», que manda a buscar el problema al
sitio equivocado. Con esto, el aviso llega al subirlo y dice qué parece ser.
"""
import os
import zipfile

from errors import ApiError

# Cuánto se lee de la cabecera. De sobra para cualquier firma conocida.
CABECERA = 4096

# Firma → nombre para una persona. El orden importa: la primera que encaje gana.
FIRMAS = [
    (b'%PDF-', 'un PDF'),
    (b'\xff\xd8\xff', 'una imagen JPEG'),
    (b'\x89PNG\r\n\x1a\n', 'una imagen PNG'),
    (b'GIF87a', 'una imagen GIF'),
    (b'GIF89a', 'una imagen GIF'),
    (b'BM', 'una imagen BMP'),
    (b'II*\x00', 'una imagen TIFF'),
    (b'MM\x00*', 'una imagen TIFF'),
    (b'\xd0\xcf\x11\xe0', 'un documento antiguo de Office (.doc/.xls/.ppt)'),
    (b'{\\rtf', 'un documento RTF'),
    (b'PK\x03\x04', 'un archivo comprimido o un documento de Office moderno'),
    (b'\x1f\x8b', 'un archivo comprimido (gzip)'),
    (b'Rar!', 'un archivo RAR'),
    (b'7z\xbc\xaf\x27\x1c', 'un archivo 7z'),
    (b'\x7fELF', 'un programa'),
    (b'MZ', 'un programa de Windows'),
]

# Qué firma tiene que tener cada extensión. Lo que no está aquí no se comprueba:
# el texto plano, el Markdown, el CSV y el JSON no tienen firma ninguna, y
# rechazarlos por no reconocerlos sería peor que no mirar.
ESPERADO = {
    '.pdf': (b'%PDF-',),
    '.jpg': (b'\xff\xd8\xff',),
    '.jpeg': (b'\xff\xd8\xff',),
    '.png': (b'\x89PNG\r\n\x1a\n',),
    '.gif': (b'GIF87a', b'GIF89a'),
    '.bmp': (b'BM',),
    '.tif': (b'II*\x00', b'MM\x00*'),
    '.tiff': (b'II*\x00', b'MM\x00*'),
    '.rtf': (b'{\\rtf',),
    '.doc': (b'\xd0\xcf\x11\xe0',),
    # Los de Office moderno y el EPUB son ZIP por dentro; lo que llevan dentro se
    # mira aparte, más abajo.
    '.docx': (b'PK\x03\x04',),
    '.xlsx': (b'PK\x03\x04',),
    '.pptx': (b'PK\x03\x04',),
    '.odt': (b'PK\x03\x04',),
    '.ods': (b'PK\x03\x04',),
    '.odp': (b'PK\x03\x04',),
    '.epub': (b'PK\x03\x04',),
}

# Dentro del ZIP, qué distingue a cada familia. Un `.docx` que por dentro es una
# hoja de cálculo falla igual que un `.pdf` que es un JPEG.
DENTRO_DEL_ZIP = {
    '.docx': ('word/', 'un documento de Word'),
    '.xlsx': ('xl/', 'una hoja de cálculo'),
    '.pptx': ('ppt/', 'una presentación'),
    '.epub': ('META-INF/container.xml', 'un EPUB'),
}

# La familia HEIF no tiene una firma, tiene once. El estándar deja que el
# codificador elija la «marca principal» según cómo haya guardado la imagen:
# `heic` es la que ponen los móviles, `mif1` la de una imagen suelta genérica,
# `heix` la de diez bits y `msf1`/`hevc` las de secuencia. Quedarse sólo con
# `heic` rechazaría al subirlo un archivo perfectamente válido, y el mensaje
# diría además que «no es una imagen HEIC por dentro», que es justo lo contrario
# de lo que pasa.
MARCAS_HEIF = tuple(b'ftyp' + marca for marca in (
    b'heic', b'heix', b'hevc', b'hevx', b'heim', b'heis', b'hevm', b'hevs',
    b'mif1', b'msf1', b'avic',
))

# WebP, AVIF y HEIC llevan la firma a partir del byte 4 (son contenedores
# RIFF/ISO-BMFF), no al principio.
DESPLAZADAS = {
    '.webp': (4, (b'WEBP',), 'una imagen WebP'),
    '.avif': (4, (b'ftypavif', b'ftypavis'), 'una imagen AVIF'),
    '.heic': (4, MARCAS_HEIF, 'una imagen HEIC'),
    '.heif': (4, MARCAS_HEIF, 'una imagen HEIF'),
}


def describir(cabecera: bytes) -> str:
    """Qué parece ser esto, dicho para una persona."""
    for firma, nombre in FIRMAS:
        if cabecera.startswith(firma):
            return nombre
    for _, (desplazamiento, firmas, nombre) in DESPLAZADAS.items():
        if _casa_desplazada(cabecera, desplazamiento, firmas):
            return nombre
    if not cabecera.strip():
        return 'un archivo vacío'
    try:
        cabecera.decode('utf-8')
        return 'texto'
    except UnicodeDecodeError:
        return 'otra cosa'


def comprobar(ruta: str, nombre: str, extension: str) -> None:
    """Falla si el contenido no se corresponde con la extensión.

    Sólo comprueba lo que tiene firma conocida. Lo que no —texto plano, CSV,
    Markdown— pasa: no hay nada que mirar, y dejar pasar es mejor que rechazar
    por no saber.
    """
    extension = extension.lower()
    esperadas = ESPERADO.get(extension)
    desplazada = DESPLAZADAS.get(extension)
    if not esperadas and not desplazada:
        return

    try:
        with open(ruta, 'rb') as fichero:
            cabecera = fichero.read(CABECERA)
    except OSError:
        return  # si no se puede leer, ya fallará donde toque

    if esperadas and cabecera.startswith(tuple(esperadas)):
        _comprobar_dentro_del_zip(ruta, nombre, extension)
        return
    if desplazada:
        desplazamiento, firmas, _ = desplazada
        if _casa_desplazada(cabecera, desplazamiento, firmas):
            return

    raise ApiError(
        f'«{nombre}» no es {_articulo(extension)} por dentro: parece '
        f'{describir(cabecera)}. Comprueba el archivo o cámbiale la extensión.', 400)


def _casa_desplazada(cabecera: bytes, desplazamiento: int, firmas: tuple) -> bool:
    """Si alguna de las firmas está en su sitio, que no es el principio."""
    return any(cabecera[desplazamiento:desplazamiento + len(firma)] == firma
               for firma in firmas)


def _comprobar_dentro_del_zip(ruta: str, nombre: str, extension: str) -> None:
    """Un `.docx` que por dentro es una hoja de cálculo también está mal."""
    marca = DENTRO_DEL_ZIP.get(extension)
    if not marca:
        return
    prefijo, esperado = marca
    try:
        with zipfile.ZipFile(ruta) as paquete:
            nombres = paquete.namelist()
    except (zipfile.BadZipFile, OSError):
        raise ApiError(f'«{nombre}» está dañado: no se puede abrir por dentro.', 400) from None

    if any(n.startswith(prefijo) for n in nombres):
        return
    parecido = next((f'{texto}' for ext, (pref, texto) in DENTRO_DEL_ZIP.items()
                     if ext != extension and any(n.startswith(pref) for n in nombres)), None)
    raise ApiError(
        f'«{nombre}» no es {esperado} por dentro' +
        (f': parece {parecido}.' if parecido else '.') +
        ' Comprueba el archivo o cámbiale la extensión.', 400)


def _articulo(extension: str) -> str:
    """"un PDF", "una imagen JPG"… para que el mensaje se lea natural."""
    femeninas = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff',
                 '.webp', '.avif', '.heic', '.heif'}
    etiqueta = extension.lstrip('.').upper()
    return f'una imagen {etiqueta}' if extension in femeninas else f'un {etiqueta}'
