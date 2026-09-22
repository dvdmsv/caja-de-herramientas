"""Herramienta: guardar de una vez todo lo hecho en el visor.

El visor trabaja en el navegador y no molesta al servidor mientras se lee; sólo
al pulsar "Guardar" llega aquí la lista completa de cambios: subrayados,
palabras tachadas, textos escritos encima, campos de formulario rellenos, giros y
páginas eliminadas.

Sobre las coordenadas: llegan normalizadas de 0 a 1 con el origen arriba a la
izquierda y referidas a la página **sin girar**, la misma convención que usa
`firmar.py`. Es también el sistema de PyMuPDF, así que basta con multiplicar por
el tamaño de la página; y como son proporciones, dan igual el zoom y la
resolución con que se estuviera viendo.
"""
import os
import re

import fitz  # PyMuPDF
from flask import Blueprint, jsonify

import config
from api import current_session, params
from api.tipografia import (COLORES_TEXTO, CONTROLES, FAMILIAS, FUENTES, INTERLINEADO,
                            TAMANO_MAXIMO, TAMANO_MINIMO)
from api import limites
from errors import ApiError
from storage import storage, nombre_seguro

bp = Blueprint('visor', __name__, url_prefix='/api/tools')

# Plazo de este trabajo, que ocurre **dentro** del proceso y no como programa
# aparte: sin él, el único freno era el plazo de gunicorn, que mata al worker
# entero y con él las peticiones que llevara en sus otros hilos.
PLAZO_EN_PROCESO = config.entorno_entero('RASTER_TIMEOUT_SECONDS', 180)

GIROS = {0, 90, 180, 270}

# Colores de subrayado que ofrece la interfaz. Se validan aquí para no dejar que
# el cliente meta lo que quiera en el archivo.
COLORES_SUBRAYADO = {
    'amarillo': (1.0, 0.87, 0.29),
    'verde': (0.55, 0.89, 0.55),
    'azul': (0.53, 0.77, 0.98),
    'rosa': (0.98, 0.65, 0.80),
}

COLORES_TACHADO = {'negro': (0, 0, 0), 'blanco': (1, 1, 1)}

MAXIMO_TEXTOS = 500
MAXIMO_CARACTERES = 2000

# Campos rellenables del propio formulario.
MAXIMO_CAMPOS = 500
MAXIMO_NOMBRE = 300

# Un tope generoso, pero que evita que una petición absurda tenga al servidor
# dibujando rectángulos un cuarto de hora.
#
# Va atado al `MAXIMO_ZONAS` de `anonimizar_pdf.py`, que es quien puede llenar
# esto de golpe con «buscar y tachar todo»: si aquí cupieran menos, marcar
# funcionaría y guardar fallaría con un 413 que no se entendería. Hay un test que
# cruza los dos. Al mover uno, mueve el otro.
MAXIMO_MARCAS = 50_000


