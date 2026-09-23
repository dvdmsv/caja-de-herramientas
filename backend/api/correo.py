"""Leer un correo `.eml` o `.msg`: lo que comparten "Documento a Markdown" y "Correo a PDF".

markitdown no entiende el `.eml`: lo trata como texto plano y devuelve el
mensaje en crudo, con el asunto en `=?utf-8?q?…?=`, las fronteras MIME, el
quoted-printable y los adjuntos en base64. Lo lee el paquete `email` de la
biblioteca estándar, que con `policy.default` ya deshace todas esas
codificaciones y los juegos de caracteres.

El cuerpo se prefiere en HTML, que es el que trae las negritas, las listas y las
tablas, y se pasa a Markdown con el mismo conversor que los demás documentos. Si
sólo hay texto plano, va tal cual.

El `.msg` de Outlook es otra cosa: un archivo OLE, como los `.doc` de antes,
con cada dato en su propio flujo (`__substg1.0_<propiedad><tipo>`). markitdown
lo sabe leer, pero sólo saca remitente, destinatario, asunto y cuerpo en texto:
sin fecha, sin copia, sin el HTML y sin los adjuntos. Se lee aquí con `olefile`
—lo que instala el extra `outlook` de markitdown— para que un `.msg` salga igual
que un `.eml`.

Los adjuntos se nombran en el documento **y** se entregan como archivos
sueltos: un correo suele ser sobre todo lo que trae adjunto, y así se pueden
pasar a otra herramienta sin salir de la aplicación. Las imágenes incrustadas en
el HTML (`cid:`) salen también como adjuntos: el PDF no las pinta.
"""
import datetime
import email
import mimetypes
import os
import struct
from dataclasses import dataclass, field
from email import policy
from email.utils import parsedate_to_datetime

from api.conversor_markdown import html_a_markdown
from errors import ApiError
from storage import storage, nombre_seguro


@dataclass
class Adjunto:
    nombre: str
    tipo: str
    datos: bytes


@dataclass
class Correo:
    asunto: str = ''
    de: str = ''
    para: str = ''
    cc: str = ''
    fecha: str = ''
    cuerpo: str = ''
    adjuntos: list[Adjunto] = field(default_factory=list)


EXTENSIONES = {'.eml', '.msg'}


def leer(ruta: str, nombre: str) -> Correo:
    try:
        if os.path.splitext(nombre)[1].lower() == '.msg':
            correo = _leer_msg(ruta)
        else:
            correo = _leer_eml(ruta)
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido leer el correo "{nombre}": {err}', 422) from err

    # Cualquier texto se deja leer como un correo sin cabeceras: si no trae
    # ninguna de las de siempre, no lo es.
    if not (correo.de or correo.para or correo.asunto or correo.fecha):
        raise ApiError(f'"{nombre}" no parece un correo: no tiene remitente, destinatario, '
                       'asunto ni fecha.', 422)
    return correo


def _leer_eml(ruta: str) -> Correo:
    with open(ruta, 'rb') as fh:
        mensaje = email.message_from_binary_file(fh, policy=policy.default)
    correo = Correo(
        asunto=_cabecera(mensaje, 'Subject'),
        de=_cabecera(mensaje, 'From'),
        para=_cabecera(mensaje, 'To'),
        cc=_cabecera(mensaje, 'Cc'),
        fecha=_fecha(_cabecera(mensaje, 'Date')))
    cuerpo = mensaje.get_body(preferencelist=('html', 'plain'))
    if cuerpo is not None:
        texto = _texto(cuerpo)
        if cuerpo.get_content_subtype() == 'html':
            texto = html_a_markdown(texto)
        correo.cuerpo = texto.strip()
    _recoger_adjuntos(mensaje, cuerpo, correo.adjuntos)
    return correo


