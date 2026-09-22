"""Endpoints de archivos: subida, descarga, empaquetado y limpieza de la sesión.

Son transversales: todas las herramientas trabajan sobre archivos subidos aquí
y devuelven resultados que se descargan por aquí.
"""
import os
import zipfile

from flask import Blueprint, jsonify, request, send_file

import config
from api import current_session, params, progreso
from api.formatos import EXTENSIONES_DOCUMENTO, EXTENSIONES_OFIMATICA, extensiones_de_entrada
from errors import ApiError
from storage import storage

bp = Blueprint('files', __name__, url_prefix='/api')

# Lo que admite la plataforma: PDF, lo que Pillow sepa abrir en esta instalación,
# los documentos que se pueden pasar a Markdown y los que LibreOffice pasa a PDF.
# Cada herramienta valida además lo suyo.
ALLOWED_EXTS = ({'.pdf'} | extensiones_de_entrada() | EXTENSIONES_DOCUMENTO
                | EXTENSIONES_OFIMATICA)

# Enumerar las ochenta y pico extensiones no le dice nada a nadie.
DESCRIPCION_ADMITIDOS = ('PDF, imágenes (JPG, PNG, HEIC, WebP, TIFF…) y documentos '
                         '(Word, ODT, RTF, Excel, PowerPoint, CSV, HTML, EPub)')

NOMBRE_ZIP_POR_DEFECTO = 'archivos.zip'


@bp.post('/files')
def upload_files():
    session_id = current_session()

    files = request.files.getlist('files')
    files = [f for f in files if f and f.filename]
    if not files:
        raise ApiError('No se ha recibido ningún archivo.', 400)

    # Cada archivo por su cuenta: si uno no vale, los demás no tienen por qué
    # caerse con él. Antes bastaba con que el quinto de diez mintiera sobre su
    # formato para perder la subida entera —y los cuatro primeros se quedaban en
    # el servidor ocupando cuota, marcados como error en la pantalla—.
    registros, rechazados = [], []
    for indice, archivo in enumerate(files):
        try:
            registros.append(storage.save_upload(session_id, archivo, ALLOWED_EXTS,
                                                 DESCRIPCION_ADMITIDOS))
        except ApiError as fallo:
            rechazados.append({'indice': indice, 'name': archivo.filename,
                               'error': fallo.message})

    # Si no se ha salvado ninguno, esto es un error de la petición y se responde
    # como tal, con el motivo del primero.
    if not registros:
        raise ApiError(rechazados[0]['error'], 400)

    respuesta = {'files': [r.to_json() for r in registros]}
    if rechazados:
        respuesta['rechazados'] = rechazados
    return jsonify(respuesta), 201


@bp.post('/files/zip')
def zip_files():
    """Empaqueta varios resultados en un único ZIP descargable."""
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1)

    nombre = datos.get('name') or NOMBRE_ZIP_POR_DEFECTO
    if not str(nombre).lower().endswith('.zip'):
        nombre = f'{nombre}.zip'

    # Se resuelve todo antes de escribir, para no dejar un ZIP a medias.
    entradas = [(storage.record_of(session_id, fid), storage.path_of(session_id, fid))
                for fid in file_ids]

    destino, record = storage.reserve_output(session_id, nombre)
    with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as paquete:
        usados: set[str] = set()
        for origen, ruta in entradas:
            paquete.write(ruta, arcname=_nombre_unico(origen.name, usados))

    return jsonify({'files': [storage.commit_output(session_id, record).to_json()]}), 201


@bp.get('/files/<file_id>/download')
def download_file(file_id: str):
    session_id = current_session()
    record = storage.record_of(session_id, file_id)
    path = storage.path_of(session_id, file_id)
    return send_file(path, as_attachment=True, download_name=record.name)


