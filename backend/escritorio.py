"""Arranque de la aplicación de escritorio (Windows).

Es otro modo de arrancar el mismo backend, no otro backend: registra todo en un
proceso (`SERVICIO=todo`), como `python app.py`, y además sirve el Angular
compilado para que la ventana de Tauri lo cargue del mismo origen. Así las rutas
relativas `/api/...` del frontend siguen valiendo tal cual y no hace falta CORS.

Quien lo lanza es el envoltorio de Tauri (`escritorio/src-tauri`), que le pasa
el token y lee por la salida estándar la línea ``LISTO <puerto>``. También se
puede lanzar a mano para desarrollar: sin token, se inventa uno y escribe la URL
completa.

**Lo que cambia respecto a la web, y por qué:**

- **Un servidor en 127.0.0.1 no es privado.** Cualquier página abierta en el
  navegador del usuario puede mandarle peticiones, y cualquier programa del
  equipo también. Por eso todo exige el token (`proteger`), que llega una vez en
  la URL y desde ahí va en una cookie `SameSite=Strict`, y por eso se rechaza
  cualquier `Host` que no sea el nuestro: sin eso, una web con un dominio que
  resuelva a 127.0.0.1 (*DNS rebinding*) hablaría con el backend como si fuera
  del mismo origen.
- **waitress y no gunicorn**, que no funciona en Windows. Con un solo usuario no
  hace falta el reparto en procesos desechables de producción: lo que protegía
  a unos usuarios de otros aquí no tiene a quién proteger.
- **`--programa`**: el paquete de PyInstaller no trae los scripts de consola de
  ocrmypdf y pdf2docx, así que `api/conversion.py` llama a este mismo ejecutable
  para arrancarlos (ver `conversion.resolver`).
"""
import hmac
import importlib
import mimetypes
import multiprocessing
import os
import secrets
import sys

COOKIE = 'escritorio'
PARAMETRO = 't'


def carpeta_de_datos() -> str:
    """Dónde viven las subidas: `%LOCALAPPDATA%` en Windows, que es del usuario
    y no se sincroniza con OneDrive como sí haría la carpeta de Documentos."""
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~/.local/share')
    return os.path.join(base, 'merge-pdf')


def carpeta_del_frontend() -> str:
    """El Angular compilado: dentro del paquete, o el `dist` al desarrollar."""
    if os.environ.get('ESCRITORIO_FRONTEND'):
        return os.environ['ESCRITORIO_FRONTEND']
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'frontend')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', 'frontend', 'dist', 'merge-pdf', 'browser')


def carpeta_vendor() -> str | None:
    """Los programas externos que van en el instalador (`traer-dependencias.ps1`).

    Instalado, queda al lado de la carpeta del backend:
    `resources/backend/merge-pdf-backend.exe` y `resources/vendor/`. Fuera del
    paquete no hay vendor salvo que se diga con `ESCRITORIO_VENDOR`, y entonces
    se usan los programas del sistema, como en `python app.py`.
    """
    if os.environ.get('ESCRITORIO_VENDOR'):
        return os.path.abspath(os.environ['ESCRITORIO_VENDOR'])
    if getattr(sys, 'frozen', False):
        junto = os.path.join(os.path.dirname(sys.executable), '..', 'vendor')
        if os.path.isdir(junto):
            return os.path.abspath(junto)
    return None


def usar_vendor(vendor: str) -> None:
    """Le dice a cada programa externo dónde está lo suyo.

    - Tesseract y Ghostscript van **delante** en el PATH: ocrmypdf los busca por
      nombre, y si el usuario tiene otra versión instalada no debe ser ésa la
      que se use.
    - LibreOffice **no** va en el PATH: su carpeta `program` trae un `python.exe`
      propio que taparía cualquier otro. Se usa `RUTA_SOFFICE`.
    - WeasyPrint lee `WEASYPRINT_DLL_DIRECTORIES` al importarse, y fontconfig su
      `FONTCONFIG_FILE`, que sólo ve las letras del paquete.

    Con `setdefault`, salvo el PATH: quien lance el backend puede señalar otra
    cosa a propósito.
    """
    tesseract = os.path.join(vendor, 'tesseract')
    gs = os.path.join(vendor, 'gs', 'bin')
    os.environ['PATH'] = os.pathsep.join([tesseract, gs, os.environ.get('PATH', '')])
    os.environ.setdefault('TESSDATA_PREFIX', os.path.join(tesseract, 'tessdata'))
    os.environ.setdefault('RUTA_SOFFICE',
                          os.path.join(vendor, 'libreoffice', 'program', 'soffice.exe'))
    os.environ.setdefault('WEASYPRINT_DLL_DIRECTORIES', os.path.join(vendor, 'gtk', 'bin'))
    os.environ.setdefault('FONTCONFIG_FILE', os.path.join(vendor, 'fonts.conf'))


