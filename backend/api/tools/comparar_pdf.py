"""Herramienta: comparar dos PDF y decir en qué se diferencian.

La respuesta es un PDF: primero el resumen y lo que cambia en el texto, y
después las páginas afectadas **con lo cambiado recuadrado**. Las dos cosas
hacen falta y ninguna sobra: el texto dice qué frase se ha tocado, y la imagen
enseña la firma nueva o el logotipo cambiado, que no mueven una sola letra.

La lógica de comparar vive en `api/comparacion.py`, sin archivos ni Flask, para
poder probarla con listas e imágenes hechas a mano. Aquí sólo se rasteriza, se
compone el informe y se maqueta.
"""
import base64
import io
import os

import fitz  # PyMuPDF
from PIL import Image, ImageDraw
from flask import Blueprint, jsonify

import config
from api import comparacion, current_session, limites, params, pdf_estructura
from api.tools import markdown_a_pdf
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('comparar_pdf', __name__, url_prefix='/api/tools')

# Comparar es rasterizar las dos veces y maquetar un PDF al final, así que se le
# da más margen que a un trabajo de una pasada.
PLAZO_EN_PROCESO = config.entorno_entero('COMPARE_TIMEOUT_SECONDS', 180)

# Suficiente para leer lo recuadrado sin que el informe pese como un escáner.
PPP = 110

# Topes del informe. Comparar dos libros enteros no es lo que hace falta aquí, y
# más vale decirlo que tardar dos minutos en escupir 300 páginas.
MAXIMO_PAGINAS = 100
MAXIMO_IMAGENES = 25
MAXIMO_DIFERENCIAS = 120

# Cuánto tiene que cambiar un píxel para contar, y el margen del recuadro.
UMBRAL = 40
MARGEN = 4

TINTA = (214, 45, 45)


@bp.post('/comparar-pdf')
@limites.con_plazo(PLAZO_EN_PROCESO, 'La comparación')
def comparar_pdf():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=2, mensaje='Elige los dos PDF que quieres comparar.')
    if len(file_ids) != 2:
        raise ApiError('Se comparan dos documentos: elige exactamente dos PDF.', 400)
    con_imagenes = params.booleano(datos, 'imagenes', True)

    registros, rutas = [], []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        registros.append(record)
        rutas.append(storage.path_of(session_id, file_id))

    antes, despues = _abrir(rutas[0], registros[0].name), _abrir(rutas[1], registros[1].name)
    with antes, despues:
        if max(antes.page_count, despues.page_count) > MAXIMO_PAGINAS:
            raise ApiError(f'Se comparan documentos de hasta {MAXIMO_PAGINAS} páginas. '
                           'Parte el documento o compara sólo el tramo que te interese.', 413)

        parejas = comparacion.alinear([pagina.get_text() for pagina in antes],
                                      [pagina.get_text() for pagina in despues])
        parejas, imagenes = _mirar_paginas(antes, despues, parejas, con_imagenes)

    diferencias = comparacion.diferencias_de_texto(pdf_estructura.pdf_a_markdown(rutas[0]),
                                                   pdf_estructura.pdf_a_markdown(rutas[1]))
    cuentas = _cuentas(parejas)
    identicos = not diferencias and cuentas[comparacion.CAMBIADA] == 0 \
        and cuentas[comparacion.ANADIDA] == 0 and cuentas[comparacion.QUITADA] == 0

    texto = _informe(registros, parejas, cuentas, diferencias, imagenes, identicos)
    pdf = markdown_a_pdf.generar(texto, 'la comparación', saltos=False)

    nombres = [os.path.splitext(nombre_seguro(record.name))[0][:40] for record in registros]
    destino, salida = storage.reserve_output(session_id, f'{nombres[0]}-vs-{nombres[1]}.pdf')
    with open(destino, 'wb') as fichero:
        fichero.write(pdf)

    return jsonify({
        'files': [storage.commit_output(session_id, salida).to_json()],
        'comparacion': {
            'identicos': identicos,
            'iguales': cuentas[comparacion.IGUAL],
            'cambiadas': cuentas[comparacion.CAMBIADA],
            'anadidas': cuentas[comparacion.ANADIDA],
            'quitadas': cuentas[comparacion.QUITADA],
            'diferencias': len(diferencias),
        },
    }), 201


