"""Herramienta: firmar un PDF con un certificado digital.

No tiene nada que ver con "Firmar documento", que estampa la **imagen** de una
firma: eso es un dibujo y no prueba nada. Aquí la firma va dentro del archivo,
atada criptográficamente a sus bytes, y demuestra dos cosas que un dibujo no
puede: **quién** firmó y que **nadie lo ha tocado desde entonces**. Es lo que
enseña Adobe Reader con su banda azul y lo que pide una administración.

Tres endpoints, con el molde de `firmar.py`:

- `/certificado` dice de quién es el certificado y hasta cuándo vale, para
  enseñarlo —y para saber que la contraseña es buena— **antes** de firmar nada.
- `/apariencia` devuelve el recuadro del sello como PNG, para poder arrastrarlo
  sobre la página sin ir al servidor en cada movimiento.
- `/firmar-certificado` firma.

**La apariencia la dibuja pyHanko, no el navegador**, por lo mismo que la vista
previa de la marca de agua la dibuja PyMuPDF: es el mismo código que va a
escribir el archivo, así que lo que se ve es lo que sale. El truco para que sea
barato es firmar un documento en blanco del tamaño del recuadro y rasterizar sólo
eso; no cuesta más que un PDF de una página por muy largo que sea el de verdad.
"""
import base64
import io
import os

import fitz  # PyMuPDF
from flask import Blueprint, current_app, jsonify, send_file

from api import current_session, firma_digital, params
from api.tools.firmar import firma_preparada
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('firmar_certificado', __name__, url_prefix='/api/tools')

# Anchura del sello en fracción del ancho de la página. Por debajo del 12 % el
# texto del certificado no se lee.
ANCHO_MINIMO, ANCHO_MAXIMO, ANCHO_POR_DEFECTO = 0.12, 1.0, 0.35

# El recuadro se compone a la medida de lo que pone: el ancho lo marca la línea
# más larga y el alto las líneas que haya. Así la proporción la decide el
# contenido, y el navegador la lee del PNG y la respeta al colocarlo, igual que
# `firmar` hace con el trazo. Un ancho fijo dejaría medio recuadro vacío con un
# nombre corto y apretaría el texto con uno largo.
# El alto de una línea es el cuerpo: es el interlineado que usa pyHanko cuando
# no se le dice otra cosa.
MARGEN_SELLO = 6

# Con firma a mano el recuadro se ensancha para hacerle sitio al lado del
# texto, y se le pone un alto mínimo para que el trazo no salga aplastado. Van
# en proporción y no en puntos: el usuario escala el sello al colocarlo y un
# número fijo no significaría nada.
PROPORCION_CON_TRAZO = 0.34

# Lo que ocupa la fecha que escribe pyHanko ("2026-09-01 15:00:10 CEST"). Se
# mide aquí porque al componer todavía no existe.
EJEMPLO_FECHA = '0000-00-00 00:00:00 CEST'

MAXIMO_TEXTO = 120

# A cuánto se rasteriza la apariencia. Es un recuadro pequeño y se ve ampliado
# en pantalla, así que va al doble de la resolución del PDF.
ESCALA_APARIENCIA = 2

# AutoFirma quiere la rúbrica en JPEG, y hay informes de que por encima de unos
# 6 kB deja de pintarla. No está documentado, así que en vez de fiarse se baja la
# escala hasta que cabe: un sello es casi todo texto sobre blanco y converge en
# dos o tres vueltas.
RUBRICA_MAXIMA = 6 * 1024
RUBRICA_ESCALAS = (2.0, 1.5, 1.0, 0.75, 0.5)
RUBRICA_CALIDAD = 80


@bp.post('/firmar-certificado/certificado')
def certificado():
    """De quién es el certificado, y de paso si la contraseña vale.

    Sirve a las dos vías: el `.p12` que sube el usuario y el certificado suelto
    que devuelve el selector de AutoFirma.
    """
    return jsonify(firma_digital.datos_del_certificado(
        firma_digital.certificado_de(params.cuerpo())))


@bp.post('/firmar-certificado/apariencia')
def apariencia():
    """El recuadro del sello, como PNG, para arrastrarlo sobre la página."""
    session_id = current_session()
    datos = params.cuerpo()
    certificado = firma_digital.certificado_de(datos)
    ajustes = _leer_ajustes(session_id, datos, certificado)

    return send_file(io.BytesIO(_rasterizar(ajustes)), mimetype='image/png')


