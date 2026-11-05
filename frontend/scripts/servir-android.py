"""Servidor de pruebas: sólo los assets de la APK y el fallback del router, sin API."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1] / 'dist/android/browser'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.send_error(503, 'No hay backend en las pruebas Android')
            return
        if not Path(self.translate_path(self.path)).is_file():
            self.path = '/index.html'
        super().do_GET()


ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