def _abrir(ruta: str, nombre: str):
    try:
        documento = fitz.open(ruta)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": {err}', 422) from err
    if documento.needs_pass:
        documento.close()
        raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422)
    return documento


def _mirar_paginas(antes, despues, parejas: list, con_imagenes: bool) -> tuple[list, dict]:
    """Compara los píxeles de cada pareja y compone las páginas del informe.

    Devuelve las parejas ya corregidas —una página con el mismo texto pero otro
    logotipo pasa a contar como cambiada— y, por pareja, la imagen que la enseña.
    """
    corregidas, imagenes = [], {}

    for indice, pareja in enumerate(parejas):
        zonas: list = []
        if pareja.a is not None and pareja.b is not None:
            imagen_a = _rasterizar(antes[pareja.a])
            imagen_b = _rasterizar(despues[pareja.b])
            zonas = comparacion.zonas_cambiadas(imagen_a, imagen_b, umbral=UMBRAL)
            # El texto puede ser el mismo y la página no serlo: una firma, un
            # sello o un logotipo cambiado no tocan una letra.
            estado = comparacion.CAMBIADA if zonas else pareja.estado
            pareja = comparacion.Pareja(estado, pareja.a, pareja.b)
            if con_imagenes and zonas and len(imagenes) < MAXIMO_IMAGENES:
                imagenes[indice] = _a_data_uri(_recuadrar(imagen_b, zonas))
        elif con_imagenes and len(imagenes) < MAXIMO_IMAGENES:
            documento, numero = (despues, pareja.b) if pareja.a is None else (antes, pareja.a)
            imagenes[indice] = _a_data_uri(_rasterizar(documento[numero]))

        corregidas.append(pareja)
    return corregidas, imagenes


def _rasterizar(pagina) -> Image.Image:
    limites.comprobar_lienzo(pagina.rect.width * PPP / 72, pagina.rect.height * PPP / 72,
                             'La página')
    pixmap = pagina.get_pixmap(dpi=PPP)
    return Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)


def _recuadrar(imagen: Image.Image, zonas: list) -> Image.Image:
    """La página con lo cambiado dentro de un recuadro, sin tapar lo que hay."""
    capa = Image.new('RGBA', imagen.size, (0, 0, 0, 0))
    lapiz = ImageDraw.Draw(capa)
    ancho, alto = imagen.size
    for x0, y0, x1, y1 in zonas:
        caja = (max(0, x0 - MARGEN), max(0, y0 - MARGEN),
                min(ancho - 1, x1 + MARGEN), min(alto - 1, y1 + MARGEN))
        lapiz.rectangle(caja, outline=(*TINTA, 255), width=2, fill=(*TINTA, 30))
    return Image.alpha_composite(imagen.convert('RGBA'), capa).convert('RGB')