@bp.post('/visor/guardar')
@limites.con_plazo(PLAZO_EN_PROCESO, 'El guardado')
def guardar():
    session_id = current_session()
    datos = params.cuerpo()
    file_ids = params.ids(datos, minimo=1, mensaje='No hay ningún documento abierto.')

    record = storage.record_of(session_id, file_ids[0])
    if record.ext != '.pdf':
        raise ApiError(f'"{record.name}" no es un PDF.', 400)
    origen = storage.path_of(session_id, file_ids[0])

    try:
        documento = fitz.open(origen)
    except Exception as err:
        raise ApiError(f'No se ha podido abrir el PDF: {err}', 422) from err

    with documento:
        if documento.needs_pass:
            raise ApiError('El PDF está protegido con contraseña. Quítasela primero.', 422)

        total = documento.page_count
        subrayados = _leer_marcas(datos.get('subrayados'), total, COLORES_SUBRAYADO, 'subrayado')
        tachados = _leer_marcas(datos.get('tachados'), total, COLORES_TACHADO, 'tachado')
        textos = _leer_textos(datos.get('textos'), total)
        campos = _leer_campos(datos.get('campos'))
        paginas = _leer_paginas(datos.get('paginas'), total)

        if not (subrayados or tachados or textos or campos
                or _hay_cambios_de_paginas(paginas, total)):
            raise ApiError('No hay ningún cambio que guardar.', 400)

        # Primero las marcas, sobre la numeración original: si se borraran antes
        # las páginas, los números ya no señalarían a lo mismo.
        _marcar(documento, subrayados, tachados)

        # Y los textos después de las marcas, no antes: aplicar un tachado borra
        # todo lo que haya en su rectángulo, y se llevaría por delante lo que se
        # acabara de escribir encima del mismo hueco.
        _escribir(documento, textos)

        # Y los campos del formulario, todavía con todas las páginas puestas.
        _rellenar(documento, campos)

        # Y después la reordenación, el borrado y los giros, como en
        # "Organizar PDF": `select` hace las tres cosas de una pasada.
        #
        # Sólo si hacen falta: `select` reescribe el documento entero y, de
        # paso, le quita al catálogo la clave `/AcroForm`, con lo que un
        # formulario recién rellenado dejaría de ser un formulario. Al rellenar
        # sin tocar páginas, que es lo corriente, no hay por qué pasar por ahí.
        if _hay_cambios_de_paginas(paginas, total):
            formulario = documento.xref_get_key(documento.pdf_catalog(), 'AcroForm')
            documento.select([numero - 1 for numero, _ in paginas])
            for indice, (_, giro) in enumerate(paginas):
                if giro:
                    pagina = documento[indice]
                    pagina.set_rotation((pagina.rotation + giro) % 360)
            _rehacer_formulario(documento, formulario)

        base = os.path.splitext(nombre_seguro(record.name))[0]
        destino, salida = storage.reserve_output(session_id, f'{base}-editado.pdf')
        documento.save(destino, deflate=True, garbage=3)

    return jsonify({'files': [storage.commit_output(session_id, salida).to_json()]}), 201


def _marcar(documento, subrayados: list, tachados: list) -> None:
    """Aplica subrayados y tachados, cada uno en su página."""
    con_tachados = set()

    for numero, color, rects in subrayados:
        pagina = documento[numero - 1]
        zonas = _rectangulos(pagina, rects)
        if not zonas:
            continue
        # Todas las líneas de un mismo subrayado van en una sola anotación: en
        # un lector de PDF se ve como un comentario, no como uno por renglón.
        anotacion = pagina.add_highlight_annot(zonas)
        anotacion.set_colors(stroke=color)
        anotacion.update()

    for numero, color, rects in tachados:
        pagina = documento[numero - 1]
        for rect in _rectangulos(pagina, rects):
            # `fill` es lo que queda a la vista donde estaba el texto.
            pagina.add_redact_annot(rect, fill=color)
        con_tachados.add(numero)

    # Esto es lo que de verdad borra el texto del archivo: sin aplicarlas, las
    # marcas de tachado serían un rectángulo encima y el texto seguiría ahí,
    # copiable y buscable.
    for numero in con_tachados:
        documento[numero - 1].apply_redactions()


