"""De un PDF a Markdown conservando la estructura que se ve en la página.

"Documento a Markdown" usaba markitdown también para los PDF, y markitdown lee
el PDF con pdfminer como un chorro de texto: los títulos salen como una línea
más, la negrita que un programa simula escribiendo el texto dos veces con medio
punto de desplazamiento sale **dos veces** («PPeerrssoonnaa»), el pie de cada
página («1 de 2») acaba en mitad del texto y las tablas sin rejilla se pierden.
Y como sale todo pegado, sin líneas en blanco, el Markdown entero se lee como
un único párrafo. Con eso, "Markdown a PDF" no tiene nada que maquetar.

Aquí se lee con PyMuPDF, que da cada tramo de texto con su tipografía, tamaño,
banderas y posición, y con eso se reconstruye:

- **Títulos**: por tamaño respecto al cuerpo dominante, o por ir enteros en
  negrita y solos en su renglón. Los niveles salen de ordenar los estilos de
  título que aparecen, del más grande al más pequeño.
- **Negrita, cursiva y código** en línea, por las banderas y el nombre de la
  fuente.
- **Tablas**: las que tienen rejilla, con `find_tables()`; las que no —que son
  la mayoría de las que genera un programa—, alineando columnas de renglones
  consecutivos. Las celdas de formulario (una etiqueta pequeña encima del
  valor) se desdoblan en una fila de etiquetas y otra de valores.
- **Listas**, por la viñeta o el número, con el nivel según la sangría.
- **Bloques de código**, con la sangría recuperada de la posición.
- **Citas**: bloques en cursiva sangrados.
- **Cabeceras y pies de página**: lo que se repite en la franja superior o
  inferior de varias páginas se quita del texto; si no lleva el número de
  página, se deja una vez al final para no perder información.

Es heurística, y por eso conservadora: ante la duda, un párrafo. Un párrafo
de más se lee bien; una tabla inventada, no.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import fitz  # PyMuPDF

# Banderas de PyMuPDF para cada tramo de texto.
_CURSIVA, _MONO, _NEGRITA = 2, 8, 16

# Sin TEXT_PRESERVE_LIGATURES: así «ﬁ» sale como «fi» y el texto se puede buscar.
_FLAGS_TEXTO = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP | fitz.TEXT_DEHYPHENATE

VINETA = re.compile(r'^\s*([•◦▪‣○●■□–—\-*·])\s+(.*)$')
NUMERADA = re.compile(r'^\s*(\d{1,3}|[a-zA-Z])([.)])\s+(.*)$')
NUMERO_PAGINA = re.compile(
    r'^\s*(p[aá]g(ina|\.)?\s*)?\d{1,4}(\s*(de|/|of)\s*\d{1,4})?\s*$', re.IGNORECASE)
NUMERICO = re.compile(r'^[−\-+]?\s*[\d.,\s]*\d\s*(€|%|\$|£)?$')

MARCA_SUELTA = re.compile(r'^([•◦▪‣○●■□–—\-*·]|\d{1,3}[.)])$')

# Franja de la página, por arriba y por abajo, donde viven cabeceras y pies.
FRANJA = 0.08


@dataclass
class Tramo:
    texto: str
    tamano: float
    negrita: bool
    cursiva: bool
    mono: bool
    x0: float
    x1: float


@dataclass
class Linea:
    """Un trozo de texto continuo en un renglón (PyMuPDF lo llama «line»)."""
    tramos: list[Tramo]
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def texto(self) -> str:
        return ''.join(t.texto for t in self.tramos)

    @property
    def tamano(self) -> float:
        return max((t.tamano for t in self.tramos if t.texto.strip()), default=0)

    @property
    def negrita(self) -> bool:
        return all(t.negrita for t in self.tramos if t.texto.strip())

    @property
    def cursiva(self) -> bool:
        return all(t.cursiva for t in self.tramos if t.texto.strip())

    @property
    def mono(self) -> bool:
        return all(t.mono for t in self.tramos if t.texto.strip())


@dataclass
class Renglon:
    """Las líneas que comparten altura. Separadas por un hueco grande, son celdas."""
    celdas: list[list[Linea]]
    y0: float
    y1: float
    pagina: int

    @property
    def lineas(self) -> list[Linea]:
        return [linea for celda in self.celdas for linea in celda]

    @property
    def x0(self) -> float:
        return min(linea.x0 for linea in self.lineas)

    @property
    def x1(self) -> float:
        return max(linea.x1 for linea in self.lineas)

    @property
    def tamano(self) -> float:
        return max(linea.tamano for linea in self.lineas)

    @property
    def texto(self) -> str:
        return ' '.join(_texto_celda(celda) for celda in self.celdas)


@dataclass
class Tabla:
    filas: list[list[str]]
    y0: float
    pagina: int
    alineada_derecha: list[bool] = field(default_factory=list)


# ─── Lectura ────────────────────────────────────────────────────────────────


def pdf_a_markdown(ruta: str) -> str:
    with fitz.open(ruta) as documento:
        paginas = [_leer_pagina(pagina, numero) for numero, pagina in enumerate(documento)]
        alto = [pagina.rect.height for pagina in documento]

    cuerpo, pies = _quitar_cabeceras_y_pies(paginas, alto, len(alto))
    lineas = [linea for _, lineas_pagina, _ in cuerpo for linea in lineas_pagina]
    if not any(linea.texto.strip() for linea in lineas) and not any(t for _, _, t in cuerpo):
        return ''

    tamano_cuerpo = _tamano_dominante(lineas)
    bloques = []
    for numero, lineas_pagina, tablas in cuerpo:
        renglones = _renglones(lineas_pagina, numero)
        de_la_pagina = _componer_pagina(renglones, tablas, tamano_cuerpo)
        bloques.extend(de_la_pagina)
        if numero == 0 and len(cuerpo) > 1 and _es_portada(de_la_pagina, tamano_cuerpo):
            bloques.append(Bloque('salto'))

    bloques = _unir_tablas_partidas(bloques)
    niveles = _niveles_de_titulo(bloques, tamano_cuerpo)
    partes = [_escribir(bloque, niveles) for bloque in bloques]
    partes.extend(_parrafo_simple(pie) for pie in pies)
    return '\n\n'.join(parte for parte in partes if parte.strip()).strip() + '\n'


def _leer_pagina(pagina: fitz.Page, numero: int):
    tablas = _tablas_con_rejilla(pagina, numero)
    zonas = [fitz.Rect(t_bbox) for t_bbox, _ in tablas]
    lineas: list[Linea] = []
    datos = pagina.get_text('dict', flags=_FLAGS_TEXTO)
    for bloque in datos['blocks']:
        for bruta in bloque.get('lines', []):
            if abs(bruta['dir'][1]) > 0.1:  # texto girado: sellos, marcas laterales
                continue
            tramos = [_tramo(s) for s in bruta['spans'] if s['text']]
            if not ''.join(t.texto for t in tramos).strip():
                continue
            x0, y0, x1, y1 = bruta['bbox']
            centro = fitz.Point((x0 + x1) / 2, (y0 + y1) / 2)
            if any(centro in zona for zona in zonas):
                continue
            lineas.append(Linea(tramos, x0, y0, x1, y1))
    lineas = _sin_negrita_simulada(lineas)
    return numero, lineas, [tabla for _, tabla in tablas]


def _tramo(span) -> Tramo:
    fuente = span['font'].lower()
    flags = span['flags']
    return Tramo(
        texto=span['text'].replace('\u00a0', ' '),
        tamano=round(span['size'], 1),
        negrita=bool(flags & _NEGRITA) or any(p in fuente for p in ('bold', 'black', 'heavy', 'semibold')),
        cursiva=bool(flags & _CURSIVA) or 'italic' in fuente or 'oblique' in fuente,
        mono=bool(flags & _MONO) or any(p in fuente for p in ('mono', 'courier', 'consolas', 'code')),
        x0=span['bbox'][0], x1=span['bbox'][2],
    )


def _sin_negrita_simulada(lineas: list[Linea]) -> list[Linea]:
    """Quita las copias desplazadas con las que se simula la negrita.

    Un programa sin variante negrita de la fuente escribe el texto dos (o más)
    veces con una fracción de punto de desplazamiento. Se queda una copia, que
    pasa a contar como negrita.
    """
    resultado: list[Linea] = []
    for linea in lineas:
        gemela = next((otra for otra in resultado[-6:]
                       if otra.texto == linea.texto
                       and abs(otra.y0 - linea.y0) < 1 and abs(otra.x0 - linea.x0) < 2), None)
        if gemela:
            for tramo in gemela.tramos:
                tramo.negrita = True
            continue
        resultado.append(linea)
    return resultado


# ─── Tablas con rejilla ────────────────────────────────────────────────────


def _tablas_con_rejilla(pagina: fitz.Page, numero: int):
    """Las tablas que se ven dibujadas. Descarta lo que sólo es un marco."""
    try:
        encontradas = pagina.find_tables().tables
    except Exception:  # noqa: BLE001 — una detección fallida no debe tumbar la conversión
        return []
    resultado = []
    for tabla in encontradas:
        celdas = [[_celda_rejilla(pagina, rect) for rect in fila.cells] for fila in tabla.rows]
        llenas = [c for fila in celdas for c in fila if c and c[0]]
        de_formulario = sum(1 for c in llenas if len(c[1]) >= 2 and c[1][0].tamano < c[1][1].tamano * 0.9)
        if tabla.col_count < 2 or len(llenas) < 3 or (tabla.row_count < 2 and de_formulario < 2):
            continue
        # Un marco con un párrafo dentro no es una tabla.
        if max(len(c[1]) for c in llenas) > 6:
            continue
        resultado.append((tabla.bbox, _tabla_de_celdas(celdas, tabla.bbox[1], numero)))
    return resultado


def _celda_rejilla(pagina: fitz.Page, rect):
    """(texto en Markdown, líneas con su tamaño) de una celda."""
    if rect is None:
        return None
    datos = pagina.get_text('dict', clip=fitz.Rect(rect), flags=_FLAGS_TEXTO)
    lineas = []
    for bloque in datos['blocks']:
        for bruta in bloque.get('lines', []):
            tramos = [_tramo(s) for s in bruta['spans'] if s['text'].strip()]
            if tramos:
                lineas.append(Linea(tramos, *bruta['bbox']))
    lineas = _sin_negrita_simulada(lineas)
    return (_texto_celda(lineas), lineas)


def _tabla_de_celdas(celdas, y0: float, numero: int) -> Tabla:
    """Celdas de rejilla a filas de texto, desdoblando las de formulario."""
    def es_formulario(celda):
        if not celda or len(celda[1]) < 2:
            return False
        etiqueta, valor = celda[1][0], celda[1][1]
        return etiqueta.tamano < valor.tamano * 0.9

    llenas = [c for fila in celdas for c in fila if c and c[0]]
    formulario = sum(es_formulario(c) for c in llenas) >= max(2, len(llenas) * 0.6)

    filas: list[list[str]] = []
    for fila in celdas:
        if formulario:
            etiquetas, valores = [], []
            for celda in fila:
                if es_formulario(celda):
                    etiquetas.append(_markdown_tramos(celda[1][0].tramos).strip())
                    valores.append(_texto_celda(celda[1][1:]))
                else:
                    etiquetas.append('')
                    valores.append(celda[0] if celda else '')
            filas.append(etiquetas)
            filas.append(valores)
        else:
            filas.append([celda[0] if celda else '' for celda in fila])

    if formulario:
        # Las filas de etiquetas que no van en la cabecera se marcan en negrita:
        # "Markdown a PDF" las pinta como etiquetas.
        for indice in range(2, len(filas), 2):
            filas[indice] = [f'**{_sin_negrita(c)}**' if c else '' for c in filas[indice]]
    return Tabla(filas, y0, numero)


# ─── Cabeceras, pies y tamaño del cuerpo ───────────────────────────────────


def _quitar_cabeceras_y_pies(paginas, altos, total):
    if total < 2:
        # Con una sola página no hay repetición que buscar: sólo el número.
        limpias = []
        for numero, lineas, tablas in paginas:
            alto = altos[numero]
            limpias.append((numero, [l for l in lineas if not (
                _en_franja(l, alto) and NUMERO_PAGINA.match(l.texto))], tablas))
        return limpias, []

    firmas = Counter()
    textos: dict[str, set] = {}
    for numero, lineas, _ in paginas:
        vistas = {}
        for linea in lineas:
            if _en_franja(linea, altos[numero]):
                texto = linea.texto.strip()
                vistas[re.sub(r'\d+', '#', texto)] = texto
        firmas.update(vistas.keys())
        for firma, texto in vistas.items():
            textos.setdefault(firma, set()).add(texto)
    repetidas = {firma for firma, veces in firmas.items() if veces >= max(2, total * 0.6)}

    pies: list[str] = []
    limpias = []
    for numero, lineas, tablas in paginas:
        conservadas = []
        for linea in lineas:
            texto = linea.texto.strip()
            firma = re.sub(r'\d+', '#', texto)
            if _en_franja(linea, altos[numero]) and (firma in repetidas or NUMERO_PAGINA.match(texto)):
                # Lo que es igual en todas las páginas es información (un
                # teléfono, un aviso); lo que cambia lleva el número de página.
                if len(textos.get(firma, ())) == 1 and texto not in pies \
                        and not NUMERO_PAGINA.match(texto):
                    pies.append(texto)
                continue
            conservadas.append(linea)
        limpias.append((numero, conservadas, tablas))
    return limpias, pies


def _en_franja(linea: Linea, alto: float) -> bool:
    return linea.y1 < alto * FRANJA or linea.y0 > alto * (1 - FRANJA)


def _tamano_dominante(lineas: list[Linea]) -> float:
    pesos = Counter()
    for linea in lineas:
        for tramo in linea.tramos:
            if not tramo.mono:
                pesos[round(tramo.tamano * 2) / 2] += len(tramo.texto.strip())
    return pesos.most_common(1)[0][0] if pesos else 10


# ─── Renglones y bloques ───────────────────────────────────────────────────


def _renglones(lineas: list[Linea], pagina: int) -> list[Renglon]:
    """Agrupa las líneas por altura y, dentro de cada altura, en celdas."""
    renglones: list[Renglon] = []
    for linea in sorted(lineas, key=lambda l: (round(l.y0), l.x0)):
        alto = max(linea.y1 - linea.y0, 1)
        destino = next((r for r in reversed(renglones[-3:])
                        if abs((r.y0 + r.y1) / 2 - (linea.y0 + linea.y1) / 2) < alto * 0.45), None)
        if destino:
            destino.celdas.append([linea])
            destino.y0, destino.y1 = min(destino.y0, linea.y0), max(destino.y1, linea.y1)
        else:
            renglones.append(Renglon([[linea]], linea.y0, linea.y1, pagina))

    for renglon in renglones:
        lineas_ordenadas = sorted(renglon.lineas, key=lambda l: l.x0)
        celdas = [[lineas_ordenadas[0]]]
        for linea in lineas_ordenadas[1:]:
            anterior = celdas[-1][-1]
            hueco = linea.x0 - anterior.x1
            if hueco > max(linea.tamano, anterior.tamano) * 1.1:
                celdas.append([linea])
            else:
                celdas[-1].append(linea)
        # Una viñeta o un número sueltos, separados de su texto, van con él.
        if len(celdas) > 1 and MARCA_SUELTA.match(''.join(l.texto for l in celdas[0]).strip()):
            celdas[0:2] = [celdas[0] + celdas[1]]
        renglon.celdas = celdas
    return renglones


@dataclass
class Bloque:
    tipo: str  # titulo | parrafo | lista | codigo | cita | tabla | definiciones
    renglones: list[Renglon] = field(default_factory=list)
    tabla: Tabla | None = None
    estilo: tuple = ()
    alineacion: str = ''
    items: list = field(default_factory=list)
    y0: float = 0


def _componer_pagina(renglones: list[Renglon], tablas: list[Tabla], cuerpo: float) -> list[Bloque]:
    if not renglones and not tablas:
        return []
    izquierda = min((r.x0 for r in renglones), default=0)
    derecha = max((r.x1 for r in renglones), default=0)

    elementos: list[Bloque] = []
    elementos.extend(Bloque('tabla', tabla=t, y0=t.y0) for t in tablas)

    indice = 0
    while indice < len(renglones):
        tabla, consumidos = _tabla_sin_rejilla(renglones, indice)
        if tabla:
            elementos.append(tabla)
            indice += consumidos
            continue
        elementos.append(_bloque_de_renglon(renglones[indice], cuerpo, izquierda, derecha))
        indice += 1

    elementos.sort(key=lambda b: b.y0)
    return _fusionar(elementos, cuerpo, izquierda, derecha)


def _bloque_de_renglon(renglon: Renglon, cuerpo: float, izquierda: float, derecha: float) -> Bloque:
    texto = renglon.texto.strip()
    lineas = renglon.lineas
    tamano = renglon.tamano
    y0 = renglon.y0

    if all(l.mono for l in lineas):
        return Bloque('codigo', [renglon], y0=y0)
    if VINETA.match(texto) or NUMERADA.match(texto):
        # «1. DATOS DEL SOLICITANTE» en negrita y solo en su renglón es un
        # apartado, no una lista.
        if not (len(renglon.celdas) == 1 and all(l.negrita for l in lineas) and len(texto) < 90
                and NUMERADA.match(texto)):
            return Bloque('lista', [renglon], y0=y0)

    sola = len(renglon.celdas) == 1
    entera_negrita = all(l.negrita for l in lineas)
    grande = tamano >= cuerpo * (1.15 if entera_negrita else 1.5)
    if sola and len(texto) <= 120 and (grande or (entera_negrita and not texto.endswith((':', ',')))):
        estilo = (round(tamano * 2) / 2, entera_negrita)
        return Bloque('titulo', [renglon], estilo=estilo, y0=y0,
                      alineacion=_alineacion(renglon, izquierda, derecha))

    if all(l.cursiva for l in lineas) and renglon.x0 > izquierda + cuerpo * 1.5:
        return Bloque('cita', [renglon], y0=y0)
    return Bloque('parrafo', [renglon], y0=y0, alineacion=_alineacion(renglon, izquierda, derecha))


def _alineacion(renglon: Renglon, izquierda: float, derecha: float) -> str:
    ancho = derecha - izquierda
    if ancho <= 0 or renglon.x0 - izquierda < ancho * 0.15:
        return ''
    centro = (renglon.x0 + renglon.x1) / 2
    if abs(centro - (izquierda + derecha) / 2) < ancho * 0.06:
        return 'center'
    if derecha - renglon.x1 < ancho * 0.04:
        return 'right'
    return ''


def _fusionar(elementos: list[Bloque], cuerpo: float, izquierda: float, derecha: float) -> list[Bloque]:
    """Une renglones consecutivos del mismo tipo en párrafos, listas y bloques."""
    ancho = max(derecha - izquierda, 1)
    resultado: list[Bloque] = []
    for bloque in elementos:
        previo = resultado[-1] if resultado else None
        if previo and previo.renglones and bloque.renglones and previo.tipo == bloque.tipo \
                and bloque.tipo in ('parrafo', 'codigo', 'cita', 'titulo'):
            ultimo, nuevo = previo.renglones[-1], bloque.renglones[0]
            hueco = nuevo.y0 - ultimo.y1
            tamano = max(ultimo.tamano, nuevo.tamano)
            seguido = -tamano < hueco < tamano * (0.9 if bloque.tipo == 'codigo' else 0.6)
            if bloque.tipo == 'parrafo':
                corto = ultimo.x1 < derecha - ancho * 0.25 and ultimo.texto.rstrip().endswith(('.', ':', ';', '!', '?'))
                empieza_etiqueta = _empieza_por_etiqueta(nuevo)
                seguido = seguido and not corto and not empieza_etiqueta \
                    and previo.alineacion == bloque.alineacion and abs(nuevo.x0 - ultimo.x0) < tamano * 3
            if bloque.tipo == 'titulo':
                seguido = seguido and previo.estilo == bloque.estilo
            if seguido:
                previo.renglones.append(nuevo)
                continue
        if previo and bloque.tipo == 'parrafo' and previo.tipo == 'lista' and bloque.renglones:
            # Continuación de un elemento de lista: sangrado respecto a su viñeta.
            ultimo, nuevo = previo.renglones[-1], bloque.renglones[0]
            if 0 <= nuevo.y0 - ultimo.y1 < nuevo.tamano * 0.6 and nuevo.x0 > previo.renglones[-1].x0 + 2:
                previo.renglones.append(nuevo)
                nuevo.continuacion = True
                continue
        if previo and bloque.tipo == 'lista' and previo.tipo == 'lista':
            ultimo, nuevo = previo.renglones[-1], bloque.renglones[0]
            if nuevo.y0 - ultimo.y1 < nuevo.tamano * 1.2:
                previo.renglones.append(nuevo)
                continue
        resultado.append(bloque)
    return resultado


def _empieza_por_etiqueta(renglon: Renglon) -> bool:
    primero = renglon.lineas[0].tramos
    negrita = ''.join(t.texto for t in primero if t.negrita).strip()
    return bool(negrita) and negrita.endswith(':') and renglon.lineas[0].texto.strip().startswith(negrita)


# ─── Tablas sin rejilla ────────────────────────────────────────────────────


def _tabla_sin_rejilla(renglones: list[Renglon], inicio: int):
    """Busca una tabla que empiece en `inicio` alineando columnas.

    Hacen falta al menos dos renglones seguidos con el mismo número de celdas
    (dos o más) cuyas columnas se solapen. Un renglón con menos celdas que cae
    dentro de las columnas y pegado al anterior es texto que continúa en otra
    línea de la celda.
    """
    primero = renglones[inicio]
    columnas = len(primero.celdas)
    if columnas < 2:
        return None, 0
    rangos = [(min(l.x0 for l in c), max(l.x1 for l in c)) for c in primero.celdas]
    filas = [[_texto_celda(c) for c in primero.celdas]]
    negritas = [all(l.negrita for l in primero.lineas)]
    derecha = [[c[-1].x1] for c in primero.celdas]
    fin = inicio + 1
    while fin < len(renglones):
        renglon = renglones[fin]
        anterior = renglones[fin - 1]
        if renglon.pagina != primero.pagina or renglon.y0 - anterior.y1 > renglon.tamano * 2.2:
            break
        asignadas = _asignar_columnas(renglon, rangos)
        if asignadas is None:
            break
        if len(renglon.celdas) == columnas:
            filas.append([''] * columnas)
            negritas.append(all(l.negrita for l in renglon.lineas))
            for indice, celda in asignadas:
                filas[-1][indice] = _texto_celda(celda)
                derecha[indice].append(celda[-1].x1)
                rangos[indice] = (min(rangos[indice][0], celda[0].x0), max(rangos[indice][1], celda[-1].x1))
        elif len(filas) >= 1 and renglon.y0 - anterior.y1 < renglon.tamano * 0.5:
            for indice, celda in asignadas:
                filas[-1][indice] = (filas[-1][indice] + ' ' + _texto_celda(celda)).strip()
        else:
            break
        fin += 1

    completas = sum(1 for fila in filas if all(fila))
    if len(filas) < 2 or completas < 1:
        return None, 0
    # Dos columnas de texto corrido son una maquetación a dos columnas, no una tabla.
    if columnas == 2 and sum(1 for f in filas if min(len(f[0]), len(f[1])) > 45) > len(filas) / 2:
        return None, 0

    if columnas == 2 and all(f[0].replace('*', '').rstrip().endswith(':') for f in filas if f[0]):
        bloque = Bloque('definiciones', y0=primero.y0)
        bloque.items = [(f[0], f[1]) for f in filas]
        return bloque, fin - inicio

    for indice, negrita in enumerate(negritas):
        if negrita and indice > 0:
            filas[indice] = [f'**{_sin_negrita(c)}**' if c else '' for c in filas[indice]]
    alineada = [max(xs) - min(xs) < 2 and len(xs) > 2 for xs in derecha]
    tabla = Tabla(filas, primero.y0, primero.pagina, alineada)
    return Bloque('tabla', tabla=tabla, y0=primero.y0), fin - inicio


def _asignar_columnas(renglon: Renglon, rangos):
    asignadas = []
    usadas = set()
    for celda in renglon.celdas:
        x0, x1 = celda[0].x0, max(l.x1 for l in celda)
        candidatas = [i for i, (a, b) in enumerate(rangos)
                      if i not in usadas and min(x1, b) - max(x0, a) > -2]
        if len(candidatas) != 1:
            return None
        usadas.add(candidatas[0])
        asignadas.append((candidatas[0], celda))
    return asignadas


# ─── Escritura ─────────────────────────────────────────────────────────────


def _niveles_de_titulo(bloques: list[Bloque], cuerpo: float) -> dict:
    estilos = sorted({b.estilo for b in bloques if b.tipo == 'titulo'}, key=lambda e: (-e[0], not e[1]))
    return {estilo: min(indice + 1, 4) for indice, estilo in enumerate(estilos)}


def _unir_tablas_partidas(bloques: list[Bloque]) -> list[Bloque]:
    """Una tabla que sigue en la página siguiente es la misma tabla.

    Se unen dos tablas seguidas —sin nada entre medias— de páginas distintas y
    con el mismo número de columnas. La cabecera repetida en la segunda página
    se quita.
    """
    resultado: list[Bloque] = []
    for bloque in bloques:
        previo = resultado[-1] if resultado else None
        if previo and previo.tipo == bloque.tipo == 'tabla' \
                and previo.tabla.pagina != bloque.tabla.pagina \
                and len(previo.tabla.filas[0]) == len(bloque.tabla.filas[0]):
            filas = bloque.tabla.filas
            if _sin_negrita(' '.join(filas[0])) == _sin_negrita(' '.join(previo.tabla.filas[0])):
                filas = filas[1:]
            previo.tabla.filas.extend(filas)
            previo.tabla.pagina = bloque.tabla.pagina
            continue
        resultado.append(bloque)
    return resultado


def _es_portada(bloques: list[Bloque], cuerpo: float) -> bool:
    """Una primera página con un título grande y apenas texto más."""
    if not bloques or len(bloques) > 6 or any(b.tipo not in ('titulo', 'parrafo') for b in bloques):
        return False
    caracteres = sum(len(r.texto) for b in bloques for r in b.renglones)
    return caracteres < 400 and any(b.tipo == 'titulo' and b.estilo[0] >= cuerpo * 1.8 for b in bloques)


def _escribir(bloque: Bloque, niveles: dict) -> str:
    if bloque.tipo == 'salto':
        # La convención de pandoc y de casi todos los conversores de Markdown a PDF.
        return '<div style="page-break-after: always"></div>'
    if bloque.tipo == 'titulo':
        texto = ' '.join(_sin_negrita(r.texto.strip()) for r in bloque.renglones)
        return '#' * niveles[bloque.estilo] + ' ' + _escapar_en_linea(texto)
    if bloque.tipo == 'tabla':
        return _escribir_tabla(bloque.tabla)
    if bloque.tipo == 'definiciones':
        return '\n'.join(
            f'**{_sin_negrita(etiqueta)}** {valor}'.rstrip() + ('  ' if i < len(bloque.items) - 1 else '')
            for i, (etiqueta, valor) in enumerate(bloque.items))
    if bloque.tipo == 'codigo':
        return _escribir_codigo(bloque)
    if bloque.tipo == 'lista':
        return _escribir_lista(bloque)
    if bloque.alineacion:
        html = '<br>'.join(_markdown_a_html_simple(_unir_renglones([r])) for r in bloque.renglones)
        return f'<p align="{bloque.alineacion}">{html}</p>'
    texto = _unir_renglones(bloque.renglones)
    if bloque.tipo == 'cita':
        return '> ' + texto
    return _proteger_inicio(texto)


def _unir_renglones(renglones: list[Renglon]) -> str:
    texto = ''
    for renglon in renglones:
        trozo = ' '.join(_texto_celda(c) for c in renglon.celdas).strip()
        if texto.endswith('-') and trozo[:1].islower():
            texto = texto[:-1] + trozo
        else:
            texto = (texto + ' ' + trozo).strip()
    return _limpiar_marcas(texto)


def _escribir_lista(bloque: Bloque) -> str:
    sangrias = sorted({round(r.x0) for r in bloque.renglones if not getattr(r, 'continuacion', False)})
    niveles: list[int] = []
    for x in sangrias:
        if not niveles or x - niveles[-1] > 6:
            niveles.append(x)
    lineas: list[str] = []
    for renglon in bloque.renglones:
        texto = ' '.join(_texto_celda(c) for c in renglon.celdas).strip()
        if getattr(renglon, 'continuacion', False) and lineas:
            lineas[-1] = _limpiar_marcas(lineas[-1] + ' ' + texto)
            continue
        nivel = max(i for i, x in enumerate(niveles) if round(renglon.x0) >= x - 6)
        numerada = NUMERADA.match(_sin_negrita(texto))
        vineta = VINETA.match(_sin_negrita(texto))
        if numerada and numerada.group(1).isdigit():
            marca, cuerpo = f'{numerada.group(1)}.', _quitar_prefijo(texto, numerada.group(3))
        elif vineta:
            marca, cuerpo = '-', _quitar_prefijo(texto, vineta.group(2))
        elif numerada:
            marca, cuerpo = '-', texto
        else:
            marca, cuerpo = '-', texto
        lineas.append('  ' * nivel * (2 if marca[0].isdigit() else 1) + f'{marca} {cuerpo}')
    return '\n'.join(lineas)


def _quitar_prefijo(texto_md: str, resto_plano: str) -> str:
    """Quita la viñeta de un texto con marcas conservando la negrita del resto."""
    posicion = texto_md.find(resto_plano[:12]) if resto_plano else -1
    return _limpiar_marcas(texto_md[posicion:] if posicion > 0 else resto_plano)


def _escribir_codigo(bloque: Bloque) -> str:
    izquierda = min(r.x0 for r in bloque.renglones)
    lineas = []
    for renglon in bloque.renglones:
        ancho_caracter = renglon.tamano * 0.6
        sangria = round((renglon.x0 - izquierda) / ancho_caracter) if ancho_caracter else 0
        lineas.append(' ' * sangria + ''.join(l.texto for l in renglon.lineas).rstrip())
    cuerpo = '\n'.join(lineas)
    valla = '````' if '```' in cuerpo else '```'
    return f'{valla}\n{cuerpo}\n{valla}'


def _escribir_tabla(tabla: Tabla) -> str:
    filas = [[celda.replace('|', '\\|').replace('\n', '<br>') for celda in fila] for fila in tabla.filas]
    columnas = max(len(f) for f in filas)
    filas = [f + [''] * (columnas - len(f)) for f in filas]
    vacias = [i for i in range(columnas) if not any(f[i].strip() for f in filas)]
    filas = [[c for i, c in enumerate(f) if i not in vacias] for f in filas]
    columnas = len(filas[0])
    derecha = [i for i in range(columnas) if _columna_numerica([f[i] for f in filas[1:]])]
    separador = ['---:' if i in derecha else '---' for i in range(columnas)]
    filas[0] = [_sin_negrita(c) for c in filas[0]]
    lineas = ['| ' + ' | '.join(filas[0]) + ' |', '| ' + ' | '.join(separador) + ' |']
    lineas += ['| ' + ' | '.join(f) + ' |' for f in filas[1:]]
    return '\n'.join(lineas)


def _columna_numerica(valores: list[str]) -> bool:
    llenos = [_sin_negrita(v).strip() for v in valores if v.strip()]
    return bool(llenos) and sum(bool(NUMERICO.match(v)) for v in llenos) >= len(llenos) * 0.7


# ─── Texto en línea ────────────────────────────────────────────────────────


def _texto_celda(lineas: list[Linea]) -> str:
    texto = ''
    for indice, linea in enumerate(lineas):
        trozo = _markdown_tramos(linea.tramos).strip()
        anterior = lineas[indice - 1] if indice else None
        pegada = anterior is not None and abs(anterior.y0 - linea.y0) < 2 \
            and linea.x0 - anterior.x1 < linea.tamano * 0.15 and not linea.texto[:1].isspace() \
            and not anterior.texto[-1:].isspace()
        texto += ('' if pegada or not texto else ' ') + trozo
    return _limpiar_marcas(texto)


def _markdown_tramos(tramos: list[Tramo]) -> str:
    """Tramos a Markdown en línea, juntando los contiguos con el mismo estilo."""
    grupos: list[list] = []
    for tramo in tramos:
        clave = (tramo.negrita and not tramo.mono, tramo.cursiva and not tramo.mono, tramo.mono)
        if grupos and grupos[-1][0] == clave:
            grupos[-1][1] += tramo.texto
        else:
            grupos.append([clave, tramo.texto])
    salida = ''
    for (negrita, cursiva, mono), texto in grupos:
        if not texto.strip():
            salida += texto
            continue
        inicio = texto[:len(texto) - len(texto.lstrip())]
        fin = texto[len(texto.rstrip()):]
        nucleo = texto.strip()
        if mono:
            valla = '``' if '`' in nucleo else '`'
            nucleo = f'{valla}{nucleo}{valla}'
        else:
            nucleo = _escapar_en_linea(nucleo)
            if cursiva:
                nucleo = f'*{nucleo}*'
            if negrita:
                nucleo = f'**{nucleo}**'
        salida += inicio + nucleo + fin
    return salida


def _escapar_en_linea(texto: str) -> str:
    texto = re.sub(r'([\\`*_\[\]<>|])', r'\\\1', texto)
    return texto


def _limpiar_marcas(texto: str) -> str:
    texto = re.sub(r'\s+', ' ', texto)
    # «**uno** **dos**» → «**uno dos**»
    texto = re.sub(r'\*\*\s+\*\*', ' ', texto)
    texto = texto.replace('****', '')
    texto = re.sub(r'` ([.,;:)])', r'`\1', texto)
    texto = re.sub(r'(?<![*\\])\*\s+\*(?!\*)', ' ', texto)
    return texto.strip()


def _sin_negrita(texto: str) -> str:
    return re.sub(r'(?<!\\)\*\*', '', texto)


def _proteger_inicio(texto: str) -> str:
    """Que un párrafo que empieza como «1. » o «# » no se lea como lista o título."""
    if re.match(r'^(\d{1,3})([.)])\s', texto):
        return re.sub(r'^(\d{1,3})([.)])', r'\1\\\2', texto)
    if re.match(r'^([#>+\-])\s', texto):
        return '\\' + texto
    return texto


def _parrafo_simple(texto: str) -> str:
    return _proteger_inicio(_escapar_en_linea(texto))


def _markdown_a_html_simple(texto: str) -> str:
    html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', texto)
    html = re.sub(r'(?<![\\*])\*(.+?)\*', r'<em>\1</em>', html)
    return html