def _a_data_uri(imagen: Image.Image) -> str:
    """La imagen incrustada en el propio Markdown.

    Es la única forma que tiene el informe de llevar las páginas dentro: el
    maquetador sólo admite `data:`, justo para que un documento no pueda pedirle
    archivos al servidor.
    """
    memoria = io.BytesIO()
    imagen.save(memoria, 'JPEG', quality=72, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(memoria.getvalue()).decode('ascii')


def _cuentas(parejas: list) -> dict:
    cuentas = {comparacion.IGUAL: 0, comparacion.CAMBIADA: 0,
               comparacion.ANADIDA: 0, comparacion.QUITADA: 0}
    for pareja in parejas:
        cuentas[pareja.estado] += 1
    return cuentas


def _informe(registros, parejas, cuentas, diferencias, imagenes, identicos) -> str:
    """El Markdown del informe, que "Markdown a PDF" convierte en el documento."""
    antes, despues = registros
    lineas = [
        '# Comparación de dos documentos',
        '',
        '| | Documento | Páginas |',
        '|---|---|---|',
        f'| Antes | {_plano(antes.name)} | {_paginas_de(parejas, "a")} |',
        f'| Después | {_plano(despues.name)} | {_paginas_de(parejas, "b")} |',
        '',
    ]

    if identicos:
        lineas += ['**Los dos documentos dicen lo mismo y se ven igual.** No hay ninguna '
                   'diferencia que enseñar.', '']
        return '\n'.join(lineas)

    lineas += [f'**{_resumen(cuentas)}**', '']

    if diferencias:
        lineas += ['## Lo que cambia en el texto', '']
        for diferencia in diferencias[:MAXIMO_DIFERENCIAS]:
            lineas.append(_linea_de_diferencia(diferencia))
        if len(diferencias) > MAXIMO_DIFERENCIAS:
            lineas.append(f'- …y {len(diferencias) - MAXIMO_DIFERENCIAS} cambios más.')
        lineas.append('')
    else:
        lineas += ['## Lo que cambia en el texto', '',
                   'Nada: el texto es el mismo en los dos documentos. Lo que cambia se ve, '
                   'pero no se lee.', '']

    paginas = [(indice, pareja) for indice, pareja in enumerate(parejas)
               if pareja.estado != comparacion.IGUAL]
    if paginas:
        lineas += ['## Página a página', '']
        for indice, pareja in paginas:
            lineas += ['<div style="page-break-after: always"></div>', '',
                       f'### {_titulo_de_pagina(pareja)}', '']
            imagen = imagenes.get(indice)
            if imagen:
                lineas += [f'![Página]({imagen})', '',
                           _pie_de_pagina(pareja), '']
            else:
                lineas += ['_No se incluye la imagen de esta página._', '']

        enseñadas = sum(1 for indice, _ in paginas if indice in imagenes)
        if enseñadas < len(paginas):
            lineas += [f'Se enseñan {enseñadas} páginas de las {len(paginas)} que cambian: '
                       'el resto se ha dejado fuera para que el informe no se dispare.', '']

    return '\n'.join(lineas)


def _paginas_de(parejas, lado: str) -> int:
    return sum(1 for pareja in parejas if getattr(pareja, lado) is not None)


def _resumen(cuentas: dict) -> str:
    partes = []
    for cuenta, singular, plural in (
            (cuentas[comparacion.IGUAL], 'página igual', 'páginas iguales'),
            (cuentas[comparacion.CAMBIADA], 'cambiada', 'cambiadas'),
            (cuentas[comparacion.ANADIDA], 'añadida', 'añadidas'),
            (cuentas[comparacion.QUITADA], 'quitada', 'quitadas')):
        if cuenta:
            partes.append(f'{cuenta} {singular if cuenta == 1 else plural}')
    if not partes:
        return 'No hay páginas que comparar.'
    if len(partes) == 1:
        return partes[0] + '.'
    return ', '.join(partes[:-1]) + f' y {partes[-1]}.'


def _linea_de_diferencia(diferencia) -> str:
    if diferencia.tipo == comparacion.ANADIDO:
        return f'- **Añadido:** {_plano(diferencia.despues)}'
    if diferencia.tipo == comparacion.QUITADO:
        return f'- **Quitado:** ~~{_plano(diferencia.antes)}~~'
    return (f'- **Cambiado:** ~~{_plano(diferencia.antes)}~~ → '
            f'{_plano(diferencia.despues)}')


def _titulo_de_pagina(pareja) -> str:
    if pareja.estado == comparacion.ANADIDA:
        return f'Página {pareja.b + 1} · añadida'
    if pareja.estado == comparacion.QUITADA:
        return f'Página {pareja.a + 1} · quitada'
    return f'Página {pareja.b + 1} · cambiada'


def _pie_de_pagina(pareja) -> str:
    if pareja.estado == comparacion.ANADIDA:
        return '_Esta página no estaba en el documento de antes._'
    if pareja.estado == comparacion.QUITADA:
        return '_Esta página estaba en el documento de antes y ya no está._'
    return (f'_Lo recuadrado es lo que cambia respecto a la página {pareja.a + 1} '
            'del documento de antes._')


def _plano(texto: str) -> str:
    """Texto de un documento metido dentro del informe, sin que lo maquete.

    Viene del Markdown del original, así que trae almohadillas, asteriscos y
    barras verticales que romperían la lista o la tabla del informe.
    """
    limpio = ' '.join(texto.split())
    for caracter in ('\\', '`', '*', '_', '[', ']', '#', '|', '~', '<', '>'):
        limpio = limpio.replace(caracter, '\\' + caracter)
    return limpio
