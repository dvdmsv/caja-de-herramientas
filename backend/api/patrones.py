"""Encontrar datos personales dentro de un texto para poder tacharlos.

Está aparte de la herramienta a propósito, como `comparacion.py`: aquí no hay
archivos, ni sesión, ni Flask, ni PyMuPDF. Entra texto —o la lista de palabras
con su caja que devuelve `page.get_text('words')`, que son tuplas normales— y
sale dónde está cada cosa. Así se puede probar entero con cadenas escritas a
mano, que es justo lo que hace falta: lo que se equivoque aquí acaba en un
documento con un DNI sin tachar o con una fecha tachada por parecer un teléfono.

**Buscar no basta: hay que validar.** Un número de factura de ocho cifras se
parece muchísimo a un DNI, y un albarán de veinte dígitos, a una tarjeta. Por eso
cada patrón que tiene forma de comprobarse la trae: la letra de control del
DNI y del NIE, el módulo 97 del IBAN y el dígito de Luhn de la tarjeta. Lo que no
pasa su comprobación no es una coincidencia, y se descarta antes de devolverla.

El teléfono y el correo no tienen nada que comprobar, así que son los dos únicos
que pueden dar un falso positivo. Se acota lo que se puede —un teléfono español
empieza por 6, 7, 8 o 9 y tiene nueve cifras— y el resto lo arregla que la
herramienta enseñe cuántas ha encontrado **antes** de tocar el archivo.
"""
import re

# Cuánto puede medir la expresión que escribe el usuario. No es una cifra
# mágica: por encima de esto nadie está escribiendo un patrón, está pegando algo.
MAXIMO_PATRON = 200

LETRAS_CONTROL = 'TRWAGMYFPDXBNJZSQVHLCKE'

# La primera letra de un NIE vale por un dígito a la hora de calcular la de
# control: es la regla de la Policía, no una convención de este código.
INICIALES_NIE = {'X': '0', 'Y': '1', 'Z': '2'}

# Las letras con las que empieza un CIF, por tipo de entidad, y el alfabeto con
# el que se escribe su control cuando es una letra y no una cifra.
INICIALES_CIF = 'ABCDEFGHJNPQRSUVW'
LETRAS_CIF = 'JABCDEFGHI'
# Estas entidades llevan el control **siempre** en letra, y éstas siempre en
# cifra. El resto admite las dos, así que aceptar ambas no es ser laxo: es la
# norma.
CIF_SOLO_LETRA = 'PQRSNW'
CIF_SOLO_DIGITO = 'ABEH'

# Las matrículas modernas no llevan vocales ni Ñ ni Q, para que ninguna
# combinación forme una palabra. Eso es lo que las hace reconocibles sin dígito
# de control.
CONSONANTES_MATRICULA = 'BCDFGHJKLMNPRSTVWXYZ'

# Códigos de provincia de las matrículas antiguas. Va la lista entera y no un
# `[A-Z]{1,2}` porque sin ella el patrón casaría con cualquier «AB-1234-CD» que
# fuese una referencia de pedido.
PROVINCIAS_MATRICULA = (
    'VI|AB|A|AL|AV|BA|PM|IB|B|BU|CC|CA|CS|CE|CR|CO|C|CU|GI|GE|GR|GU|SS|H|HU|J|'
    'LE|L|LO|LU|M|MA|ML|MU|NA|OR|OU|O|P|PO|SA|TF|S|SG|SE|SO|T|GC|TE|TO|V|VA|'
    'ZA|Z')


def _solo_digitos(texto: str) -> str:
    return ''.join(c for c in texto if c.isdigit())


def _valida_dni(texto: str) -> bool:
    digitos = _solo_digitos(texto)
    letra = texto.strip()[-1].upper()
    return len(digitos) == 8 and LETRAS_CONTROL[int(digitos) % 23] == letra


