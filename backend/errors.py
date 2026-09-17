"""Errores de API con una forma de respuesta homogénea para todas las herramientas."""
import errno

from flask import jsonify
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge


class ApiError(Exception):
    """Error esperado: se traduce a una respuesta JSON con su código."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def _handle_api_error(err: ApiError):
        return jsonify({'error': err.message}), err.status

    @app.errorhandler(RequestEntityTooLarge)
    def _handle_too_large(_err):
        limite_mb = app.config['MAX_CONTENT_LENGTH'] // (1024 * 1024)
        return jsonify({'error': f'Los archivos superan el límite de {limite_mb} MB.'}), 413

    @app.errorhandler(MemoryError)
    def _handle_memoria(_err):
        # Quedarse sin memoria no es un fallo del servidor: es que este archivo
        # no cabe aquí. Sin este manejador salía como un 500 genérico y el
        # usuario no sabía que el problema tenía solución (un archivo más
        # pequeño, menos resolución).
        app.logger.warning('Trabajo sin memoria suficiente; se responde 413.')
        return jsonify({'error': 'El archivo es demasiado grande o complejo para '
                                 'procesarlo en este servidor. Prueba con uno más '
                                 'pequeño o con menos resolución.'}), 413

    @app.errorhandler(OSError)
    def _handle_os(err: OSError):
        # Disco lleno, cuota agotada o archivo más grande de lo permitido: son
        # límites, no averías. El resto de errores del sistema sí son 500.
        if err.errno in (errno.EFBIG, errno.ENOSPC, errno.EDQUOT):
            app.logger.warning('Límite de almacenamiento alcanzado: %s', err)
            return jsonify({'error': 'El resultado no cabe en el espacio disponible. '
                                     'Prueba con un archivo más pequeño.'}), 413
        app.logger.exception('Error del sistema: %s', err)
        return jsonify({'error': 'Error interno del servidor.'}), 500

    @app.errorhandler(HTTPException)
    def _handle_http(err: HTTPException):
        return jsonify({'error': err.description}), err.code

    @app.errorhandler(Exception)
    def _handle_unexpected(err: Exception):
        # Las bibliotecas nativas no lanzan `MemoryError`: MuPDF dice «realloc
        # (… bytes) failed» y cada una tiene su frase. Eso no es una avería del
        # servidor, es un archivo que no cabe, y merece un 413 que se entiende.
        from api.limites import es_falta_de_memoria

        if es_falta_de_memoria(err):
            app.logger.warning('Trabajo sin memoria suficiente (%s); se responde 413.', err)
            return jsonify({'error': 'El archivo es demasiado grande o complejo para '
                                     'procesarlo en este servidor. Prueba con menos '
                                     'resolución o con un documento más pequeño.'}), 413

        app.logger.exception('Error no controlado: %s', err)
        return jsonify({'error': 'Error interno del servidor.'}), 500
