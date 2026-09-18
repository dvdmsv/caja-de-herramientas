"""Herramienta: reconocer el texto de un PDF escaneado.

Le añade una capa de texto invisible encima de la imagen, así que el documento
se ve igual pero se puede buscar, copiar y —esto es lo interesante— pasar por
"Documento a Markdown", que hasta ahora se rendía ante un escaneado.

El trabajo lo hace ocrmypdf, y se lanza como proceso aparte en vez de por su API
de Python: reparte trabajo con multiprocessing y este servidor atiende con
hilos, así que aislarlo evita sorpresas y permite cortarlo por tiempo sin
llevarse por delante al worker.

Va por `api/conversion.py`, igual que LibreOffice y pdf2docx, y por la misma
razón: es el trabajo que más memoria pide de toda la aplicación —medido, 180 MB
con un `--jobs` y 327 MB con cuatro— y el worker atiende con cuatro hilos. Sin
turno, cuatro escaneados a la vez son cuatro ocrmypdf con sus cuatro procesos
cada uno: pasan de 1,3 GB, y eso en un contenedor de 1,5 GB que además tiene que
dar de comer a los workers. El cgroup lo mata, Docker lo reinicia y se lleva por
delante lo que estuvieran haciendo los demás.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, current_app, jsonify

import config
from api import conversion, current_session, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('ocr_pdf', __name__, url_prefix='/api/tools')

IDIOMAS = {'spa', 'eng', 'spa+eng'}

# No hay tope de páginas a propósito. Medido en el contenedor: un OCR de 10
# páginas consume 129 MB y uno de 30, 143 MB. Triplicar el documento sube la
# memoria un 11 %, porque las páginas se procesan de una en una y sólo hay una
# en memoria a la vez. Lo que crece es el tiempo, así que quien acota esto es el
# plazo de aquí abajo, no un número de páginas inventado.
#
# Por debajo del plazo de gunicorn, para poder contestar con un error entendible
# en vez de que nos corten la respuesta. Y con sitio para la espera del turno,
# que va por delante: 45 + 240 = 285 s contra los 300 de gunicorn. Si se sube,
# hay que subir también `GUNICORN_TIMEOUT`.
TIEMPO_LIMITE = config.entorno_entero('OCR_TIMEOUT_SECONDS', 240)

# Páginas que ocrmypdf reconoce en paralelo. Medido con 60 páginas escaneadas en
# un contenedor de 4 núcleos: con 1 tarda 36 s y consume 180 MB; con 4 tarda
# 21 s y consume 327 MB. Es decir, 42 % más rápido por 150 MB más.
#
# Por defecto, los núcleos que le tocan a este trabajo: los del contenedor
# repartidos entre los trabajos que corren a la vez. Pedir los cuatro con dos
# trabajos en marcha hace que los dos vayan más lentos. Los 150 MB extra son de la suma de los
# procesos de reconocimiento, y esos van y vienen con la petición.
TRABAJOS = config.entorno_entero('OCR_JOBS', config.nucleos_por_trabajo())

# Cuánto aprieta ocrmypdf el PDF resultante, de 0 a 3.
#
# Por defecto 1, y no 0 como antes, porque **sale gratis**: en la misma medición,
# el archivo pasó de 2742 kB a 716 kB —casi cuatro veces menos— en el mismo
# tiempo y con 6 MB más de memoria. El 0 no estaba comprando velocidad, sólo
# evitando una memoria que hoy sobra.
OPTIMIZACION = min(3, config.entorno_entero('OCR_OPTIMIZE', 1, minimo=0))

# Qué significa cada código de salida de ocrmypdf, en cristiano.
ERRORES = {
    2: ('No se ha podido leer el PDF: puede estar dañado.', 422),
    4: ('El resultado del reconocimiento no era un PDF válido.', 422),
    5: ('El resultado del reconocimiento no era un PDF válido.', 422),
    6: ('El PDF ya tiene texto. Marca "rehacer el reconocimiento" si aun así quieres repetirlo.', 400),
    8: ('El PDF está protegido con contraseña. Quítasela primero.', 422),
}


# Lo que se le dice a quien espera que va a tardar. Aquí no hay pasos que
# contar: ocrmypdf es una sola llamada que termina o no, así que el porcentaje lo
# anima el navegador con este número y se queda al 95 % hasta que hay respuesta.
#
# Sale de la medición de arriba —60 páginas en 36 s con un trabajo, 21 s con
# cuatro—, redondeado a lo alto: más vale que la barra vaya algo por detrás del
# trabajo que al contrario.
SEGUNDOS_POR_PAGINA = 0.7


@bp.post('/ocr-pdf')
def ocr_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    idioma = params.opcion(datos, 'idioma', IDIOMAS, 'spa+eng')
    rehacer = params.booleano(datos, 'rehacer', False)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        with fitz.open(origen) as documento:
            if documento.needs_pass:
                raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)
            paginas = documento.page_count
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    if paginas == 0:
        raise ApiError('El PDF no tiene páginas.', 422)
    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}-con-texto.pdf')
    with progreso.estimando('Reconociendo el texto', paginas * SEGUNDOS_POR_PAGINA):
        _reconocer(origen, destino, idioma, rehacer)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _reconocer(origen: str, destino: str, idioma: str, rehacer: bool) -> None:
    orden = [
        'ocrmypdf',
        '--jobs', str(TRABAJOS),
        '--optimize', str(OPTIMIZACION),
        '--language', idioma,
        '--quiet',
        # `redo-ocr` rehace el texto conservando los gráficos; `skip-text` deja
        # en paz las páginas que ya tenían texto de verdad.
        '--redo-ocr' if rehacer else '--skip-text',
        origen,
        destino,
    ]

    resultado = conversion.ejecutar(
        orden, TIEMPO_LIMITE, 'ocrmypdf',
        'El reconocimiento de texto no está disponible en este servidor.',
        trabajo='El reconocimiento')

    if resultado.returncode == 0:
        return

    mensaje, codigo = ERRORES.get(
        resultado.returncode, ('No se ha podido completar el reconocimiento de texto.', 422))
    # El detalle de ocrmypdf va al registro, no a la pantalla del usuario.
    current_app.logger.warning('ocrmypdf salió con %s: %s', resultado.returncode,
                               (resultado.stderr or '').strip()[:500])
    raise ApiError(mensaje, codigo)
