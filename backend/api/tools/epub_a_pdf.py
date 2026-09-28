"""Herramienta: pasar un libro electrónico EPUB a PDF, para imprimirlo o leerlo
donde no hay lector de EPUB.

**Lo hace MuPDF, el mismo motor de PyMuPDF**, que abre EPUB de serie: maqueta el
libro con su propia hoja de estilos, incrusta sus imágenes y trae su índice. Así
no entra ninguna dependencia nueva, y es rápido: medido, las 748 páginas del
Quijote de Project Gutenberg en menos de tres segundos. Las letras genéricas del
libro («serif») las pone MuPDF con Charis SIL, que lleva dentro.

Un EPUB no tiene páginas: el texto fluye y se corta donde toque según el tamaño
de la hoja y de la letra. Por eso esas dos cosas son las opciones, con valores
de serie pensados para que funcione de un clic: A5, que es el tamaño de un libro,
y la letra que marca el propio EPUB.
"""
import os
import re
import zipfile

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, limites, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('epub_a_pdf', __name__, url_prefix='/api/tools')

PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Ancho y alto en puntos, y la letra base que le va a cada tamaño: un lector de
# 6″ con la letra de un A4 serían cuatro palabras por renglón.
PAGINAS = {
    'a5': (fitz.paper_rect('a5').width, fitz.paper_rect('a5').height, 10.5),
    'a4': (fitz.paper_rect('a4').width, fitz.paper_rect('a4').height, 11.5),
    # 90 × 122 mm, la pantalla de un lector de 6″.
    'lector': (90 / 25.4 * 72, 122 / 25.4 * 72, 9.5),
}

LETRAS = {'pequena': 0.85, 'normal': 1.0, 'grande': 1.2}

# Se convierte por tramos para poder contar por dónde va y cancelar un libro
# largo. Al unir los tramos, cada uno trae su copia de las fuentes: por eso se
# guarda con `garbage=4`, que junta los objetos repetidos (medido, sin eso el
# Quijote pasaba de 7,5 a 8,7 MB).
TRAMO = 40


@bp.post('/epub-a-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La conversión del libro')
def epub_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un libro EPUB.')
    ancho, alto, letra = PAGINAS[params.opcion(datos, 'pagina', PAGINAS, 'a5')]
    letra *= LETRAS[params.opcion(datos, 'letra', LETRAS, 'normal')]

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.epub':
        raise ApiError(f'"{record.name}" no es un libro EPUB.', 400)
    ruta = storage.path_of(session_id, file_ids[0])
    # Un EPUB es un ZIP: antes de dárselo a MuPDF, que no reviente al abrirlo.
    limites.comprobar_descomprimido(ruta, record.name)

    libro = _abrir(ruta, record.name)
    with libro:
        libro.layout(width=ancho, height=alto, fontsize=letra)
        total = libro.page_count
        if total == 0:
            raise ApiError(f'"{record.name}" no tiene nada que convertir.', 422)
        indice = libro.get_toc()
        metadatos = libro.metadata or {}

        pdf = fitz.open()
        tramos = range(0, total, TRAMO)
        for inicio in progreso.contando(tramos, len(tramos), 'Maquetando el libro'):
            fin = min(total, inicio + TRAMO) - 1
            with fitz.open('pdf', libro.convert_to_pdf(inicio, fin)) as trozo:
                pdf.insert_pdf(trozo)

    with pdf:
        # El índice del libro, como marcadores del PDF: es lo que deja saltar a
        # un capítulo en el visor.
        if indice:
            pdf.set_toc(indice)
        pdf.set_metadata({clave: metadatos.get(clave, '') for clave in ('title', 'author', 'subject')
                          if metadatos.get(clave)})
        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}.pdf')
        with progreso.estimando('Guardando el PDF', 3):
            pdf.save(destino, garbage=4, deflate=True)
    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


# Los dos «cifrados» que no son DRM: el ofuscado de fuentes que la norma EPUB
# permite para que una fuente incrustada no se pueda sacar tal cual. Llevan
# `encryption.xml` igual que un libro con DRM, y MuPDF los lee sin problema.
OFUSCADO_DE_FUENTES = ('http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC')


def _abrir(ruta: str, nombre: str) -> fitz.Document:
    if _con_drm(ruta):
        raise ApiError(f'"{nombre}" está protegido con DRM: sólo lo puede abrir el programa con el que '
                       'se compró, y convertirlo no es posible.', 422)
    try:
        return fitz.open(ruta, filetype='epub')
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": el EPUB está dañado ({err}).', 422) from err


def _con_drm(ruta: str) -> bool:
    """Si el libro lleva el contenido cifrado (Adobe, Kindle, Kobo…).

    Sin mirarlo, MuPDF abre el libro sin quejarse y saca páginas de basura. La
    señal es `META-INF/encryption.xml` con algún algoritmo que no sea el
    ofuscado de fuentes, que es legal y muy común.
    """
    try:
        with zipfile.ZipFile(ruta) as zipf:
            if 'META-INF/encryption.xml' not in zipf.namelist():
                return False
            xml = zipf.read('META-INF/encryption.xml').decode('utf-8', 'replace')
    except (zipfile.BadZipFile, OSError):
        return False  # que lo diga `fitz.open`, que explica mejor qué le pasa
    algoritmos = re.findall(r'Algorithm="([^"]+)"', xml)
    return any(algoritmo not in OFUSCADO_DE_FUENTES and 'xmldsig' not in algoritmo
               for algoritmo in algoritmos)
