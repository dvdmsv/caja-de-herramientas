"""Qué formatos de imagen sabe manejar esta instalación.

La lista se calcula preguntándole a Pillow en el arranque en vez de fijarla a
mano: así la interfaz nunca ofrece un formato que luego falle al guardar (AVIF,
por ejemplo, sólo está disponible con ciertas versiones o con un plugin).
"""
from PIL import Image

# HEIC es lo que guarda de serie el iPhone y buena parte de los Android, y Pillow
# no lo abre sin ayuda. El plugin se registra aquí, antes del `Image.init()`,
# porque a partir de ese momento lo ve `extensiones_de_entrada()` y **todas** las
# herramientas de imagen lo admiten a la vez, sin tocar ninguna.
#
# El `try` no es un adorno: este módulo se importa al arrancar los tres
# servicios, y quedarse sin HEIC es mucho mejor que quedarse sin servidor.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass

Image.init()

# Formatos de salida que tienen sentido ofrecer, con la extensión y el nombre
# que ve el usuario. Se filtran por lo que Pillow pueda escribir de verdad.
#
# HEIF no está a propósito, aunque con `pillow-heif` registrado Pillow sepa
# escribirlo: aquí se viene a convertir un HEIC en algo que se pueda abrir en
# cualquier sitio, no al revés.
_CANDIDATOS_SALIDA = [
    ('JPEG', '.jpg', 'JPG'),
    ('PNG', '.png', 'PNG'),
    ('WEBP', '.webp', 'WebP'),
    ('AVIF', '.avif', 'AVIF'),
    ('TIFF', '.tiff', 'TIFF'),
    ('BMP', '.bmp', 'BMP'),
    ('PDF', '.pdf', 'PDF'),
]

# Formatos con pérdida: son los únicos donde el ajuste de calidad hace algo.
CON_CALIDAD = {'JPEG', 'WEBP', 'AVIF'}

# Formatos que no admiten transparencia: hay que aplanar el canal alfa.
SIN_TRANSPARENCIA = {'JPEG', 'BMP', 'PDF'}

# Documentos que markitdown sabe pasar a Markdown, además del PDF y de los
# correos `.eml` y `.msg`, que lee `api/correo.py`.
#
# `.zip` se queda fuera a propósito aunque markitdown lo soporte: descomprimir
# en el servidor lo que suba cualquiera invita a una zip bomb, y aquí no aporta.
EXTENSIONES_DOCUMENTO = {
    '.docx', '.xlsx', '.xls', '.pptx', '.csv', '.json', '.xml', '.html', '.htm', '.txt',
    '.md', '.epub', '.eml', '.msg',
}

# Documentos que sólo entiende LibreOffice ("Documento a PDF"), no markitdown:
# por eso van aparte y no dentro de EXTENSIONES_DOCUMENTO.
EXTENSIONES_OFIMATICA = {'.doc', '.odt', '.rtf', '.ods', '.ppt', '.odp'}


def salidas_disponibles() -> list[dict]:
    """Formatos a los que se puede convertir, en el orden en que se muestran."""
    return [
        {'id': pillow, 'extension': ext, 'nombre': etiqueta, 'calidad': pillow in CON_CALIDAD}
        for pillow, ext, etiqueta in _CANDIDATOS_SALIDA
        if pillow in Image.SAVE
    ]


def salidas_de_imagen() -> list[dict]:
    """Como `salidas_disponibles`, pero sin PDF: para quien ya parte de un PDF."""
    return [formato for formato in salidas_disponibles() if formato['id'] != 'PDF']


def extension_de(formato: str) -> str:
    for pillow, ext, _ in _CANDIDATOS_SALIDA:
        if pillow == formato:
            return ext
    return '.img'


def extensiones_de_entrada() -> set[str]:
    """Extensiones de imagen que Pillow puede abrir en esta instalación."""
    return {ext.lower() for ext, formato in Image.EXTENSION.items() if formato in Image.OPEN}
