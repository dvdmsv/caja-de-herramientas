#!/usr/bin/env python3
"""Pasada por todas las herramientas contra una instalación en marcha.

Es la comprobación que los tests de `backend/tests/` no pueden hacer: allí no
hay OCR, ni LibreOffice, ni WeasyPrint, ni los tres servicios repartiéndose el
trabajo. Aquí se llama a la API de verdad, como lo haría el navegador.

    docker compose up -d --build
    python3 scripts/barrido.py                    # contra http://localhost:8081
    BASE=http://192.168.1.103:8081 python3 scripts/barrido.py

Devuelve 0 si todo responde y 1 en cuanto algo falla, para poder ponerlo en la
integración continua.

Los archivos de prueba los fabrica con PyMuPDF y Pillow. Si no están instalados
aquí —que es lo normal fuera del backend—, los fabrica **dentro de la imagen**,
que sí los lleva. Así esto se puede lanzar desde cualquier sitio que alcance la
API y tenga Docker.
"""
import subprocess
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get('BASE', 'http://localhost:8081').rstrip('/')
SESION = uuid.uuid4().hex
FALLOS = []


def peticion(metodo, ruta, cuerpo=None, archivo=None, cabeceras=None):
    cab = {'X-Session-Id': SESION, **(cabeceras or {})}
    if archivo:
        frontera = '----barrido'
        with open(archivo, 'rb') as fichero:
            datos = fichero.read()
        cuerpo_bytes = (
            f'--{frontera}\r\nContent-Disposition: form-data; name="files"; '
            f'filename="{os.path.basename(archivo)}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + datos + \
            f'\r\n--{frontera}--\r\n'.encode()
        cab['Content-Type'] = f'multipart/form-data; boundary={frontera}'
    else:
        cuerpo_bytes = json.dumps(cuerpo).encode() if cuerpo is not None else None
        cab['Content-Type'] = 'application/json'
    pet = urllib.request.Request(BASE + ruta, data=cuerpo_bytes, headers=cab, method=metodo)
    try:
        with urllib.request.urlopen(pet, timeout=300) as respuesta:
            return respuesta.status, respuesta.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def texto_del_error(cuerpo):
    try:
        return json.loads(cuerpo).get('error', '')
    except Exception:
        return cuerpo[:120].decode('utf-8', 'replace')


def comprobar(nombre, condicion, detalle=''):
    print(f"  {'✓' if condicion else '✗'} {nombre}" + (f'  — {detalle}' if detalle else ''))
    if not condicion:
        FALLOS.append(nombre)


def prueba(nombre, ruta, cuerpo=None, metodo='POST', espera=(200, 201)):
    codigo, respuesta = peticion(metodo, ruta, cuerpo)
    detalle = ''
    if codigo in espera and respuesta[:1] == b'{':
        datos = json.loads(respuesta)
        if 'files' in datos:
            detalle = f"{len(datos['files'])} archivo(s)"
    comprobar(nombre, codigo in espera, detalle or f'{codigo} {texto_del_error(respuesta)[:70]}')


def material(carpeta):
    """Fabrica los archivos de prueba: un PDF con todo dentro, una imagen y texto.

    Con PyMuPDF a mano, aquí mismo. Si no está —que es lo normal fuera del
    backend—, se ejecuta **la misma función** dentro de la imagen, que sí lo
    lleva: se manda su propio código fuente. Así esto corre desde cualquier
    sitio que alcance la API y tenga Docker, y lo que se prueba está escrito una
    sola vez.
    """
    try:
        import fitz  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        import inspect
        import textwrap

        cuerpo = textwrap.dedent(inspect.getsource(_fabricar).split('\n', 1)[1])
        receta = 'import sys\ncarpeta = sys.argv[1]\n' + cuerpo
        imagen = os.environ.get('IMAGEN', 'merge-pdf-backend')
        hecho = subprocess.run(['docker', 'run', '--rm', '-v', f'{carpeta}:{carpeta}', imagen,
                                'python', '-c', receta, carpeta],
                               capture_output=True, text=True)
        if hecho.returncode != 0:
            raise SystemExit('No se han podido fabricar los archivos de prueba dentro de '
                             f'la imagen «{imagen}»:\n{hecho.stderr[-600:]}')
        return
    _fabricar(carpeta)


def _fabricar(carpeta):
    import fitz
    from PIL import Image

    documento = fitz.open()
    for numero in range(4):
        pagina = documento.new_page()
        pagina.insert_text((72, 100), f'Memoria de ejemplo · página {numero + 1}', fontsize=14)
        pagina.insert_image(fitz.Rect(72, 200, 272, 350),
                            pixmap=fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 220)))
    documento[0].insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(72, 150, 250, 170), 'page': 3})
    campo = fitz.Widget()
    campo.field_name = 'firmante'
    campo.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    campo.rect = fitz.Rect(72, 400, 300, 425)
    campo.field_value = 'Ana Ejemplo'
    documento[1].add_widget(campo)
    documento.set_toc([[1, 'Inicio', 1], [1, 'Cuentas', 4]])
    documento.set_metadata({'title': 'Memoria de ejemplo', 'author': 'Ana Ejemplo'})
    documento.save(f'{carpeta}/memoria.pdf', deflate=True)
    documento.close()

    # Una página de tamaño cartel: a 150 ppp se pasa del tope de megapíxeles.
    cartel = fitz.open()
    cartel.new_page(width=5000, height=5000).insert_text((100, 100), 'cartel', fontsize=48)
    cartel.save(f'{carpeta}/cartel.pdf')
    cartel.close()

    Image.new('RGB', (900, 700), (140, 170, 210)).save(f'{carpeta}/foto.jpg', quality=90)
    with open(f'{carpeta}/texto.txt', 'w', encoding='utf-8') as fichero:
        fichero.write('Título\n\nPárrafo de prueba con acentos: ñ á é.\n')
    with open(f'{carpeta}/notas.md', 'w', encoding='utf-8') as fichero:
        fichero.write('# Título\n\nPárrafo **en negrita**:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')