def _escribir(documento, textos: list) -> None:
    """Escribe los textos sueltos en el contenido de cada página.

    Van al contenido y no como anotación a propósito: así se ven igual en
    cualquier lector, se imprimen siempre y nadie los puede mover después.

    El punto que llega es el **inicio de la línea base** de la primera línea,
    que es justo lo que sitúa `insert_text`. Es la única referencia que el
    navegador y PyMuPDF colocan exactamente igual: el alto de una caja de texto
    depende de métricas que no coinciden entre Arial y Helvetica.
    """
    for numero, texto in textos:
        pagina = documento[numero - 1]
        caja = pagina.rect
        # Como con las marcas: lo que se ve puede venir girado en el archivo,
        # pero se escribe en el espacio sin girar.
        punto = fitz.Point(caja.x0 + texto['x'] * caja.width,
                           caja.y0 + texto['y'] * caja.height) * pagina.derotation_matrix
        # Y el ángulo de las letras es la suma del giro del archivo y del que le
        # haya dado el usuario en el visor, que se aplica luego con
        # `set_rotation`. Comprobado con las dieciséis combinaciones de ambos:
        # con el signo cambiado el texto sale derecho pero corrido su propio
        # ancho, que es fácil de no ver.
        giro = (pagina.rotation + texto['rotacion']) % 360

        # Las líneas se le dejan a PyMuPDF, que con `lineheight` las separa
        # exactamente el mismo múltiplo del cuerpo que el `line-height` del
        # visor y las baja en el sentido que toca en cada giro. Comprobado en
        # los cuatro.
        pagina.insert_text(punto, texto['texto'].split('\n'),
                           fontname=FUENTES[(texto['fuente'], texto['negrita'],
                                             texto['cursiva'])],
                           fontsize=texto['tamano'], lineheight=INTERLINEADO,
                           color=texto['color'], rotate=giro)


def _rellenar(documento, campos: dict) -> None:
    """Escribe en los campos que el propio formulario ya traía.

    El PDF sigue siendo un formulario después: los valores quedan dentro de sus
    campos y quien lo reciba puede corregir algo si hace falta.
    """
    if not campos:
        return

    # Los grupos de opciones se tratan enteros, y no recuadro a recuadro: al
    # marcar uno hay que apagar los demás del grupo. PyMuPDF no lo hace —tiene un
    # «TODO» diciéndolo en su propio código—, así que dos opciones del mismo
    # grupo se quedarían marcadas a la vez.
    grupos = {}
    for pagina in documento:
        for widget in pagina.widgets():
            grupos.setdefault(widget.field_name, []).append((pagina, widget.xref))

    alguno = False
    for nombre, valor in campos.items():
        for pagina, xref in grupos.get(nombre, []):
            widget = _widget_de(pagina, xref)
            if widget is None:
                continue
            alguno = True
            if widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
                # Sólo la elegida se enciende; el resto del grupo, apagadas.
                widget.field_value = (widget.on_state() == valor)
            elif widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                widget.field_value = bool(valor) and valor != 'Off'
            else:
                widget.field_value = valor
            widget.update()

    if not alguno:
        raise ApiError('El documento no tiene los campos que se han rellenado.', 409)


def _rehacer_formulario(documento, antes: tuple) -> None:
    """Devuelve el `/AcroForm` que `select` le quita al catálogo.

    Sin esto, quitar una página de un formulario relleno lo convierte en un PDF
    corriente: los recuadros siguen dibujados, pero ningún lector los reconoce
    ya como campos.

    La lista de campos se rehace con los que han sobrevivido —`select` renumera
    los objetos y las referencias viejas ya no valen—, y el resto del diccionario
    (la tipografía por defecto y sus recursos) se conserva tal cual venía.
    """
    tipo, valor = antes
    if tipo != 'dict':
        return

    raices = []
    for pagina in documento:
        for widget in pagina.widgets():
            tipo_padre, padre = documento.xref_get_key(widget.xref, 'Parent')
            # Las opciones de un grupo cuelgan de un campo padre; las demás son
            # el campo en sí.
            raiz = int(padre.split()[0]) if tipo_padre == 'xref' else widget.xref
            if raiz not in raices:
                raices.append(raiz)
    if not raices:
        return

    campos = f'/Fields[{" ".join(f"{x} 0 R" for x in raices)}]'
    if '/Fields' in valor:
        nuevo = re.sub(r'/Fields\s*\[[^\]]*\]', campos, valor, count=1)
    else:
        nuevo = valor.rstrip()[:-2] + campos + '>>'
    documento.xref_set_key(documento.pdf_catalog(), 'AcroForm', nuevo)


