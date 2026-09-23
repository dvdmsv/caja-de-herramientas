"""El conversor de markitdown, uno para todo el proceso.

Vive aparte porque lo usan "Documento a Markdown" y la lectura de correos
(`correo.py`), y cada instancia de más costaría su propia memoria.
"""
import io
import threading

_convertidor = None
_candado = threading.Lock()


def markitdown():
    """El conversor, construido la primera vez que alguien lo pide.

    Importar markitdown cuesta unos 120 MB de memoria porque arrastra
    onnxruntime para detectar tipos de archivo. Quien no use estas herramientas
    no debería pagar ese precio: hasta la primera conversión el backend se queda
    en unos 70 MB, y quien la use la paga una vez.

    Los plugins van desactivados a propósito: aquí no hay ninguno instalado y
    habilitarlos sólo abriría la puerta a ejecutar código de terceros.
    """
    global _convertidor
    with _candado:
        if _convertidor is None:
            from markitdown import MarkItDown
            _convertidor = MarkItDown(enable_plugins=False)
    return _convertidor


def html_a_markdown(html: str) -> str:
    """Un trozo de HTML en Markdown, con el mismo conversor que los archivos."""
    from markitdown import StreamInfo

    resultado = markitdown().convert_stream(
        io.BytesIO(html.encode('utf-8')),
        stream_info=StreamInfo(extension='.html', mimetype='text/html', charset='utf-8'))
    return getattr(resultado, 'text_content', '') or ''