@bp.post('/firmar-certificado/autofirma')
def para_autofirma():
    """Todo lo que AutoFirma necesita para estampar el mismo sello que estampamos aquí.

    AutoFirma firma en la máquina del usuario, así que la colocación se la
    tenemos que dar hecha. Se calcula con **las mismas funciones que la vía del
    `.p12`**: si esta conversión se rehiciera en TypeScript, la corrección del
    giro de página se duplicaría y se desincronizaría a la primera.
    """
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona el documento que quieres firmar.')

    certificado = firma_digital.certificado_de(datos)
    ajustes = _leer_ajustes(session_id, datos, certificado)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError('Sólo se puede firmar con certificado un PDF.', 400)
    pagina, caja = _donde_va(storage.path_of(session_id, file_ids[0]), datos, ajustes)

    return jsonify({
        # AutoFirma numera las páginas desde uno; `_donde_va` desde cero.
        'pagina': pagina + 1,
        'recuadro': [round(valor, 2) for valor in caja] if caja else None,
        'rubrica': base64.b64encode(_rubrica(ajustes)).decode() if ajustes['visible'] else '',
        'algoritmo': firma_digital.algoritmo_de(certificado),
        # Ya validados y recortados por `_leer_ajustes`, para que la firma diga
        # lo mismo por las dos vías.
        'motivo': ajustes['motivo'],
        'lugar': ajustes['lugar'],
    })