def _valida_nie(texto: str) -> bool:
    limpio = re.sub(r'[^0-9A-Za-z]', '', texto).upper()
    if len(limpio) != 9 or limpio[0] not in INICIALES_NIE:
        return False
    numero = INICIALES_NIE[limpio[0]] + limpio[1:8]
    return numero.isdigit() and LETRAS_CONTROL[int(numero) % 23] == limpio[8]


def _valida_cif(texto: str) -> bool:
    """Dígito de control del CIF de una empresa.

    Comprobado contra CIF públicos de los tres tipos —control en cifra (A…),
    control en letra (Q…, G…)—: `A58818501`, `Q2826004J`, `G28029643` y
    `A08663619` pasan, y alterarles el control los tumba.
    """
    limpio = re.sub(r'[^0-9A-Za-z]', '', texto).upper()
    if len(limpio) != 9:
        return False
    inicial, digitos, control = limpio[0], limpio[1:8], limpio[8]
    if inicial not in INICIALES_CIF or not digitos.isdigit():
        return False

    pares = sum(int(d) for d in digitos[1::2])
    impares = sum(sum(divmod(int(d) * 2, 10)) for d in digitos[0::2])
    unidad = (10 - (pares + impares) % 10) % 10

    if inicial in CIF_SOLO_LETRA:
        return control == LETRAS_CIF[unidad]
    if inicial in CIF_SOLO_DIGITO:
        return control == str(unidad)
    return control in (str(unidad), LETRAS_CIF[unidad])


def _valida_iban(texto: str) -> bool:
    """Módulo 97 sobre el IBAN reordenado, tal como manda la norma ISO 13616."""
    limpio = re.sub(r'[^0-9A-Za-z]', '', texto).upper()
    if not 15 <= len(limpio) <= 34:
        return False
    movido = limpio[4:] + limpio[:4]
    try:
        numero = ''.join(c if c.isdigit() else str(ord(c) - 55) for c in movido)
        return int(numero) % 97 == 1
    except ValueError:
        return False


def _valida_tarjeta(texto: str) -> bool:
    """Dígito de Luhn. Lo cumple toda tarjeta y casi ningún número inventado."""
    digitos = _solo_digitos(texto)
    if not 13 <= len(digitos) <= 19:
        return False
    total, doblar = 0, False
    for c in reversed(digitos):
        valor = int(c)
        if doblar:
            valor *= 2
            if valor > 9:
                valor -= 9
        total += valor
        doblar = not doblar
    return total % 10 == 0


