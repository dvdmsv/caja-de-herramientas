"""Leer un correo `.eml`: lo que comparten "Documento a Markdown" y "Correo a PDF".

markitdown no entiende el `.eml`: lo trata como texto plano y devuelve el
mensaje en crudo, con el asunto en `=?utf-8?q?…?=`, las fronteras MIME, el
quoted-printable y los adjuntos en base64. Lo lee el paquete `email` de la
biblioteca estándar, que con `policy.default` ya deshace todas esas
codificaciones y los juegos de caracteres.

El cuerpo se prefiere en HTML, que es el que trae las negritas, las listas y las
tablas, y se pasa a Markdown con el mismo conversor que los demás documentos. Si
sólo hay texto plano, va tal cual.

Los adjuntos se nombran en el documento **y** se entregan como archivos
sueltos: un correo suele ser sobre todo lo que trae adjunto, y así se pueden
pasar a otra herramienta sin salir de la aplicación. Las imágenes incrustadas en
el HTML (`cid:`) salen también como adjuntos: el PDF no las pinta.
"""
import email
import mimetypes
import os
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


def leer(ruta: str, nombre: str) -> Correo:
    try:
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