@bp.post('/firmar-certificado')
def firmar_certificado():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona el documento que quieres firmar.')

    firmante = firma_digital.cargar_firmante(datos)
    ajustes = _leer_ajustes(session_id, datos, firmante.signing_cert)
    sellador = firma_digital.sellador(datos)

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError('Sólo se puede firmar con certificado un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    pagina, caja = _donde_va(origen, datos, ajustes)

    base = os.path.splitext(nombre_seguro(record.name))[0]
    destino, salida = storage.reserve_output(session_id, f'{base}-firmado.pdf')

    with open(origen, 'rb') as entrada:
        firmado = _estampar(entrada.read(), ajustes, pagina, caja, firmante, sellador)
    with open(destino, 'wb') as archivo:
        archivo.write(firmado)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _leer_ajustes(session_id: str, datos: dict, certificado) -> dict:
    """Lo que decide qué pone el sello y cómo se ve.

    Lo comparten la apariencia y la firma de verdad: si cada una leyera lo suyo,
    dejarían de coincidir en cuanto alguien tocara un rango.
    """
    visible = params.booleano(datos, 'visible', True)
    motivo = _texto(datos, 'motivo')
    lugar = _texto(datos, 'lugar')

    lineas = ['Firmado digitalmente por', '%(signer)s', '%(ts)s']
    if motivo:
        lineas.append(f'Motivo: {motivo}')
    if lugar:
        lineas.append(f'Lugar: {lugar}')

    # Las mismas líneas con los huecos ya rellenos, sólo para medir el recuadro:
    # `%(signer)s` los sustituye pyHanko al componer, y para entonces ya es tarde.
    nombre = firma_digital.nombre_de(certificado)
    medida = [linea.replace('%(signer)s', nombre).replace('%(ts)s', EJEMPLO_FECHA)
              for linea in lineas]

    return {
        'visible': visible,
        'motivo': motivo,
        'lugar': lugar,
        'lineas': lineas,
        'medida': medida,
        'nombre': nombre,
        'trazo': firma_preparada(session_id, datos, 'trazo_id', obligatoria=False),
    }


def _medidas(ajustes: dict) -> tuple[float, float]:
    """Cuánto mide el recuadro, en puntos, para lo que va a poner dentro."""
    from api.firma_digital import ANCHO_MEDIO, CUERPO_SELLO

    largo = max(len(linea) for linea in ajustes['medida'])
    from api.firma_digital import PARTE_DEL_TRAZO

    ancho = largo * CUERPO_SELLO * ANCHO_MEDIO + 2 * MARGEN_SELLO
    alto = len(ajustes['lineas']) * CUERPO_SELLO + 2 * MARGEN_SELLO
    if ajustes['trazo'] is not None:
        # El texto se queda con lo que no ocupa el trazo, así que el recuadro
        # tiene que crecer para que no encoja.
        ancho /= 1 - PARTE_DEL_TRAZO
        alto = max(alto, ancho * PROPORCION_CON_TRAZO)
    return ancho, alto


def _donde_va(origen: str, datos: dict, ajustes: dict) -> tuple[int, tuple]:
    """La página y el rectángulo del campo de firma, en coordenadas del PDF.

    Aquí se juntan dos convenciones distintas y hay que traducir entre ellas:

    - El navegador manda `x`, `y` y `ancho` como fracciones de 0 a 1 con el
      **centro** del sello, igual que `colocacion.ts` y `firmar.py`.
    - pyHanko quiere la caja en **espacio de usuario del PDF**: origen abajo a la
      izquierda y **sin el giro** que tenga la página.

    PyMuPDF da lo contrario de las dos cosas —origen arriba y página ya girada—,
    así que hay que pasar por `derotation_matrix` y luego voltear la `y`. Sin lo
    primero el sello se va de sitio en cualquier PDF con `/Rotate`; sin lo
    segundo, en todos.
    """
    if not ajustes['visible']:
        return 0, None

    x = params.decimal(datos, 'x', 0.5, 0.0, 1.0)
    y = params.decimal(datos, 'y', 0.85, 0.0, 1.0)
    ancho = params.decimal(datos, 'ancho', ANCHO_POR_DEFECTO, ANCHO_MINIMO, ANCHO_MAXIMO)
    ancho_sello, alto_sello = _medidas(ajustes)
    proporcion = alto_sello / ancho_sello

    with _abrir(origen) as documento:
        numero = params.entero(datos, 'pagina', 1, 1, documento.page_count)
        pagina = documento[numero - 1]
        caja = pagina.rect

        medio_ancho = ancho * caja.width / 2
        medio_alto = ancho * caja.width * proporcion / 2
        centro_x, centro_y = caja.x0 + x * caja.width, caja.y0 + y * caja.height
        rect = fitz.Rect(centro_x - medio_ancho, centro_y - medio_alto,
                         centro_x + medio_ancho, centro_y + medio_alto)

        # A espacio sin girar, que es donde viven los campos de formulario.
        sin_girar = caja * pagina.derotation_matrix
        if pagina.rotation:
            rect = rect * pagina.derotation_matrix
        rect.normalize()
        sin_girar.normalize()

        # Y de arriba-abajo a abajo-arriba, que es lo que entiende pyHanko.
        suelo = sin_girar.y0 + sin_girar.y1
        return numero - 1, (rect.x0, suelo - rect.y1, rect.x1, suelo - rect.y0)


def _estampar(pdf: bytes, ajustes: dict, pagina: int, caja, firmante, sellador) -> bytes:
    """Firma el documento y devuelve los bytes del resultado.

    pyHanko escribe con **actualización incremental**: el archivo original queda
    intacto y lo firmado se añade al final. Por eso se puede firmar encima de un
    PDF ya firmado sin romper la firma anterior, y por eso el resultado no puede
    volver a pasar por `documento.save()` de PyMuPDF.
    """
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers

    entrada = io.BytesIO(pdf)
    try:
        escritor = IncrementalPdfFileWriter(entrada)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err
    if escritor.prev.encrypted:
        raise ApiError('El PDF está protegido con contraseña. Quítasela antes de firmarlo.', 422)

    campo = _nombre_de_campo(escritor)
    if ajustes['visible']:
        fields.append_signature_field(escritor, fields.SigFieldSpec(
            sig_field_name=campo, on_page=pagina, box=caja))

    metadatos = signers.PdfSignatureMetadata(
        field_name=campo,
        reason=ajustes['motivo'] or None,
        location=ajustes['lugar'] or None)
    pdf_signer = signers.PdfSigner(
        metadatos, signer=firmante, timestamper=sellador,
        stamp_style=_estilo(ajustes))

    try:
        salida = pdf_signer.sign_pdf(escritor, existing_fields_only=ajustes['visible'])
    except Exception as err:
        if sellador is not None:
            # El mensaje al usuario es genérico; sin esto la causa real (DNS,
            # URL mal puesta, certificado…) no queda en ningún sitio.
            current_app.logger.warning('Fallo al sellar la firma: %r', err)
            raise firma_digital.error_de_sellado() from err
        raise ApiError(f'No se ha podido firmar el documento: {err}', 422) from err
    return salida.getvalue()


def _rasterizar(ajustes: dict, escala: float = ESCALA_APARIENCIA,
                formato: str = 'png', calidad: int = 95) -> bytes:
    """Dibuja el sello y devuelve la imagen, **sin firmar nada**.

    Lo pinta `stamp.TextStamp`, que es exactamente la misma clase que pyHanko usa
    para la apariencia de una firma —`TextStampStyle.create_stamp` devuelve un
    `TextStamp`—, con el mismo estilo y los mismos huecos rellenos. Por eso lo
    que se ve aquí es lo que se estampa allí, y la prueba lo comprueba
    comparando los píxeles.

    Antes esto se hacía firmando una hoja en blanco de pega. Se cambió porque en
    la vía de AutoFirma no hay clave privada con la que firmar: sólo el
    certificado.
    """
    import datetime

    from pyhanko import stamp
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils.layout import BoxConstraints

    ancho, alto = _medidas(ajustes)
    hoja = fitz.open()
    pagina = hoja.new_page(width=ancho, height=alto)
    # El relleno blanco no es decorativo: una página recién creada con PyMuPDF no
    # tiene flujo de contenido, y `TextStamp.apply` da `KeyError: '/Contents'`.
    pagina.draw_rect(pagina.rect, color=None, fill=(1, 1, 1))
    pdf = hoja.tobytes()
    hoja.close()

    estilo = _estilo(ajustes)
    buffer = io.BytesIO(pdf)
    escritor = IncrementalPdfFileWriter(buffer)
    sello = stamp.TextStamp(
        escritor, estilo,
        # Los mismos dos huecos que rellena la firma (`cms_embedder.py`): el
        # nombre del titular y la hora, con el formato del propio estilo.
        text_params={'nombre': ajustes['nombre'],
                     'signer': ajustes['nombre'],
                     'ts': datetime.datetime.now().strftime(estilo.timestamp_format)},
        box=BoxConstraints(width=ancho, height=alto))
    sello.apply(0, 0, 0)

    salida = io.BytesIO()
    escritor.write(salida)
    with fitz.open(stream=salida.getvalue(), filetype='pdf') as documento:
        imagen = documento[0].get_pixmap(matrix=fitz.Matrix(escala, escala), alpha=False)
        return imagen.tobytes(formato, jpg_quality=calidad)


def _rubrica(ajustes: dict) -> bytes:
    """El sello en JPEG, encogido hasta que quepa en lo que admite AutoFirma."""
    imagen = b''
    for escala in RUBRICA_ESCALAS:
        imagen = _rasterizar(ajustes, escala, 'jpeg', RUBRICA_CALIDAD)
        if len(imagen) <= RUBRICA_MAXIMA:
            return imagen
    # Ni al mínimo cabe: se manda igualmente, que decida AutoFirma. Es mejor que
    # firmar sin nada visible sin avisar.
    return imagen


def _estilo(ajustes: dict):
    """El estilo del sello, ya con el trazo colocado en su mitad del recuadro."""
    ancho, alto = _medidas(ajustes)
    trazo = ajustes['trazo']
    if trazo is not None:
        trazo = firma_digital.lienzo_del_trazo(trazo, ancho, alto)
    return firma_digital.estilo_de_sello(ajustes['lineas'], trazo, ancho)


def _nombre_de_campo(escritor) -> str:
    """`Firma1`, `Firma2`… Un documento puede llevar varias firmas encadenadas,
    y dos campos no pueden llamarse igual."""
    try:
        usados = {firma.field_name for firma in escritor.prev.embedded_signatures}
    except Exception:
        usados = set()
    numero = 1
    while f'Firma{numero}' in usados:
        numero += 1
    return f'Firma{numero}'


def _abrir(origen: str):
    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err
    if documento.needs_pass:
        documento.close()
        raise ApiError('El PDF está protegido con contraseña. Quítasela antes de firmarlo.', 422)
    return documento


def _texto(datos: dict, clave: str) -> str:
    from api.tipografia import limpiar

    valor = limpiar(str(datos.get(clave) or '')).replace('\n', ' ').strip()
    if len(valor) > MAXIMO_TEXTO:
        raise ApiError(f'"{clave}" no puede pasar de {MAXIMO_TEXTO} caracteres.', 400)
    return valor
