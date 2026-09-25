"""Diagnóstico temporal: ¿por qué en Windows el mínimo de «Comprimir PDF» y la
compresión real difieren en un byte?

Comprime el mismo documento dos veces con el mismo paso, como hacen `/minimo` y
la herramienta, pero con nombres de salida distintos, y dice dónde difieren.
Se borrará cuando se sepa la causa.
"""
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from app import app  # noqa: E402
from api.tools import comprimir_pdf  # noqa: E402
from tests.test_comprimir_pdf import documento_pesado  # noqa: E402

carpeta = pathlib.Path(tempfile.mkdtemp())
origen = documento_pesado(carpeta / 'origen.pdf')
salidas = [carpeta / 'minimo.pdf', carpeta / 'un-nombre-bastante-mas-largo.pdf', carpeta / 'minimo2.pdf']
with app.test_request_context():
    for salida in salidas:
        comprimir_pdf._comprimir(str(origen), str(salida), comprimir_pdf.ESCALERA[-1], False)

datos = [s.read_bytes() for s in salidas]
print('tamaños:', [len(d) for d in datos])
for otro in datos[1:]:
    distinto = next((i for i, (x, y) in enumerate(zip(datos[0], otro)) if x != y), None)
    print('primer byte distinto:', distinto)
    if distinto is not None:
        print('  A:', datos[0][max(0, distinto - 120):distinto + 60])
        print('  B:', otro[max(0, distinto - 120):distinto + 60])