# Los patrones que ofrece la herramienta, en el orden en que se buscan. El orden
# importa: un IBAN lleva dentro grupos de dígitos que también valdrían como
# teléfono, así que los largos y comprobables van primero y los solapes se
# resuelven a su favor (ver `coincidencias`).
PATRONES = {
    'iban': {
        'etiqueta': 'Cuentas bancarias (IBAN)',
        'expresion': re.compile(r'(?<![0-9A-Za-z])[A-Z]{2}[ -]?\d{2}(?:[ -]?[0-9A-Z]{4}){2,7}'
                                r'(?:[ -]?[0-9A-Z]{1,4})?(?![0-9A-Za-z])'),
        'valida': _valida_iban,
    },
    'tarjeta': {
        'etiqueta': 'Tarjetas de crédito',
        'expresion': re.compile(r'(?<!\d)\d{4}(?:[ -]?\d{4}){2,4}(?!\d)'),
        'valida': _valida_tarjeta,
    },
    'nie': {
        'etiqueta': 'NIE',
        'expresion': re.compile(r'(?<![0-9A-Za-z])[XYZ][ -]?\d{7}[ -]?[A-Z](?![0-9A-Za-z])',
                                re.IGNORECASE),
        'valida': _valida_nie,
    },
    'dni': {
        'etiqueta': 'DNI',
        'expresion': re.compile(r'(?<![0-9A-Za-z])\d{8}[ -]?[A-Z](?![0-9A-Za-z])', re.IGNORECASE),
        'valida': _valida_dni,
    },
    'correo': {
        'etiqueta': 'Correos electrónicos',
        'expresion': re.compile(r'(?<![0-9A-Za-z._%+-])[0-9A-Za-z._%+-]+@[0-9A-Za-z.-]+'
                                r'\.[A-Za-z]{2,}(?![0-9A-Za-z.-])'),
        'valida': None,
    },
    'cif': {
        'etiqueta': 'CIF de empresa',
        'expresion': re.compile(rf'(?<![0-9A-Za-z])[{INICIALES_CIF}][ -]?\d{{7}}[ -]?[0-9A-J]'
                                r'(?![0-9A-Za-z])', re.IGNORECASE),
        'valida': _valida_cif,
    },
    'matricula': {
        'etiqueta': 'Matrículas',
        # La moderna no tiene dígito de control, pero su juego de consonantes ya
        # es una comprobación: ninguna lleva vocales, ni Ñ, ni Q. La antigua se
        # ata a la lista de códigos de provincia por lo mismo.
        'expresion': re.compile(
            rf'(?<![0-9A-Za-z])(?:'
            rf'\d{{4}}[ -]?[{CONSONANTES_MATRICULA}]{{3}}'
            rf'|(?:{PROVINCIAS_MATRICULA})[ -]?\d{{4}}[ -]?[A-Z]{{1,2}}'
            rf')(?![0-9A-Za-z])'),
        'valida': None,
    },
    'telefono': {
        'etiqueta': 'Teléfonos',
        # Nueve cifras que empiezan por 6, 7, 8 o 9, con o sin prefijo y
        # agrupadas como a cada uno le dé la gana (3-3-3, 3-2-2-2, seguidas).
        'expresion': re.compile(r'(?<![\d+])(?:\+34[ -]?)?[6-9](?:[ -]?\d){8}(?!\d)'),
        'valida': None,
    },
    'codigo_postal': {
        'etiqueta': 'Códigos postales',
        # Las dos primeras cifras son la provincia, de 01 a 52. Es toda la
        # comprobación que admite, así que es **el patrón más ruidoso de la
        # lista**: cinco cifras seguidas son muchas cosas. Por eso la pantalla lo
        # deja desmarcado de serie y lo dice.
        'expresion': re.compile(r'(?<!\d)(?:0[1-9]|[1-4]\d|5[0-2])\d{3}(?!\d)'),
        'valida': None,
    },
}

#: El tipo que se le pone a lo que encuentra la expresión del usuario.
PROPIO = 'propio'


def compilar(patron: str):
    """Compila la expresión que ha escrito el usuario.

    Lanza `ValueError` con un mensaje que se le puede enseñar: quien traduce eso
    a una respuesta HTTP es la herramienta, que es la que sabe de códigos.

    Lo que **no** se hace aquí es intentar demostrar que la expresión no se va a
    atascar: eso no se puede, y fingir que sí sería peor. El freno de verdad ya
    existe y está una capa más abajo —el `RLIMIT_CPU` que `post_fork` le pone a
    cada trabajo en `gunicorn.trabajos.conf.py`—, que mata el proceso de esa
    petición y sólo el de esa petición. Encima va el plazo de la herramienta.
    """
    if len(patron) > MAXIMO_PATRON:
        raise ValueError(f'La expresión no puede pasar de {MAXIMO_PATRON} caracteres.')
    try:
        return re.compile(patron)
    except re.error as err:
        raise ValueError(f'La expresión no es válida: {err}.') from err


