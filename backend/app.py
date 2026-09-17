"""Punto de entrada de la API. Gunicorn usa el objeto ``app`` de este módulo.

La misma imagen sirve para tres papeles distintos, y los elige ``SERVICIO``:

- ``web``: subidas, descargas, ZIP, renombrado y sesión. No registra las
  herramientas, así que no carga PyMuPDF ni pyHanko. Es el único que barre las
  sesiones caducadas.
- ``ligeros``: las rutas auxiliares baratas (vistas previas, inspecciones,
  formatos, QR…).
- ``pesados``: el trabajo de verdad, cada petición en un proceso desechable.

``ligeros`` y ``pesados`` registran exactamente lo mismo: quién atiende qué lo
decide nginx por la ruta. Lo que los diferencia es la configuración de gunicorn
con la que arrancan (``gunicorn.trabajos.conf.py``) y su tope de memoria.

Sin ``SERVICIO`` se registra todo en un proceso (``todo``), que es lo que hace
falta para ``python app.py`` en desarrollo. Eso **no** representa producción: ahí
no hay aislamiento ninguno entre una petición y la siguiente.
"""
import logging
import os
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

import config
from api import files
from errors import ApiError, register_error_handlers
from storage import storage, start_cleanup_thread

SERVICIOS = ('todo', 'web', 'ligeros', 'pesados')


def servicio_pedido(nombre: str | None = None) -> str:
    """Qué papel toca, con aviso y respaldo si viene algo que no existe.

    Igual que con las variables numéricas de `config.py`: una errata no debe
    dejar el servidor sin arrancar, pero tampoco pasar desapercibida.
    """
    elegido = (nombre or os.environ.get('SERVICIO') or 'todo').strip().lower()
    if elegido not in SERVICIOS:
        print(f'Aviso: SERVICIO={elegido!r} no existe; se registra todo. '
              f'Valores válidos: {", ".join(SERVICIOS)}.', file=__import__('sys').stderr)
        return 'todo'
    return elegido


def create_app(servicio: str | None = None) -> Flask:
    papel = servicio_pedido(servicio)

    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
    app.config['SERVICIO'] = papel

    # En producción el frontend se sirve tras el mismo nginx, así que CORS sólo
    # hace falta para el `ng serve` de desarrollo.
    CORS(app, expose_headers=['Content-Disposition'])

    register_error_handlers(app)

    if papel in ('todo', 'web'):
        app.register_blueprint(files.bp)

    if papel in ('ligeros', 'pesados'):
        # Una petición que ha esperado demasiado en la cola se descarta antes de
        # empezar: trabajar para quien ya se ha ido sólo hace esperar más al
        # siguiente. La cabecera la pone nginx; sin ella (desarrollo) no se
        # descarta nada.
        from api import limites

        @app.before_request
        def descartar_si_es_vieja():
            edad = limites.edad_peticion(request.headers.get('X-Request-Start'), time.time())
            if edad is not None and edad > limites.EDAD_MAXIMA_PETICION:
                app.logger.info('Petición descartada tras %.0f s en la cola.', edad)
                raise ApiError('El servidor está saturado y tu petición ha esperado '
                               'demasiado. Vuelve a intentarlo.', 503)

    if papel in ('todo', 'ligeros', 'pesados'):
        # Importado aquí dentro: `web` no debe cargar las herramientas ni lo que
        # arrastran. Con el import arriba, las cargaría igual sin usarlas.
        from api import tools
        tools.register(app)

    @app.get('/api/health')
    def health():
        return jsonify({'status': 'ok', 'servicio': papel})

    # La limpieza vive sólo en `web`, y por dos razones: una, que con varios
    # servicios barriendo el mismo volumen sobran dos; y otra, que los servicios
    # de trabajo arrancan con `preload_app`, donde el hilo nacería en el maestro
    # y no sobreviviría al fork de cada petición.
    if papel in ('todo', 'web'):
        start_cleanup_thread(storage, config.CLEANUP_INTERVAL_SECONDS, app.logger)

    app.logger.info('Servicio "%s" listo con %d rutas.', papel,
                    len(list(app.url_map.iter_rules())))
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
