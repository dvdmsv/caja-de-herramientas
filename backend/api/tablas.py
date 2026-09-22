"""Llevar las tablas de un PDF a una hoja de cálculo.

Aparte de la herramienta, como `comparacion.py`: aquí no hay Flask ni sesión, y
casi nada de PyMuPDF. Lo que sí hay son las dos decisiones que deciden si el
archivo que sale sirve para trabajar o hay que repasarlo entero a mano.

**Qué es una tabla y qué es un recuadro** no se decide aquí: eso es
`pdf_estructura.merece_ser_tabla`, compartido con «Documento a Markdown». Una
tabla inventada es peor que una tabla perdida, y el criterio tiene que ser el
mismo en las dos herramientas.

**Qué es un número y qué es texto** sí se decide aquí, y es la parte delicada. Un
`.xlsx` donde los importes son texto no suma, así que no sirve para lo que se
pide («facturas, balances»). Pero convertir a lo bruto estropea datos: un código
postal «08001» se convertiría en 8001 y un DNI perdería su forma. Por eso sólo se
convierte lo que **no puede ser otra cosa que un importe**: hace falta una coma
decimal o puntos de millar bien puestos. Un número a secas se queda como texto.
"""
import csv
import io
import re

# Un importe escrito a la española: puntos de millar en grupos de tres y coma
# decimal. Los paréntesis son el negativo de toda la vida en un balance.
#
# Un número a secas —«08001», «2026»— **no** entra: es tan probable que sea un
# código postal o un año como una cantidad. Sólo entra si trae coma decimal,
# puntos de millar o un símbolo de moneda, que es lo que lo hace inequívoco.
_IMPORTE = re.compile(r"""
    ^\s*
    (?P<abre>\()?                       # (1.234,56) es -1234,56
    \s*(?P<signo>[-+])?\s*
    (?P<moneda>[€$£])?\s*
    (?P<numero>
        \d{1,3}(?:\.\d{3})+(?:,\d+)?    # con millares: 1.234 · 1.234,56
      | \d+,\d+                         # sin millares pero con decimales: 12,50
      | \d+                              # a secas: sólo vale con moneda al lado
    )
    \s*(?P<sufijo>[€$£])?
    \s*(?P<cierra>\))?
    \s*$
""", re.VERBOSE)

# Lo que lleva un porcentaje se queda como texto. Un «45 %» convertido a 45
# pierde el tanto por ciento, y a 0,45 deja de parecerse a lo que ponía el PDF:
# las dos lecturas son defendibles, y por eso ninguna puede hacerse en silencio.
_PORCENTAJE = re.compile(r'%')

# Lo que Excel no admite en el nombre de una hoja, más su tope de 31 caracteres.
_PROHIBIDOS_EN_HOJA = re.compile(r'[\[\]:*?/\\]')
MAXIMO_NOMBRE_HOJA = 31


def a_numero(texto: str):
    """El valor de una celda si es un importe, o `None` si hay que dejarla como texto.

    Deliberadamente estrecho: «08001», «2026», «12345678» y «45 %» devuelven
    `None`, porque son tan probables como código postal, año, referencia o
    porcentaje que como cantidad, y estropearlos no se nota hasta que alguien
    mira la hoja y ya ha trabajado sobre ella.
    """
    if not texto or _PORCENTAJE.search(texto):
        return None
    encontrado = _IMPORTE.match(texto)
    if not encontrado:
        return None
    # Un número pelado sólo es un importe si lleva la moneda al lado.
    suelto = encontrado.group('numero')
    if '.' not in suelto and ',' not in suelto \
            and not (encontrado.group('moneda') or encontrado.group('sufijo')):
        return None
    # Un paréntesis suelto no es un negativo, es un error de lectura.
    if bool(encontrado.group('abre')) != bool(encontrado.group('cierra')):
        return None

    valor = float(encontrado.group('numero').replace('.', '').replace(',', '.'))
    if encontrado.group('abre') or encontrado.group('signo') == '-':
        valor = -valor
    return valor


def a_csv(filas: list[list[str]]) -> bytes:
    """Una tabla como CSV, pensado para abrirlo de doble clic.

    Dos decisiones que no son las de la norma y son las que hacen que funcione:
    el separador es `;` y el archivo lleva BOM. Un Excel en español espera
    exactamente eso; con comas y sin BOM, la hoja sale en una sola columna y con
    los acentos rotos, que es la forma más segura de que nadie vuelva a usar
    esto.
    """
    buzon = io.StringIO()
    escritor = csv.writer(buzon, delimiter=';', quoting=csv.QUOTE_MINIMAL,
                          lineterminator='\r\n')
    escritor.writerows([[_limpiar(celda) for celda in fila] for fila in filas])
    return buzon.getvalue().encode('utf-8-sig')


def a_xlsx(tablas: list, destino: str) -> None:
    """Todas las tablas en un libro, una hoja por tabla.

    `tablas` son pares `(nombre, filas)`. Se escribe con `write_only`, que no
    guarda el libro entero en memoria: un PDF de doscientas páginas con una tabla
    en cada una cabe igual.
    """
    from openpyxl import Workbook

    libro = Workbook(write_only=True)
    usados: set[str] = set()
    for nombre, filas in tablas:
        hoja = libro.create_sheet(_nombre_de_hoja(nombre, usados))
        for fila in filas:
            hoja.append([_valor(celda) for celda in fila])
    libro.save(destino)


def _valor(celda: str):
    """La celda como número si lo es sin lugar a dudas, y si no como texto."""
    texto = _limpiar(celda)
    numero = a_numero(texto)
    return texto if numero is None else numero


def _limpiar(celda) -> str:
    """Una celda de PyMuPDF puede venir a `None`, y con saltos de línea dentro.

    Los saltos se sustituyen por un espacio: dentro de una celda son de la
    maquetación del PDF, no del dato, y en una hoja de cálculo sólo estorban.
    """
    if celda is None:
        return ''
    return ' '.join(str(celda).split())


def _nombre_de_hoja(nombre: str, usados: set) -> str:
    """Un nombre que Excel acepte y que no choque con otro ya puesto."""
    limpio = _PROHIBIDOS_EN_HOJA.sub(' ', nombre).strip() or 'Tabla'
    limpio = limpio[:MAXIMO_NOMBRE_HOJA]
    if limpio not in usados:
        usados.add(limpio)
        return limpio
    for sufijo in range(2, 1000):
        marca = f' ({sufijo})'
        candidato = limpio[:MAXIMO_NOMBRE_HOJA - len(marca)] + marca
        if candidato not in usados:
            usados.add(candidato)
            return candidato
    raise ValueError('demasiadas hojas con el mismo nombre')
