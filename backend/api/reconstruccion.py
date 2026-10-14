"""Reconstruir un PDF que PyMuPDF lee pero no sabe volver a escribir.

El caso que lo trajo: una tabla de referencias (xref) **con huecos**. La sección
de un PDF sin actualizaciones tiene que ser una sola subsección desde el 0
(ISO 32000-1, 7.5.4), pero hay programas que la escriben a trozos y se dejan
números sin entrada, ni libres ni usados. MuPDF lo abre sin repararlo —para él
la xref está bien— y al leer convierte esos números en `null` sin decir nada.
Al **guardar** no: `pdf-write.c` recorre todos los números de objeto con
`pdf_cache_object`, que con una entrada vacía lanza «cannot find object in xref
(N 0 R)». Así que PyMuPDF 1.25.5 no puede guardar el archivo ni sin tocarlo, y
cualquier herramienta que lo reescriba falla en el último paso.

Lo arregla qpdf, por medio de pikepdf: lee los objetos que hay y escribe una
xref nueva y completa, sin cambiar lo que se dibuja. pikepdf ya está en la
imagen y en la aplicación de Windows; pypdf, que también lo haría, no.

Sin Flask y sin el almacén, como `comparacion.py`: entra una ruta y sale otra.
"""
import os
import tempfile


def reconstruir(origen: str, carpeta: str) -> str:
    """Reescribe `origen` con una xref nueva en un temporal de `carpeta`.

    Devuelve la ruta del temporal; borrarlo es cosa de quien llama. Si pikepdf
    no puede, no deja nada atrás y relanza su error.
    """
    # Dentro de la función, como en `pdf_a_pdfa.py`: así no lo carga el
    # maestro precargado y sólo lo paga quien llega a necesitarlo.
    import pikepdf

    descriptor, temporal = tempfile.mkstemp(suffix='.pdf', prefix='.reconstruido-', dir=carpeta)
    os.close(descriptor)
    try:
        with pikepdf.open(origen) as documento:
            documento.save(temporal)
    except BaseException:
        os.unlink(temporal)
        raise
    return temporal
