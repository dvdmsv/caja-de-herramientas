"""Fabrica las muestras de la prueba en teléfono (las de scripts/barrido.py y un escaneado).

Uso, con el entorno del backend:  backend/.venv/bin/python frontend/tests/telefono/muestras.py
"""
import pathlib, shutil, sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / 'scripts'))
import barrido  # noqa: E402
import fitz  # noqa: E402

destino = pathlib.Path(__file__).parent / 'muestras'
destino.mkdir(exist_ok=True)
barrido._fabricar(str(destino))
shutil.copy(RAIZ / 'frontend/tests/local/fixtures/markdown/real.docx', destino)

# Un escaneado de verdad: cada página es una imagen de 25 renglones conocidos,
# para medir el OCR contando los que salen exactos.
escaneado = fitz.open()
for i in range(40):
    texto = fitz.open(); p = texto.new_page()
    for k in range(25):
        p.insert_text((60, 80 + k * 28), f'Línea {k + 1} de la página {i + 1}: informe escaneado de prueba.', fontsize=12)
    q = escaneado.new_page(); q.insert_image(q.rect, pixmap=p.get_pixmap(dpi=150, colorspace=fitz.csGRAY))
escaneado.save(destino / 'escaneado.pdf', deflate=True)
print('muestras en', destino)
