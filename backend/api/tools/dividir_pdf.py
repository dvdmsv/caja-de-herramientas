"""Herramienta: sacar páginas sueltas o rangos de un PDF a un documento nuevo.

Es la operación inversa de "Unir PDF". Las páginas se copian tal cual, sin
rasterizar, así que el resultado conserva texto, fuentes y calidad.
"""
import os
import re

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

from api import current_session, params, progreso
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('dividir_pdf', __name__, url_prefix='/api/tools')

MODOS = {'unico', 'por-pagina'}

# Un archivo por página con documentos largos llenaría la sesión de basura.
MAXIMO_ARCHIVOS = 200

# "12", "3-9", "10-" (hasta el final) o "-4" (desde el principio).
RANGO = re.compile(r'^(\d*)\s*-\s*(\d*)$')


@bp.post('/dividir-pdf')
def dividir_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='Selecciona un PDF.')
    modo = params.opcion(datos, 'modo', MODOS, 'unico')

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        with fitz.open(origen) as documento:
            if documento.needs_pass:
                raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)
            total = documento.page_count
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: puede estar dañado ({err}).', 422) from err
    if total == 0:
        raise ApiError('El PDF no tiene páginas.', 422)

    numeros = expandir_paginas(datos.get('paginas'), total)
    if modo == 'por-pagina' and len(numeros) > MAXIMO_ARCHIVOS:
        raise ApiError(
            f'Serían {len(numeros)} archivos y el máximo son {MAXIMO_ARCHIVOS}. '
            'Prueba con menos páginas o en un solo documento.', 413)

    base = os.path.splitext(nombre_seguro(record.name))[0]
    ancho = len(str(total))

    if modo == 'unico':
        resultados = [_escribir(session_id, f'{base}-paginas.pdf', origen, numeros)]
    else:
        resultados = [_escribir(session_id, f'{base}-pagina-{n:0{ancho}d}.pdf', origen, [n])
                      for n in progreso.contando(numeros, len(numeros), 'Escribiendo archivos')]

    return jsonify({'files': [r.to_json() for r in resultados]}), 201


def expandir_paginas(texto: str, total: int) -> list[int]:
    """Convierte "1-3, 7, 10-" en la lista de páginas, en el orden pedido.

    Se valida aquí y no en el navegador porque es el servidor quien no debe
    fiarse de lo que le llega.
    """
    if not isinstance(texto, str) or not texto.strip():
        raise ApiError('Indica qué páginas quieres, por ejemplo "1-3, 7".', 400)

    numeros: list[int] = []
    for trozo in re.split(r'[,;\s]+', texto.strip()):
        if not trozo:
            continue
        if trozo.isdigit():
            inicio = fin = int(trozo)
        else:
            partes = RANGO.match(trozo)
            if not partes or not (partes.group(1) or partes.group(2)):
                raise ApiError(
                    f'No entiendo "{trozo}". Usa números y rangos, como "1-3, 7, 10-".', 400)
            inicio = int(partes.group(1)) if partes.group(1) else 1
            fin = int(partes.group(2)) if partes.group(2) else total
        if inicio > fin:
            raise ApiError(f'El rango "{trozo}" está del revés.', 400)
        if inicio < 1 or fin > total:
            raise ApiError(f'El PDF tiene {total} páginas y has pedido "{trozo}".', 400)
        numeros.extend(range(inicio, fin + 1))

    # Una página repetida se queda con su primera aparición: el orden lo marca
    # quien escribe, pero duplicarla casi nunca es lo que se pretendía.
    vistas: set[int] = set()
    unicas = [n for n in numeros if not (n in vistas or vistas.add(n))]
    if not unicas:
        raise ApiError('No has seleccionado ninguna página.', 400)
    return unicas


def _escribir(session_id: str, nombre: str, origen: str, numeros: list[int]):
    """Escribe un PDF con las páginas pedidas, en el orden pedido.

    Se usa `select`, que se queda con esas páginas y **reajusta el índice y los
    destinos de los enlaces internos**. Copiar página a página, como se hacía
    antes, dejaba el documento sin índice y con los enlaces apuntando a la
    página equivocada.

    Se vuelve a abrir el original en cada archivo porque `select` modifica el
    documento en memoria: reutilizarlo dejaría el segundo recorte sobre el
    primero.
    """
    destino, salida = storage.reserve_output(session_id, nombre)
    with fitz.open(origen) as documento:
        documento.select([n - 1 for n in numeros])
        documento.save(destino, deflate=True, garbage=3)
    return storage.commit_output(session_id, salida)
