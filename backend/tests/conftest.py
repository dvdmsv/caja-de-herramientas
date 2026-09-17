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
        import storage
        importlib.reload(storage)
        import api.limites
        importlib.reload(api.limites)
        return config, storage
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