# Propiedades MAPI de un `.msg`, por su número. El tipo va aparte: `001F` es
# texto en UTF-16, `001E` texto en la página de códigos del mensaje y `0102`
# binario.
ASUNTO, REMITENTE_NOMBRE, REMITENTE_CORREO, PARA, CC = 0x0037, 0x0C1A, 0x0C1F, 0x0E04, 0x0E03
REMITENTE_SMTP = 0x5D01
CUERPO_TEXTO, CUERPO_HTML = 0x1000, 0x1013
FECHA_ENVIO, FECHA_ENTREGA = 0x0039, 0x0E06
PAGINA_DE_CODIGOS = 0x3FFD
ADJUNTO_NOMBRE_LARGO, ADJUNTO_NOMBRE, ADJUNTO_TITULO = 0x3707, 0x3704, 0x3001
ADJUNTO_DATOS, ADJUNTO_TIPO = 0x3701, 0x370E

TIPO_TEXTO_UNICODE, TIPO_TEXTO_ANSI, TIPO_BINARIO = 0x001F, 0x001E, 0x0102
TIPO_ENTERO, TIPO_FECHA = 0x0003, 0x0040

# Los datos de tamaño fijo —números y fechas— no tienen flujo propio: van en
# `__properties_version1.0`, en entradas de 16 bytes tras una cabecera que en
# el mensaje principal mide 32 y en un adjunto 8.
PROPIEDADES = '__properties_version1.0'


def _leer_msg(ruta: str) -> Correo:
    import olefile

    if not olefile.isOleFile(ruta):
        raise ValueError('no es un archivo de Outlook')
    with olefile.OleFileIO(ruta) as msg:
        return _correo_de_msg(msg)


def _correo_de_msg(msg) -> Correo:
    """El correo a partir de un `.msg` ya abierto: cualquier cosa con la
    interfaz de `OleFileIO` que se usa aquí, para poder probarlo sin uno."""
    fijas = _propiedades_fijas(msg, '', 32)
    codificacion = _codec(fijas.get((PAGINA_DE_CODIGOS, TIPO_ENTERO)))

    def texto(propiedad: int, carpeta: str = '') -> str:
        return _texto_msg(msg, carpeta, propiedad, codificacion)

    nombre, direccion = texto(REMITENTE_NOMBRE), texto(REMITENTE_SMTP) or texto(REMITENTE_CORREO)
    # Dentro de una organización, Exchange guarda como dirección una ruta X.500
    # (`/O=EXCHANGELABS/OU=…`), que no le dice nada a nadie.
    if direccion.startswith('/'):
        direccion = ''
    de = f'{nombre} <{direccion}>' if nombre and direccion and nombre != direccion else nombre or direccion

    fecha = fijas.get((FECHA_ENVIO, TIPO_FECHA)) or fijas.get((FECHA_ENTREGA, TIPO_FECHA))
    correo = Correo(asunto=' '.join(texto(ASUNTO).split()), de=de,
                    para=' '.join(texto(PARA).split()), cc=' '.join(texto(CC).split()),
                    fecha=_fecha_msg(fecha))

    html = _flujo(msg, '', CUERPO_HTML, TIPO_BINARIO)
    if html:
        # El HTML de un `.msg` son bytes en la codificación que diga su propia
        # etiqueta `<meta charset>`; casi siempre la del mensaje o UTF-8.
        correo.cuerpo = html_a_markdown(_decodificar(html, codificacion)).strip()
    else:
        correo.cuerpo = texto(CUERPO_TEXTO).strip()

    for carpeta in sorted({'/'.join(entrada[:1]) for entrada in msg.listdir()
                           if entrada[0].startswith('__attach_version1.0_#')}):
        datos = _flujo(msg, carpeta, ADJUNTO_DATOS, TIPO_BINARIO)
        if datos is None:
            # Un correo adjunto dentro del `.msg`: va como carpeta, no como
            # datos, y reconstruirlo en un archivo aparte no compensa.
            continue
        nombre = (texto(ADJUNTO_NOMBRE_LARGO, carpeta) or texto(ADJUNTO_NOMBRE, carpeta)
                  or texto(ADJUNTO_TITULO, carpeta))
        tipo = texto(ADJUNTO_TIPO, carpeta) or (mimetypes.guess_type(nombre)[0] if nombre else None)
        _anadir(correo.adjuntos, nombre, tipo or 'application/octet-stream', datos)
    return correo


def _flujo(msg, carpeta: str, propiedad: int, tipo: int) -> bytes | None:
    ruta = f'{carpeta}/' if carpeta else ''
    ruta += f'__substg1.0_{propiedad:04X}{tipo:04X}'
    if not msg.exists(ruta):
        return None
    return msg.openstream(ruta).read()


