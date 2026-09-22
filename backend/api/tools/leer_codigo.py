"""Herramienta: leer lo que pone dentro de un QR o de un código de barras.

Es la mitad que le faltaba a «Generar QR». El caso de uso más común no es
exótico: hay un QR en la pantalla del ordenador —una factura, un enlace, la
contraseña del wifi de la oficina— y para leerlo hay que coger el móvil,
apuntar, y a ver si engancha. Aquí se arrastra el pantallazo o el PDF y sale el
contenido, listo para copiar.

Como «Comprobar firmas», **no genera ningún archivo**: devuelve un informe. Por
eso no tiene endpoint principal ni botón de ejecutar, y por eso su única ruta
acaba en `/inspeccionar`, que nginx manda al servicio `ligeros` sin que haya que
tocar nada.

Lo lee **zxing-cpp**: una rueda de pip de un par de megas, sin bibliotecas de
sistema —a diferencia de pyzbar, que obligaría a meter `libzbar0` en el
Dockerfile— y con los formatos que hacen falta: QR, DataMatrix, Aztec, PDF417 y
los de barras de toda la vida (EAN, UPC, Code128, Code39, ITF).

Se importa dentro de la función, como pyHanko y markitdown: quien no use esta
herramienta no paga su memoria.
"""
import io

import fitz  # PyMuPDF
from flask import Blueprint, current_app, jsonify
from PIL import Image

from api import current_session, imaging, limites, params
from errors import ApiError
from storage import storage

bp = Blueprint('leer_codigo', __name__, url_prefix='/api/tools')

# Resolución a la que se miran las páginas de un PDF. A 150 ppp una A4 son 2,2
# megapíxeles: de sobra para cualquier código impreso y poco para el servicio
# `ligeros`, que es quien atiende esto y tiene 192 MB y 30 s de CPU por trabajo.
PPP = 150

# Cuántas páginas se miran como mucho, sumando todos los archivos de la petición.
# Lo pone el mismo perfil de `ligeros`: un código está en la primera página o en
# la última, no repartido por un documento de doscientas.
MAXIMO_PAGINAS = 30

# Cuántos códigos se devuelven como mucho. Una hoja de etiquetas puede traer
# cientos, y el informe dejaría de poder leerse mucho antes de llegar ahí.
MAXIMO_CODIGOS = 100

EXTENSIONES_PDF = {'.pdf'}


@bp.post('/leer-codigo/inspeccionar')
@limites.con_plazo(limites.PLAZO_AUXILIAR, 'La lectura')
def inspeccionar():
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=1,
                          mensaje='Selecciona una imagen o un PDF con el código.')

    presupuesto = [MAXIMO_PAGINAS]
    informes = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        ruta = storage.path_of(session_id, file_id)
        informes.append({
            'id': file_id,
            'archivo': record.name,
            'codigos': _codigos_de(ruta, record, presupuesto),
        })

    return jsonify({'informes': informes})


def _codigos_de(ruta: str, record, presupuesto: list) -> list:
    """Lo que haya dentro de un archivo, venga en imagen o en PDF."""
    if record.ext in EXTENSIONES_PDF:
        return _de_un_pdf(ruta, record.name, presupuesto)
    return _de_una_imagen(ruta, record.name)


def _de_una_imagen(ruta: str, nombre: str) -> list:
    # El tope de megapíxeles lo pone `imaging.abrir`, que es por donde pasa
    # cualquier imagen del proyecto. Repetirlo aquí sería mirar dos veces lo
    # mismo con los mismos números.
    with imaging.abrir(ruta, nombre) as imagen:
        return _leer(imagen)


def _de_un_pdf(ruta: str, nombre: str, presupuesto: list) -> list:
    encontrados = []
    try:
        documento = fitz.open(ruta)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422)
        for numero, pagina in enumerate(documento, start=1):
            if presupuesto[0] <= 0:
                break
            presupuesto[0] -= 1
            escala = PPP / 72
            limites.comprobar_lienzo(pagina.rect.width * escala, pagina.rect.height * escala,
                                     'La página')
            pixmap = pagina.get_pixmap(dpi=PPP, alpha=False)
            with Image.open(io.BytesIO(pixmap.tobytes('ppm'))) as imagen:
                for codigo in _leer(imagen):
                    encontrados.append({**codigo, 'pagina': numero})
            if len(encontrados) >= MAXIMO_CODIGOS:
                break
    return encontrados[:MAXIMO_CODIGOS]


def _leer(imagen) -> list:
    """Los códigos de una imagen, con un solo reintento y por un motivo medido.

    zxing-cpp aguanta mucho más de lo que parece: medido con un QR desenfocado,
    con poco contraste y reducido a un tercio, lo lee del tirón. Pasar a gris y
    estirar el contraste **no gana nada** en ninguno de esos casos, así que no se
    hace: sería triplicar el trabajo para nada.

    Donde sí gana es cuando el código tiene menos de un píxel por módulo —un QR
    de 43×43 en un pantallazo reducido—: ahí falla en directo y sale al doblar el
    tamaño. Por eso hay un reintento, y sólo uno: a 35×35 ya no lo lee ni
    doblando, y seguir subiendo es gastar por gastar.
    """
    zxingcpp = _biblioteca()

    rgb = imagen if imagen.mode == 'RGB' else imagen.convert('RGB')
    resultados = zxingcpp.read_barcodes(rgb)
    if not resultados and max(rgb.size) < 1000:
        doble = rgb.resize((rgb.width * 2, rgb.height * 2), Image.LANCZOS)
        resultados = zxingcpp.read_barcodes(doble)

    return [_describir(r) for r in resultados if r.valid and r.text][:MAXIMO_CODIGOS]


def _biblioteca():
    """zxing-cpp, o un error que se entienda si no está.

    Se importa aquí dentro, como pyHanko y markitdown: quien no use esta
    herramienta no paga su memoria. Y se traduce el fallo de importación como se
    traduce el de un programa que falta en `conversion.ejecutar`: sin esto, una
    rueda que no cargue en la imagen sale como «Error interno del servidor», que
    no le dice nada a quien lo lee ni a quien lo tiene que arreglar.
    """
    try:
        import zxingcpp
    except ImportError as err:
        current_app.logger.error('No se ha podido cargar zxing-cpp: %s', err)
        raise ApiError('La lectura de códigos no está disponible en este servidor.',
                       500) from err
    return zxingcpp


def _describir(resultado) -> dict:
    """Un código leído, dicho para una persona."""
    texto = resultado.text
    return {'formato': str(resultado.format), 'contenido': texto, 'clase': _clase(texto)}


def _clase(texto: str) -> str:
    """Qué es lo que hay dentro, con las mismas categorías que "Generar QR".

    Sirve para que la pantalla pueda enseñar una red wifi como una red wifi —con
    su nombre y su contraseña separados— en vez de como la cadena `WIFI:S:…`,
    que es lo que hace inútil a la mitad de los lectores.
    """
    en_mayusculas = texto.upper()
    if en_mayusculas.startswith('WIFI:'):
        return 'wifi'
    if en_mayusculas.startswith('BEGIN:VCARD') or en_mayusculas.startswith('MECARD:'):
        return 'contacto'
    if en_mayusculas.startswith('MAILTO:'):
        return 'correo'
    if en_mayusculas.startswith('TEL:') or en_mayusculas.startswith('SMSTO:'):
        return 'telefono'
    if en_mayusculas.startswith(('HTTP://', 'HTTPS://')):
        return 'enlace'
    if en_mayusculas.startswith('BEGIN:VEVENT'):
        return 'evento'
    return 'texto'
