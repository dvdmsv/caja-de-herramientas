"""Herramienta: tachar de un PDF los datos personales que encajen con un patrón.

Tachar a mano una por una las apariciones de un DNI en un contrato de treinta
páginas es exactamente el trabajo que nadie termina bien: se escapa la del pie de
la página 17. Aquí se marcan los tipos de dato y se aplica al documento entero.

**Lo que hace es una redacción de verdad, no un rectángulo encima.** Es la misma
pareja que usa el visor (`add_redact_annot` + `apply_redactions`): el texto
desaparece del archivo, no se puede copiar ni buscar ni recuperar quitando el
recuadro. Por eso no tiene vuelta atrás y la página lo avisa antes.

Los patrones y su validación están en `api/patrones.py`, fuera de aquí, porque
son lo único de esto que se puede probar con cadenas escritas a mano. Y por eso
mismo los comparte con el visor, que llama a `/inspeccionar` para pre-marcar las
coincidencias y dejar que las revises antes de guardar: reescribir las
expresiones en TypeScript sería garantizar que las dos versiones se separan.

Lo que **no** hace: tocar los metadatos ni los adjuntos, que son otro sitio donde
puede quedar un nombre. Eso es «Editar metadatos», y la página lo dice.
"""
import os

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, limites, params, patrones, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('anonimizar_pdf', __name__, url_prefix='/api/tools')

# Este trabajo ocurre **dentro** del proceso, no como programa aparte, así que
# necesita su propio plazo: sin él el único freno sería el de gunicorn.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

# Lo que queda a la vista donde estaba el dato. Los mismos dos que ofrece el
# visor al tachar, y por la misma razón: más colores no ayudan a nadie.
COLORES = {'negro': (0, 0, 0), 'blanco': (1, 1, 1)}

# Tope de coincidencias en un documento. **No es un límite de producto**: un
# contrato de trescientas páginas con un DNI en cada una es uso corriente, y
# medido da unas 24 coincidencias por página. Con el tope en 2000 esto fallaba a
# partir de unas 84 páginas, que es justo el caso para el que se hizo la
# herramienta. Lo que acota de verdad el trabajo es el plazo y el `RLIMIT_CPU`;
# esto es sólo la red contra una expresión que case con todo.
#
# Tiene que ir a la par con `MAXIMO_MARCAS` del visor: si el visor admitiera
# menos, marcar funcionaría y **guardar** fallaría con otro 413. Hay un test que
# lo cruza.
MAXIMO_ZONAS = 50_000


@bp.post('/anonimizar-pdf/inspeccionar')
@limites.con_plazo(limites.PLAZO_AUXILIAR, 'La búsqueda')
def inspeccionar():
    """Qué se encontraría, sin tocar el archivo.

    Devuelve el recuento por tipo —que es lo que se enseña antes de un borrado
    irreversible— y, para el visor, dónde está cada cosa.
    """
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    tipos, propio = _leer_ajustes(datos)

    ruta, _ = _documento(session_id, file_ids[0])
    with fitz.open(ruta) as documento:
        _comprobar_abierto(documento)
        zonas = _zonas(documento, tipos, propio)
        # Cada zona va con su tipo, no sólo con su rectángulo: el visor las
        # pinta como marcas suyas y en el panel lateral hay que poder leer
        # «DNI» en vez de un rectángulo sin nombre.
        paginas = [{'pagina': numero,
                    'marcas': [{'tipo': zona[4],
                                'rect': _proporciones(documento[numero - 1], zona)}
                               for zona in lista]}
                   for numero, lista in sorted(zonas.items())]

    recuento: dict = {}
    for lista in zonas.values():
        for zona in lista:
            recuento[zona[4]] = recuento.get(zona[4], 0) + 1

    return jsonify({
        'total': sum(recuento.values()),
        'recuento': [{'tipo': tipo, 'cuantas': cuantas} for tipo, cuantas in recuento.items()],
        'paginas': paginas,
    })


@bp.post('/anonimizar-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El tachado')
def anonimizar_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    tipos, propio = _leer_ajustes(datos)
    color = COLORES[params.opcion(datos, 'color', COLORES, 'negro')]

    ruta, record = _documento(session_id, file_ids[0])
    with fitz.open(ruta) as documento:
        _comprobar_abierto(documento)
        zonas = _zonas(documento, tipos, propio)
        if not zonas:
            raise ApiError('No se ha encontrado ninguno de los datos que has marcado. '
                           'El documento se queda como estaba.', 422)

        for numero, pagina in progreso.contando(enumerate(documento, start=1),
                                                documento.page_count, 'Tachando'):
            if numero not in zonas:
                continue
            for x0, y0, x1, y1, _ in zonas[numero]:
                pagina.add_redact_annot(fitz.Rect(x0, y0, x1, y1), fill=color)
            # Sin esto quedaría un recuadro encima y el texto seguiría debajo,
            # copiable y buscable. Es la línea que hace que esto sirva.
            pagina.apply_redactions()

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-anonimizado.pdf')
        documento.save(destino, deflate=True, garbage=3)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()],
                    'tachadas': sum(len(lista) for lista in zonas.values())}), 201