def _texto_msg(msg, carpeta: str, propiedad: int, codificacion: str) -> str:
    crudo = _flujo(msg, carpeta, propiedad, TIPO_TEXTO_UNICODE)
    if crudo is not None:
        return crudo.decode('utf-16-le', errors='replace').rstrip('\x00')
    crudo = _flujo(msg, carpeta, propiedad, TIPO_TEXTO_ANSI)
    if crudo is not None:
        return _decodificar(crudo, codificacion).rstrip('\x00')
    return ''


def _propiedades_fijas(msg, carpeta: str, cabecera: int) -> dict:
    """Las propiedades de tamaño fijo, por (número, tipo) → valor en bruto."""
    ruta = f'{carpeta}/{PROPIEDADES}' if carpeta else PROPIEDADES
    if not msg.exists(ruta):
        return {}
    crudo = msg.openstream(ruta).read()
    fijas = {}
    for inicio in range(cabecera, len(crudo) - 15, 16):
        etiqueta, _banderas, valor = struct.unpack_from('<II8s', crudo, inicio)
        fijas[(etiqueta >> 16, etiqueta & 0xFFFF)] = valor
    return fijas


def _fecha_msg(valor: bytes | None) -> str:
    """Un FILETIME de Windows —décimas de microsegundo desde 1601, en UTC—,
    dicho en la hora de aquí, como la del `.eml`."""
    if not valor:
        return ''
    decimas = struct.unpack('<Q', valor)[0]
    if not decimas:
        return ''
    cuando = (datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
              + datetime.timedelta(microseconds=decimas // 10))
    return cuando.astimezone().strftime('%d/%m/%Y %H:%M (%z)')


def _codec(valor: bytes | None) -> str:
    """La codificación de los textos «ANSI» del mensaje; si no la dice, la de Windows."""
    if valor:
        pagina = struct.unpack('<I', valor[:4])[0]
        nombre = 'utf-8' if pagina == 65001 else f'cp{pagina}'
        try:
            import codecs
            codecs.lookup(nombre)
            return nombre
        except LookupError:
            pass
    return 'cp1252'


def _decodificar(crudo: bytes, codificacion: str) -> str:
    for candidata in ('utf-8', codificacion):
        try:
            return crudo.decode(candidata)
        except UnicodeDecodeError:
            continue
    return crudo.decode(codificacion, errors='replace')


def a_markdown(correo: Correo) -> str:
    """El correo como documento: asunto de título, cabeceras, cuerpo y adjuntos."""
    partes = [f'# {_escapar(correo.asunto) or "(Sin asunto)"}', '']
    for etiqueta, valor in (('De', correo.de), ('Para', correo.para),
                            ('CC', correo.cc), ('Fecha', correo.fecha)):
        if valor:
            partes.append(f'- **{etiqueta}:** {_escapar(valor)}')
    partes += ['', '---', '', correo.cuerpo or '*(El correo no tiene texto.)*']
    if correo.adjuntos:
        partes += ['', '## Adjuntos', '']
        partes += [f'- {_escapar(adjunto.nombre)} ({_tamano(len(adjunto.datos))})'
                   for adjunto in correo.adjuntos]
    return '\n'.join(partes)


def guardar_adjuntos(session_id: str, correo: Correo) -> list:
    """Los adjuntos, como resultados de la sesión. La cuota la mira `commit_output`."""
    guardados = []
    for adjunto in correo.adjuntos:
        destino, salida = storage.reserve_output(session_id, adjunto.nombre)
        with open(destino, 'wb') as fh:
            fh.write(adjunto.datos)
        guardados.append(storage.commit_output(session_id, salida))
    return guardados


def _recoger_adjuntos(parte, cuerpo, adjuntos: list[Adjunto]) -> None:
    """Todo lo que no es el cuerpo elegido, recorriendo las partes anidadas.

    No vale `iter_attachments()` a secas: sólo mira el primer nivel, y las
    imágenes de un `multipart/related` se quedarían sin salir.
    """
    if parte is cuerpo:
        return
    tipo = parte.get_content_type()

    if tipo == 'message/rfc822':
        # Un correo reenviado como adjunto: sale entero como `.eml`, sin
        # abrirlo, que sus adjuntos son suyos.
        anidado = parte.get_content()
        nombre = parte.get_filename() or f'{_cabecera(anidado, "Subject") or "correo"}.eml'
        _anadir(adjuntos, nombre, tipo, anidado.as_bytes())
        return

    if parte.is_multipart():
        for subparte in parte.iter_parts():
            _recoger_adjuntos(subparte, cuerpo, adjuntos)
        return

    nombre = parte.get_filename()
    if (not nombre and parte.get_content_maintype() == 'text'
            and parte.get_content_disposition() != 'attachment'):
        # La otra versión del cuerpo: el texto plano de un correo en HTML.
        return
    _anadir(adjuntos, nombre, tipo, parte.get_payload(decode=True) or b'')


def _anadir(adjuntos: list[Adjunto], nombre: str | None, tipo: str, datos: bytes) -> None:
    nombre = nombre_seguro(nombre) if nombre else ''
    if not nombre or nombre == 'archivo':
        extension = mimetypes.guess_extension(tipo) or '.bin'
        nombre = f'adjunto-{len(adjuntos) + 1}{extension}'

    # Dos adjuntos con el mismo nombre saldrían iguales en la lista de
    # resultados, y al bajarlos en ZIP uno pisaría al otro.
    usados = {adjunto.nombre.lower() for adjunto in adjuntos}
    raiz, extension = os.path.splitext(nombre)
    numero = 2
    while nombre.lower() in usados:
        nombre = f'{raiz}-{numero}{extension}'
        numero += 1
    adjuntos.append(Adjunto(nombre, tipo, datos))


def _cabecera(mensaje, clave: str) -> str:
    try:
        valor = mensaje.get(clave)
    except Exception:
        # Una cabecera mal formada no debe tumbar el correo entero.
        return ''
    if not valor:
        return ''
    texto = str(valor)
    if '�' in texto:
        texto = _cabecera_sin_codificar(mensaje, clave) or texto
    return ' '.join(texto.split())


def _cabecera_sin_codificar(mensaje, clave: str) -> str:
    """Una cabecera con tildes metidas a pelo, sin la codificación `=?…?=`.

    Lo prohíbe el estándar pero lo hacen programas viejos, y `email` deja
    entonces un `�` por cada letra. El valor crudo aún guarda los bytes: se leen
    como UTF-8 y, si no lo son, como la página de códigos de Windows, igual que
    `markdown_a_pdf._leer`.
    """
    for nombre, crudo in mensaje.raw_items():
        if nombre.lower() == clave.lower():
            octetos = crudo.encode('utf-8', 'surrogateescape')
            for codificacion in ('utf-8', 'cp1252'):
                try:
                    return octetos.decode(codificacion)
                except UnicodeDecodeError:
                    continue
    return ''


def _fecha(valor: str) -> str:
    """La fecha como la escribiríamos aquí; si no se entiende, tal cual venía."""
    if not valor:
        return ''
    try:
        return parsedate_to_datetime(valor).strftime('%d/%m/%Y %H:%M (%z)')
    except (TypeError, ValueError):
        return valor


def _texto(parte) -> str:
    try:
        return parte.get_content()
    except (LookupError, UnicodeError):
        # Un juego de caracteres que Python no conoce o que miente: mejor unas
        # letras raras que quedarse sin el correo.
        crudo = parte.get_payload(decode=True) or b''
        return crudo.decode('utf-8', errors='replace')


def _escapar(texto: str) -> str:
    """Lo justo para que un nombre o un asunto no se lean como Markdown o HTML.

    `Ana <ana@x.es>` se leería como una etiqueta HTML y desaparecería del PDF.
    """
    for caracter in ('\\', '<', '>', '*', '_', '[', ']', '`'):
        texto = texto.replace(caracter, '\\' + caracter)
    return texto


def _tamano(octetos: int) -> str:
    if octetos < 1024:
        return f'{octetos} B'
    if octetos < 1024 * 1024:
        return f'{octetos / 1024:.0f} KB'
    return f'{octetos / 1024 / 1024:.1f} MB'.replace('.', ',')