def proteger(app, token: str) -> None:
    """Que sólo la ventana de la aplicación pueda hablar con el backend.

    El `Host` permitido lo pone `main()` en `ESCRITORIO_HOST` cuando ya sabe el
    puerto; sin él (en los tests) no se comprueba.
    """
    from flask import abort, redirect, request

    @app.before_request
    def exigir_el_token():
        esperado = app.config.get('ESCRITORIO_HOST')
        if esperado and request.host != esperado:
            abort(403)

        # La primera carga trae el token en la URL: se cambia por la cookie y se
        # redirige a la URL limpia, para que no quede en el historial ni en lo
        # que el usuario copie de la barra.
        en_url = request.args.get(PARAMETRO, '')
        if en_url and hmac.compare_digest(en_url, token):
            argumentos = request.args.to_dict(flat=False)
            argumentos.pop(PARAMETRO)
            from urllib.parse import urlencode
            limpia = request.path + ('?' + urlencode(argumentos, doseq=True) if argumentos else '')
            respuesta = redirect(limpia)
            respuesta.set_cookie(COOKIE, token, httponly=True, samesite='Strict')
            return respuesta

        if not hmac.compare_digest(request.cookies.get(COOKIE, ''), token):
            abort(403)


def servir_frontend(app, carpeta: str) -> None:
    """Lo mismo que hace `frontend/nginx.conf`: el archivo si existe y, si no,
    `index.html`, que es quien resuelve las rutas de Angular."""
    from flask import abort, send_from_directory

    # Windows saca los tipos del registro, y ahí `.js` puede estar como
    # `text/plain` según lo que haya instalado; el navegador rechaza entonces
    # los módulos. Y `.mjs` —el worker de pdf.js— ni siquiera suele estar.
    mimetypes.add_type('text/javascript', '.js')
    mimetypes.add_type('text/javascript', '.mjs')
    mimetypes.add_type('text/css', '.css')
    mimetypes.add_type('font/woff2', '.woff2')

    carpeta = os.path.abspath(carpeta)

    @app.get('/', defaults={'ruta': ''})
    @app.get('/<path:ruta>')
    def frontend(ruta: str):
        if ruta.startswith('api/'):
            abort(404)
        if ruta and os.path.isfile(os.path.join(carpeta, ruta)):
            return send_from_directory(carpeta, ruta)
        return send_from_directory(carpeta, 'index.html')


def lanzar_programa(nombre: str, argumentos: list[str]) -> None:
    """Arranca ocrmypdf o pdf2docx como si fuera su script de consola."""
    from api.conversion import PROGRAMAS_DE_PYTHON

    modulo, funcion = PROGRAMAS_DE_PYTHON[nombre].split(':')
    sys.argv = [nombre, *argumentos]
    resultado = getattr(importlib.import_module(modulo), funcion)()
    sys.exit(resultado)


def preparar_entorno() -> tuple[str, bool]:
    """Los ajustes de escritorio, antes de que nada importe `config`.

    Con `setdefault`: quien lance el backend puede seguir cambiándolos por
    entorno, y los valores por defecto de la web no se tocan.
    """
    datos = carpeta_de_datos()
    os.environ['SERVICIO'] = 'todo'
    vendor = carpeta_vendor()
    if vendor:
        usar_vendor(vendor)
    os.environ.setdefault('UPLOAD_ROOT', os.path.join(datos, 'uploads'))
    # Los topes de la web reparten un servidor entre muchos; aquí el disco y la
    # memoria son del propio usuario, y un PDF escaneado de 400 MB es normal.
    os.environ.setdefault('MAX_CONTENT_LENGTH_MB', '2048')
    os.environ.setdefault('SESSION_QUOTA_MB', '20480')
    # Sin caducidad práctica mientras la ventana esté abierta: al cerrarla, la
    # propia aplicación borra la sesión.
    os.environ.setdefault('SESSION_TTL_MINUTES', str(7 * 24 * 60))
    token = os.environ.get('ESCRITORIO_TOKEN', '').strip()
    if token:
        return token, False
    token = secrets.token_urlsafe(32)
    os.environ['ESCRITORIO_TOKEN'] = token
    return token, True


def main(argv: list[str]) -> None:
    # Lo primero de todo: ocrmypdf reparte las páginas en procesos, y en un
    # ejecutable congelado cada uno arranca este mismo `main`. Sin esto, cada
    # proceso hijo volvería a arrancar el servidor entero.
    multiprocessing.freeze_support()

    if len(argv) >= 2 and argv[1] == '--programa':
        lanzar_programa(argv[2], argv[3:])
        return

    token, inventado = preparar_entorno()

    import logging

    from waitress import create_server

    from app import app

    servidor = create_server(app, host='127.0.0.1', port=0, threads=6,
                             max_request_body_size=app.config['MAX_CONTENT_LENGTH'])
    puerto = servidor.effective_port
    app.config['ESCRITORIO_HOST'] = f'127.0.0.1:{puerto}'

    # Es lo que espera Tauri para abrir la ventana. Si no se vacía el búfer,
    # la línea puede quedarse dentro hasta que se escriba otra cosa.
    print(f'LISTO {puerto}', flush=True)
    # La URL con el token sólo cuando lo lanza una persona a mano. Si viene de
    # Tauri no se escribe: el registro acaba en un archivo del disco.
    if inventado:
        logging.getLogger(__name__).info(
            'Abre http://127.0.0.1:%d/?%s=%s', puerto, PARAMETRO, token)
    servidor.run()


if __name__ == '__main__':
    main(sys.argv)