def _leer_ajustes(datos: dict) -> tuple[set, object]:
    """Qué hay que buscar. Compartido por la inspección y la ejecución.

    Va junto a propósito: si cada una leyera lo suyo, el recuento que se enseña
    y lo que luego se tacha dejarían de coincidir en cuanto alguien tocase un
    valor por defecto.
    """
    crudos = datos.get('tipos', [])
    if not isinstance(crudos, list) or not all(isinstance(t, str) for t in crudos):
        raise ApiError('La lista de tipos de dato no es válida.', 400)

    desconocidos = [t for t in crudos if t not in patrones.PATRONES]
    if desconocidos:
        admitidos = ', '.join(patrones.PATRONES)
        raise ApiError(f'Tipo de dato no válido: "{desconocidos[0]}". '
                       f'Admitidos: {admitidos}.', 400)

    texto = datos.get('patron') or ''
    if not isinstance(texto, str):
        raise ApiError('La expresión no es válida.', 400)
    texto = texto.strip()

    propio = None
    if texto:
        try:
            propio = patrones.compilar(texto)
        except ValueError as err:
            raise ApiError(str(err), 400) from err

    if not crudos and propio is None:
        raise ApiError('Marca al menos un tipo de dato, o escribe una expresión propia.', 400)

    return set(crudos), propio


def _documento(session_id: str, file_id: str):
    record = storage.record_of(session_id, file_id)
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    return storage.path_of(session_id, file_id), record


def _comprobar_abierto(documento) -> None:
    if documento.needs_pass:
        raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)
    if documento.page_count == 0:
        raise ApiError('El PDF no tiene páginas.', 422)


def _zonas(documento, tipos: set, propio) -> dict:
    """Qué hay que tachar en cada página, indexado por número de página (1..n).

    Los rectángulos salen de `page.get_text('words')`, que los da en el espacio
    **sin girar**, que es justo el que quiere `add_redact_annot`. No hay que
    transformar nada; quien sí tiene que hacerlo es `_proporciones`, que va en
    sentido contrario.
    """
    encontradas: dict = {}
    con_texto = False
    total = 0

    for numero, pagina in enumerate(documento, start=1):
        palabras = pagina.get_text('words')
        if palabras:
            con_texto = True
        zonas = patrones.zonas_de_palabras(palabras, tipos, propio)
        if not zonas:
            continue
        total += len(zonas)
        if total > MAXIMO_ZONAS:
            _pasarse(total, propio)
        encontradas[numero] = zonas

    if not con_texto:
        raise ApiError(
            'Este PDF no tiene texto: es un escaneado, y lo que parecen letras son '
            'una imagen. Pásalo antes por "PDF con OCR" y vuelve aquí.', 422)

    return encontradas


def _pasarse(total: int, propio) -> None:
    """Se han encontrado tantas que esto ya no es anonimizar un documento.

    El mensaje cambia según haya expresión propia o no. Decirle «tu expresión
    casa con demasiadas cosas» a quien sólo marcó «DNI» lo manda a buscar el
    problema donde no está.
    """
    if propio is not None:
        raise ApiError(
            f'Tu expresión casa con más de {MAXIMO_ZONAS} trozos del documento. '
            'Afínala y vuelve a probar: la cuenta de arriba te dice cuántos va '
            'encontrando.', 413)
    raise ApiError(
        f'Este documento tiene más de {MAXIMO_ZONAS} datos personales, que es más '
        'de lo que cabe tratar de una vez. Pártelo con "Dividir PDF" y anonimiza '
        'cada parte.', 413)


def _proporciones(pagina, zona) -> list:
    """El camino de vuelta: de rectángulo del archivo a proporciones de 0 a 1.

    Es el inverso exacto de `_rectangulos` del visor, y tiene que serlo: lo que
    devuelve esto lo pinta el visor como una marca más. `get_text` mide en el
    espacio sin girar y `page.rect` es la página **ya girada**, así que hay que
    llevar el rectángulo al espacio que se ve (`rotation_matrix`) antes de
    dividir. Sin eso, en un PDF con `/Rotate` las marcas salen en otro sitio.
    """
    rect = fitz.Rect(zona[0], zona[1], zona[2], zona[3])
    if pagina.rotation:
        rect = rect * pagina.rotation_matrix
    rect.normalize()
    caja = pagina.rect
    return [(rect.x0 - caja.x0) / caja.width, (rect.y0 - caja.y0) / caja.height,
            (rect.x1 - caja.x0) / caja.width, (rect.y1 - caja.y0) / caja.height]