def _widget_de(pagina, xref: int):
    """El widget vivo de una página, por su xref.

    Hay que volver a pedirlo y no guardarse el objeto: escribir en un campo
    reescribe la página, y un widget de antes ya no vale.
    """
    for widget in pagina.widgets():
        if widget.xref == xref:
            return widget
    return None


def _rectangulos(pagina, rects: list) -> list:
    """Pasa las proporciones a rectángulos de la página.

    Las proporciones vienen referidas a lo que el usuario ve, y PyMuPDF mide
    igual —desde la esquina superior izquierda—, así que es una multiplicación
    por el tamaño de la página.

    El único caso con truco es una página que ya venía girada en el archivo: lo
    que se ve está girado, pero las anotaciones se guardan en el espacio sin
    girar, así que hay que llevar cada rectángulo con `derotation_matrix`.
    Comprobado con los cuatro giros: sin esto, en un documento con `/Rotate 180`
    la marca aparece en la esquina contraria.
    """
    caja = pagina.rect
    resultado = []
    for x0, y0, x1, y1 in rects:
        rect = fitz.Rect(caja.x0 + x0 * caja.width, caja.y0 + y0 * caja.height,
                         caja.x0 + x1 * caja.width, caja.y0 + y1 * caja.height)
        if pagina.rotation:
            rect = rect * pagina.derotation_matrix
        rect.normalize()
        if not rect.is_empty:
            resultado.append(rect)
    return resultado


def _leer_marcas(valor, total: int, colores: dict, etiqueta: str) -> list:
    """Valida la lista de marcas y la deja lista para usar."""
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ApiError(f'La lista de {etiqueta}s no es válida.', 400)

    marcas, cuantas = [], 0
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError(f'La lista de {etiqueta}s no es válida.', 400)

        numero = entrada.get('pagina')
        if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= total:
            raise ApiError(f'Hay un {etiqueta} en la página {numero}, que no existe.', 400)

        nombre_color = entrada.get('color')
        if nombre_color not in colores:
            admitidos = ', '.join(sorted(colores))
            raise ApiError(f'Color de {etiqueta} no válido. Admitidos: {admitidos}.', 400)

        rects = entrada.get('rects')
        if not isinstance(rects, list) or not rects:
            raise ApiError(f'Hay un {etiqueta} sin zona marcada.', 400)

        limpios = []
        for rect in rects:
            if (not isinstance(rect, list) or len(rect) != 4
                    or not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                               and 0 <= v <= 1 for v in rect)):
                raise ApiError(f'Hay un {etiqueta} con coordenadas fuera de la página.', 400)
            limpios.append([float(v) for v in rect])

        cuantas += len(limpios)
        if cuantas > MAXIMO_MARCAS:
            raise ApiError(f'Hay demasiadas marcas: el máximo son {MAXIMO_MARCAS}.', 413)
        marcas.append((numero, colores[nombre_color], limpios))
    return marcas


