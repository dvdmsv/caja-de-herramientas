"""Diagnóstico temporal: ¿por qué en Windows el mínimo de «Comprimir PDF» y la
compresión real difieren a veces en un byte?

Comprime el mismo documento muchas veces con el mismo paso, como hacen
`/minimo` y la herramienta, y si algún tamaño sale distinto enseña **todas** las
zonas donde cambian los bytes, no sólo la primera: el identificador `/ID`
cambia siempre y no es lo que se busca. Se borrará cuando se sepa la causa.
"""
import difflib
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from app import app  # noqa: E402
from api.tools import comprimir_pdf  # noqa: E402
from tests.test_comprimir_pdf import documento_pesado  # noqa: E402

VECES = 20

carpeta = pathlib.Path(tempfile.mkdtemp())
origen = documento_pesado(carpeta / 'origen.pdf')
salidas = []
with app.test_request_context():
    for vez in range(VECES):
        salida = carpeta / f'intento-{vez}.pdf'
        comprimir_pdf._comprimir(str(origen), str(salida), comprimir_pdf.ESCALERA[-1], False)
        salidas.append(salida.read_bytes())

tamanos = [len(datos) for datos in salidas]
print('tamaños:', sorted(set(tamanos)), 'en', VECES, 'intentos')
if len(set(tamanos)) > 1:
    a = salidas[0]
    b = next(datos for datos in salidas if len(datos) != len(a))
    comparador = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for operacion, a1, a2, b1, b2 in comparador.get_opcodes():
        if operacion != 'equal':
            print(f'{operacion} en {a1}:')
            print('  A:', a[max(0, a1 - 60):a2 + 20])
            print('  B:', b[max(0, b1 - 60):b2 + 20])
