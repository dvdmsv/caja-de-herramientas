"""Andamiaje de los tests del backend.

Todo corre sobre un `uploads` temporal y con la configuración puesta por
variables de entorno **antes** de importar la aplicación: `config.py` las lee al
importarse, así que cambiarlas después no tendría efecto.

Nada de esto toca OCR, LibreOffice ni WeasyPrint: son lentos y necesitan la
imagen. Esas herramientas se comprueban con la pasada manual contra el
contenedor.
"""
import importlib
import os
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if RAIZ not in sys.path:
    sys.path.insert(0, RAIZ)


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    """Configura la aplicación para el test y devuelve los módulos recargados.

    Se usa así:

        modulos = entorno(SESSION_QUOTA_MB='1')
    """
    def preparar(**variables):
        monkeypatch.setenv('UPLOAD_ROOT', str(tmp_path / 'uploads'))
        for nombre, valor in variables.items():
            monkeypatch.setenv(nombre, str(valor))

        import config
        importlib.reload(config)

        # `api.limites` guarda sus topes en constantes de módulo, así que hay
        # que recargarlo para que lea la configuración nueva.
        import api.limites
        importlib.reload(api.limites)

        # El almacén **no** se recarga: se reconfigura la instancia que ya
        # existe. Recargar el módulo crearía otra, y las herramientas seguirían
        # usando la de antes —guardan la referencia al importarse—, así que el
        # test escribiría en una carpeta y la herramienta leería en otra.
        import storage as modulo_storage
        modulo_storage.storage.root = os.path.abspath(config.UPLOAD_ROOT)
        modulo_storage.storage.ttl_seconds = config.SESSION_TTL_SECONDS
        os.makedirs(modulo_storage.storage.root, exist_ok=True)
        return config, modulo_storage
    return preparar


@pytest.fixture
def almacen(entorno):
    """Un `Storage` recién hecho sobre la carpeta temporal."""
    def preparar(**variables):
        config, storage = entorno(**variables)
        return storage.Storage(config.UPLOAD_ROOT, config.SESSION_TTL_SECONDS)
    return preparar


SESION = 'a' * 32


def subida(contenido: bytes, nombre: str = 'documento.pdf'):
    """Un archivo como el que llega de un formulario."""
    import io

    from werkzeug.datastructures import FileStorage
    return FileStorage(stream=io.BytesIO(contenido), filename=nombre)