def _leer_textos(valor, total: int) -> list:
    """Valida los textos escritos encima y los deja listos para escribir."""
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ApiError('La lista de textos no es válida.', 400)
    if len(valor) > MAXIMO_TEXTOS:
        raise ApiError(f'Hay demasiados textos: el máximo son {MAXIMO_TEXTOS}.', 413)

    textos = []
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError('La lista de textos no es válida.', 400)

        numero = entrada.get('pagina')
        if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= total:
            raise ApiError(f'Hay un texto en la página {numero}, que no existe.', 400)

        contenido = entrada.get('texto')
        if not isinstance(contenido, str):
            raise ApiError('Hay un texto sin contenido.', 400)
        # Los caracteres de control no se pueden escribir y algunos rompen el
        # archivo; el salto de línea sí vale, que es como se hacen los párrafos.
        contenido = CONTROLES.sub('', contenido.replace('\r\n', '\n').replace('\r', '\n'))
        if not contenido.strip():
            continue
        if len(contenido) > MAXIMO_CARACTERES:
            raise ApiError(f'Hay un texto de más de {MAXIMO_CARACTERES} caracteres.', 413)

        familia = entrada.get('fuente')
        if familia not in FAMILIAS:
            raise ApiError(f'Tipo de letra no válido. Admitidos: {", ".join(sorted(FAMILIAS))}.', 400)

        nombre_color = entrada.get('color')
        if nombre_color not in COLORES_TEXTO:
            admitidos = ', '.join(sorted(COLORES_TEXTO))
            raise ApiError(f'Color de texto no válido. Admitidos: {admitidos}.', 400)

        tamano = entrada.get('tamano')
        if (not isinstance(tamano, (int, float)) or isinstance(tamano, bool)
                or not TAMANO_MINIMO <= tamano <= TAMANO_MAXIMO):
            raise ApiError(
                f'El tamaño de letra debe estar entre {TAMANO_MINIMO} y {TAMANO_MAXIMO}.', 400)

        giro = entrada.get('rotacion', 0)
        if giro not in GIROS:
            raise ApiError('El giro de un texto sólo puede ser 0, 90, 180 o 270 grados.', 400)

        x, y = entrada.get('x'), entrada.get('y')
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1
                   for v in (x, y)):
            raise ApiError('Hay un texto colocado fuera de la página.', 400)

        textos.append((numero, {
            'x': float(x), 'y': float(y), 'rotacion': giro, 'texto': contenido,
            'fuente': familia, 'tamano': float(tamano), 'color': COLORES_TEXTO[nombre_color],
            'negrita': bool(entrada.get('negrita')), 'cursiva': bool(entrada.get('cursiva')),
        }))
    return textos


def _leer_campos(valor) -> dict:
    """Valida los campos de formulario que se han rellenado."""
    if valor is None:
        return {}
    if not isinstance(valor, list):
        raise ApiError('La lista de campos no es válida.', 400)
    if len(valor) > MAXIMO_CAMPOS:
        raise ApiError(f'Hay demasiados campos: el máximo son {MAXIMO_CAMPOS}.', 413)

    campos = {}
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError('La lista de campos no es válida.', 400)

        nombre = entrada.get('nombre')
        if not isinstance(nombre, str) or not nombre or len(nombre) > MAXIMO_NOMBRE:
            raise ApiError('Hay un campo sin nombre o con un nombre imposible.', 400)

        contenido = entrada.get('valor')
        if not isinstance(contenido, str):
            raise ApiError(f'El valor del campo "{nombre}" no es un texto.', 400)
        contenido = CONTROLES.sub('', contenido.replace('\r\n', '\n').replace('\r', '\n'))
        if len(contenido) > MAXIMO_CARACTERES:
            raise ApiError(f'El campo "{nombre}" pasa de {MAXIMO_CARACTERES} caracteres.', 413)

        campos[nombre] = contenido
    return campos


def _leer_paginas(valor, total: int) -> list:
    """Lista de páginas del documento final; si no viene, se dejan como están."""
    if valor is None:
        return [(numero, 0) for numero in range(1, total + 1)]
    if not isinstance(valor, list):
        raise ApiError('La lista de páginas no es válida.', 400)
    if not valor:
        raise ApiError('No queda ninguna página en el documento.', 400)

    paginas = []
    for entrada in valor:
        if not isinstance(entrada, dict):
            raise ApiError('La lista de páginas no es válida.', 400)
        numero = entrada.get('numero')
        giro = entrada.get('rotacion', 0)
        if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= total:
            raise ApiError(f'El PDF tiene {total} páginas y se ha pedido la {numero}.', 400)
        if giro not in GIROS:
            raise ApiError('Las páginas sólo pueden girar 90, 180 o 270 grados.', 400)
        paginas.append((numero, giro))
    return paginas


def _hay_cambios_de_paginas(paginas: list, total: int) -> bool:
    return len(paginas) != total or any(
        numero != indice + 1 or giro for indice, (numero, giro) in enumerate(paginas))