def coincidencias(texto: str, tipos, propio=None) -> list[tuple[int, int, str]]:
    """Dónde está cada dato dentro de `texto`, sin solapes.

    Devuelve tríos `(inicio, fin, tipo)` ordenados por posición. Cuando dos
    patrones pisan el mismo trozo —los cuatro grupos de un IBAN también valen
    como teléfono— gana **la coincidencia más larga**, y a igualdad, la del
    patrón que va antes en `PATRONES`. Sin esto se tacharía dos veces lo mismo y,
    peor, el recuento que se le enseña al usuario mentiría.
    """
    encontradas = []
    for orden, clave in enumerate(PATRONES):
        if clave not in tipos:
            continue
        patron = PATRONES[clave]
        for hallazgo in patron['expresion'].finditer(texto):
            if patron['valida'] and not patron['valida'](hallazgo.group()):
                continue
            encontradas.append((hallazgo.start(), hallazgo.end(), clave, orden))

    if propio is not None:
        for hallazgo in propio.finditer(texto):
            # Una expresión que casa con la cadena vacía encontraría algo entre
            # cada dos letras y no tacharía nada: se descarta aquí y no al
            # compilar, porque `^$` es perfectamente válida y puede ser justo lo
            # que alguien quería probar.
            if hallazgo.end() > hallazgo.start():
                encontradas.append((hallazgo.start(), hallazgo.end(), PROPIO, len(PATRONES)))

    # Más larga primero, y a igual longitud la del patrón más arriba en la lista.
    encontradas.sort(key=lambda c: (-(c[1] - c[0]), c[3], c[0]))
    elegidas: list[tuple[int, int, str]] = []
    for inicio, fin, clave, _ in encontradas:
        if any(inicio < otro_fin and otro_inicio < fin
               for otro_inicio, otro_fin, _ in elegidas):
            continue
        elegidas.append((inicio, fin, clave))

    elegidas.sort()
    return elegidas


def zonas_de_palabras(palabras, tipos, propio=None) -> list[tuple]:
    """Las cajas que hay que tachar, a partir de las palabras de una página.

    `palabras` es tal cual lo que devuelve `page.get_text('words')`:
    `(x0, y0, x1, y1, palabra, bloque, línea, número)`. Devuelve
    `(x0, y0, x1, y1, tipo)` por cada dato encontrado.

    **Por qué no se usa `page.search_for`**: sólo busca literales, y aquí lo que
    hay es una expresión. Y por qué no se busca sobre `page.get_text()` a secas:
    ese texto no dice dónde está cada letra, y hace falta el rectángulo.

    Así que se recompone cada renglón uniendo sus palabras con un espacio, se
    guarda qué palabra ocupa cada carácter, se busca sobre el renglón y se unen
    las cajas de las palabras que el hallazgo toca. Es lo único que acierta con
    un «12345678 Z» partido en dos palabras, que es como está escrito medio
    documento oficial.

    Se busca renglón a renglón y no sobre la página entera: un dato partido por
    un salto de línea se escapa, pero buscar de corrido haría que el final de un
    renglón y el principio del siguiente formaran datos que no existen, y tachar
    de más en un sitio que nadie mira es peor que tachar de menos en uno que sí.
    """
    zonas = []
    for renglon in _renglones(palabras):
        texto, mapa = _componer(renglon)
        for inicio, fin, clave in coincidencias(texto, tipos, propio):
            indices = {mapa[i] for i in range(inicio, fin) if mapa[i] is not None}
            if not indices:
                continue
            cajas = [renglon[i] for i in sorted(indices)]
            zonas.append((min(c[0] for c in cajas), min(c[1] for c in cajas),
                          max(c[2] for c in cajas), max(c[3] for c in cajas), clave))
    return zonas


def _renglones(palabras):
    """Agrupa las palabras por bloque y línea, conservando su orden de lectura."""
    grupos: dict = {}
    for palabra in palabras:
        grupos.setdefault((palabra[5], palabra[6]), []).append(palabra)
    return [grupo for _, grupo in sorted(grupos.items())]


def _componer(renglon) -> tuple[str, list]:
    """El renglón como cadena, y qué palabra ocupa cada uno de sus caracteres.

    El separador es un espacio y su hueco en el mapa va vacío: así una expresión
    puede exigir el espacio de «12345678 Z» sin que el espacio arrastre a tachar
    la palabra de al lado.
    """
    partes, mapa = [], []
    for indice, palabra in enumerate(renglon):
        if indice:
            partes.append(' ')
            mapa.append(None)
        partes.append(palabra[4])
        mapa.extend([indice] * len(palabra[4]))
    return ''.join(partes), mapa
