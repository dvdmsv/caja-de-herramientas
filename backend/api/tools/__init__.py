"""Registro de herramientas.

Para añadir una herramienta nueva: crea un módulo en esta carpeta que exponga un
Blueprint llamado ``bp`` con ``url_prefix='/api/tools'`` e inclúyelo en la lista
de abajo. No hay que tocar nada más ni en el arranque ni en nginx.
"""
from api.tools import (a_markdown, aplanar_pdf, comparar_pdf, comprimir_imagen, comprimir_pdf,
                       comprobar_firmas, convertir_imagen, crear_certificado, dividir_pdf,
                       documento_a_pdf, extraer_imagenes, firmar, firmar_certificado, generar_qr,
                       imagen_a_pdf, limpiar_metadatos, marca_de_agua, markdown_a_pdf,
                       numerar_paginas, ocr_pdf, organizar_pdf, pdf_a_imagen, pdf_a_word,
                       proteger_pdf, unir_pdf, visor)

BLUEPRINTS = [
    unir_pdf.bp,
    pdf_a_imagen.bp,
    comprimir_pdf.bp,
    comprimir_imagen.bp,
    convertir_imagen.bp,
    imagen_a_pdf.bp,
    firmar.bp,
    a_markdown.bp,
    documento_a_pdf.bp,
    pdf_a_word.bp,
    markdown_a_pdf.bp,
    dividir_pdf.bp,
    organizar_pdf.bp,
    proteger_pdf.bp,
    aplanar_pdf.bp,
    comparar_pdf.bp,
    ocr_pdf.bp,
    marca_de_agua.bp,
    numerar_paginas.bp,
    extraer_imagenes.bp,
    limpiar_metadatos.bp,
    generar_qr.bp,
    firmar_certificado.bp,
    comprobar_firmas.bp,
    crear_certificado.bp,
    visor.bp,
]


def register(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp)