@bp.get('/files/<file_id>/paginas')
def page_count(file_id: str):
    """Cuántas páginas tiene un archivo ya subido.

    Vive aquí y no en una herramienta porque no es de ninguna: lo necesita quien
    quiera ofrecer un selector de página sin cargar pdf.js en el navegador. Es
    barato, PyMuPDF sólo lee el índice del archivo para contarlas.
    """
    session_id = current_session()
    record = storage.record_of(session_id, file_id)
    if record.ext != '.pdf':
        return jsonify({'paginas': 1})  # una imagen es una sola "página"

    ruta = storage.path_of(session_id, file_id)
    try:
        # Importado aquí y no arriba: éste es el único sitio de todo el módulo que
        # necesita PyMuPDF, y el servicio "web" —que es quien sirve este
        # blueprint— no tiene por qué cargar 50 MB de biblioteca para atender
        # subidas y descargas. Lo paga sólo quien cuenta páginas.
        import fitz  # PyMuPDF

        with fitz.open(ruta) as documento:
            if documento.needs_pass:
                raise ApiError(f'"{record.name}" está protegido con contraseña.', 422)
            return jsonify({'paginas': documento.page_count})
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{record.name}": {err}', 422) from err


@bp.patch('/files/<file_id>')
def rename_file(file_id: str):
    """Cambia el nombre con el que se descargará un archivo ya generado."""
    session_id = current_session()
    nombre = params.cuerpo().get('name')
    if not isinstance(nombre, str) or not nombre.strip():
        raise ApiError('Escribe un nombre para el archivo.', 400)
    return jsonify(storage.rename(session_id, file_id, nombre).to_json())


@bp.delete('/files/<file_id>')
def delete_file(file_id: str):
    session_id = current_session()
    record = storage.record_of(session_id, file_id)
    carpeta = storage.session_dir(session_id, create=False)
    for nombre in (record.stored_name, f'{record.id}.json'):
        try:
            os.remove(os.path.join(carpeta, nombre))
        except OSError:
            pass
    return '', 204


@bp.get('/session/uso')
def uso_de_la_sesion():
    """Cuánto ocupa la sesión y cuánto le cabe.

    Lo pregunta la cola de archivos para poder enseñarlo. Sin esto, quien llega
    al tope recibe un 413 correcto pero a ciegas: no sabe cuánto lleva
    acumulado ni que los resultados también cuentan.
    """
    session_id = current_session()
    tope = config.SESSION_QUOTA_MB * 1024 * 1024
    usado = storage.tamano_sesion(session_id)
    return jsonify({'usado': usado, 'tope': tope})


@bp.get('/progreso/<trabajo>')
def progreso_del_trabajo(trabajo: str):
    """Por dónde va el trabajo que está en marcha en este momento.

    Lo sirve `web` y no el servicio que trabaja, y eso es lo único que hace que
    sirva de algo: los workers de `pesados` están todos ocupados justamente con
    aquello por lo que se pregunta, así que esta consulta haría cola detrás. Por
    la misma razón cuelga de `/api/` y no de `/api/tools/`, que además tiene
    límite de tres conexiones por IP.

    `null` significa «aún no ha empezado», que es información: está en la cola.
    """
    return jsonify({'estado': progreso.leer(current_session(), trabajo)})


@bp.post('/progreso/<trabajo>/cancelar')
def cancelar_el_trabajo(trabajo: str):
    """Deja la marca que el trabajador mira entre paso y paso.

    No mata nada por su cuenta: quien para es el propio trabajo cuando la ve, y
    así no hay que ir a buscar procesos ajenos desde otro contenedor.
    """
    progreso.marcar_cancelacion(current_session(), trabajo)
    return '', 204


@bp.post('/session/keepalive')
def keepalive():
    """Evita que la sesión caduque mientras el visor sigue abierto."""
    storage.touch_session(current_session())
    return '', 204


@bp.delete('/session')
def clear_session():
    """Borra todos los archivos de la sesión actual, y sólo de esa."""
    storage.clear_session(current_session())
    return '', 204


def _nombre_unico(nombre: str, usados: set[str]) -> str:
    """Evita que dos archivos con el mismo nombre se pisen dentro del ZIP."""
    raiz, ext = os.path.splitext(nombre)
    candidato = nombre
    n = 2
    while candidato in usados:
        candidato = f'{raiz}-{n}{ext}'
        n += 1
    usados.add(candidato)
    return candidato
