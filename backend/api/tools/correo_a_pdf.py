"""Herramienta: pasar un correo `.eml` o `.msg` a PDF, con sus adjuntos aparte.

Para guardar un correo como documento —un justificante, una conversación que hay
que presentar— sin depender del programa de correo. Lo que sale es el asunto de
título, las cabeceras (de, para, CC y fecha), el cuerpo y la lista de adjuntos,
y los adjuntos se entregan además como archivos sueltos.

La lectura es la de `api/correo.py`, la misma que usa "Documento a Markdown", y
la maquetación es la de "Markdown a PDF" (`generar`): WeasyPrint con las
descargas limitadas a `data:`, así que un correo con imágenes remotas no hace que
el servidor vaya a buscar nada fuera. Por eso tampoco se pintan: ni las remotas
ni las incrustadas, que salen como adjuntos.

Sin opciones de maquetación, a propósito: un correo no se diseña, se guarda. Las
de "Markdown a PDF" por defecto le sientan bien, y quien quiera otras puede
sacarlo en Markdown y maquetarlo allí.
"""
from flask import Blueprint, jsonify

from api import correo, current_session, limites, params, progreso
from api.tools.markdown_a_pdf import PLAZO_EN_PROCESO, generar
from errors import ApiError
from storage import storage, cambiar_extension

bp = Blueprint('correo_a_pdf', __name__, url_prefix='/api/tools')


@bp.post('/correo-a-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La maquetación del correo')
def correo_a_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona al menos un correo.')

    # Se resuelve y valida todo antes de maquetar nada: si uno no sirve, mejor
    # decirlo antes de tener medio lote hecho.
    entradas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext not in correo.EXTENSIONES:
            raise ApiError(f'"{record.name}" no es un correo (.eml o .msg).', 400)
        entradas.append((record, storage.path_of(session_id, file_id)))

    pdfs, correos = [], []
    for record, ruta in progreso.contando(entradas, len(entradas), 'Maquetando correos'):
        mensaje = correo.leer(ruta, record.name)
        pdfs.append((record, generar(correo.a_markdown(mensaje), record.name)))
        correos.append(mensaje)

    resultados = []
    for (record, pdf), mensaje in zip(pdfs, correos):
        destino, salida = storage.reserve_output(session_id, cambiar_extension(record.name, '.pdf'))
        with open(destino, 'wb') as fichero:
            fichero.write(pdf)
        resultados.append(storage.commit_output(session_id, salida))
        resultados += correo.guardar_adjuntos(session_id, mensaje)

    return jsonify({'files': [resultado.to_json() for resultado in resultados]}), 201