def subir(ruta):
    codigo, cuerpo = peticion('POST', '/api/files', archivo=ruta)
    if codigo != 201:
        raise SystemExit(f'No se ha podido subir {ruta}: {codigo} {texto_del_error(cuerpo)}')
    return json.loads(cuerpo)['files'][0]['id']


def main():
    carpeta = tempfile.mkdtemp(prefix='barrido-')
    material(carpeta)
    pdf, pdf2 = subir(f'{carpeta}/memoria.pdf'), subir(f'{carpeta}/memoria.pdf')
    cartel = subir(f'{carpeta}/cartel.pdf')
    foto = subir(f'{carpeta}/foto.jpg')
    txt = subir(f'{carpeta}/texto.txt')
    md = subir(f'{carpeta}/notas.md')

    print('\n=== PDF ===')
    prueba('unir-pdf', '/api/tools/unir-pdf', {'file_ids': [pdf, pdf2]})
    prueba('dividir-pdf', '/api/tools/dividir-pdf',
           {'file_ids': [pdf], 'modo': 'unico', 'paginas': '1,4'})
    prueba('organizar-pdf', '/api/tools/organizar-pdf',
           {'file_ids': [pdf], 'paginas': [{'numero': 4, 'giro': 90}, {'numero': 1, 'giro': 0}]})
    prueba('pdf-a-imagen', '/api/tools/pdf-a-imagen',
           {'file_ids': [pdf], 'formato': 'JPEG', 'ppp': 96, 'calidad': 85})
    prueba('pdf-a-imagen/formatos', '/api/tools/pdf-a-imagen/formatos', metodo='GET')
    prueba('comprimir-pdf', '/api/tools/comprimir-pdf',
           {'file_ids': [pdf], 'nivel': 'media', 'web': True})
    prueba('comparar-pdf', '/api/tools/comparar-pdf', {'file_ids': [pdf, pdf2]})
    prueba('aplanar-pdf', '/api/tools/aplanar-pdf',
           {'file_ids': [pdf], 'campos': True, 'anotaciones': True})
    prueba('proteger-pdf', '/api/tools/proteger-pdf',
           {'file_ids': [pdf], 'accion': 'proteger', 'password': 'clave1234', 'password_actual': ''})
    prueba('numerar-paginas', '/api/tools/numerar-paginas', {'file_ids': [pdf]})
    prueba('numerar/previsualizar', '/api/tools/numerar-paginas/previsualizar',
           {'file_ids': [pdf], 'pagina': 1})
    prueba('marca-de-agua', '/api/tools/marca-de-agua',
           {'file_ids': [pdf], 'modo': 'texto', 'texto': 'BORRADOR'})
    prueba('marca/previsualizar', '/api/tools/marca-de-agua/previsualizar',
           {'file_ids': [pdf], 'modo': 'texto', 'texto': 'X', 'pagina': 1})
    prueba('extraer-imagenes', '/api/tools/extraer-imagenes', {'file_ids': [pdf]})
    prueba('ocr-pdf', '/api/tools/ocr-pdf', {'file_ids': [pdf], 'idioma': 'spa'})
    prueba('visor/guardar', '/api/tools/visor/guardar',
           {'file_ids': [pdf],
            'subrayados': [{'pagina': 1, 'color': 'amarillo', 'rects': [[0.1, 0.1, 0.5, 0.15]]}]})
    prueba('files/paginas', f'/api/files/{pdf}/paginas', metodo='GET')

    print('\n=== Firma ===')
    prueba('crear-certificado', '/api/tools/crear-certificado',
           {'nombre': 'Ana Ejemplo', 'contrasena': 'clave1234', 'dias': 365})
    prueba('comprobar-firmas', '/api/tools/comprobar-firmas/inspeccionar', {'file_ids': [pdf]})

    print('\n=== Imágenes ===')
    prueba('comprimir-imagen', '/api/tools/comprimir-imagen',
           {'file_ids': [foto], 'calidad': 75, 'lado_maximo': 0})
    prueba('convertir-imagen', '/api/tools/convertir-imagen', {'file_ids': [foto], 'formato': 'PNG'})
    prueba('convertir/formatos', '/api/tools/convertir-imagen/formatos', metodo='GET')
    prueba('imagen-a-pdf', '/api/tools/imagen-a-pdf', {'file_ids': [foto]})
    prueba('generar-qr', '/api/tools/generar-qr', {'tipo': 'texto', 'texto': 'hola', 'formato': 'png'})

    print('\n=== Documentos ===')
    prueba('limpiar-metadatos/inspec', '/api/tools/limpiar-metadatos/inspeccionar', {'file_ids': [pdf]})
    prueba('limpiar-metadatos', '/api/tools/limpiar-metadatos',
           {'file_ids': [pdf], 'seleccion': {pdf: ['author']},
            'cambios': {pdf: {'title': 'Título nuevo'}}})
    prueba('a-markdown', '/api/tools/a-markdown', {'file_ids': [pdf]})
    prueba('markdown-a-pdf', '/api/tools/markdown-a-pdf', {'file_ids': [md]})
    prueba('documento-a-pdf', '/api/tools/documento-a-pdf', {'file_ids': [txt]})
    prueba('pdf-a-word', '/api/tools/pdf-a-word', {'file_ids': [pdf]})

    print('\n=== Lo que tiene que fallar ===')
    codigo, cuerpo = peticion('POST', '/api/tools/pdf-a-imagen',
                              {'file_ids': [cartel], 'formato': 'PNG', 'ppp': 150, 'calidad': 95})
    comprobar('una página imposible se rechaza con 413 y sus medidas',
              codigo == 413 and 'megapíxeles' in texto_del_error(cuerpo),
              f'{codigo} {texto_del_error(cuerpo)[:80]}')

    ruta_mentira = f'{carpeta}/mentira.pdf'
    with open(ruta_mentira, 'wb') as fichero:
        fichero.write(b'\xff\xd8\xff\xe0' + b'x' * 200)
    codigo, cuerpo = peticion('POST', '/api/files', archivo=ruta_mentira)
    comprobar('un JPEG disfrazado de PDF se rechaza al subirlo',
              codigo == 400 and 'JPEG' in texto_del_error(cuerpo),
              f'{codigo} {texto_del_error(cuerpo)[:80]}')

    print('\n=== Cuota ===')
    codigo, cuerpo = peticion('GET', '/api/session/uso')
    datos = json.loads(cuerpo) if codigo == 200 else {}
    comprobar('la sesión sabe lo que ocupa',
              codigo == 200 and datos.get('usado', 0) > 0 and datos.get('tope', 0) > 0,
              f"{datos.get('usado', 0) // 1024} kB de {datos.get('tope', 0) // 1024 // 1024} MB")

    peticion('DELETE', '/api/session')
    print()
    if FALLOS:
        print(f'{len(FALLOS)} FALLOS: ' + ', '.join(FALLOS))
        return 1
    print('Todo responde.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
