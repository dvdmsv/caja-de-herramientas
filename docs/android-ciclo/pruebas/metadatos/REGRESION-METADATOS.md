# Regresión tras correcciones

Fuentes copiadas del principal a las copias aisladas el 30/10/2026; principal sin modificaciones del auditor.

- Correo: 12/12 pasan (/tmp/correo-regresion.txt).
- Markdown: 21/21 pasan (/tmp/markdown-regresion.txt). Se ajustó test de encabezado para aceptar negrita heredada válida, manteniendo comprobación de nivel y texto; no es pérdida de contenido.
- EPUB: 14/14 pasan (/tmp/epub-regresion.txt). La comprobación de texto después de página20 se reformuló como contrato/limitación Windows explícita (con_texto=false); no se presenta como límite corregido. Énfasis combinado sí corregido.
- Metadatos PDF: 10/10 pasan (/tmp/metadatos-regresion.txt). Limpieza profunda ya no falla al recorrer arrays y conserva texto visible en fixture simple.
- Exiv2 host original actualizado: 38/38 comprobaciones pasan (host/regresion.log).
- Nuevos contenedores: 13/13 pasan (host/contenedores.log, host/probar-contenedores.py).

Nuevos casos: GIF dos frames con duraciones100/200ms y bucle2, eliminación de comentario conservando frames/duraciones/bucle; no-op binario idéntico. XMP GIF en sub-bloques y disposición Adobe con trailer258bytes procesados. ICO tres entradas (dos PNG con EXIF/GPS/XMP/IPTC/comentario y un DIB): número/offsets válidos, GPS eliminado en ambas PNG, otros grupos conservados, píxeles exactos y DIB byte idéntico; no-op ICO idéntico.

No defectos nuevos en este corpus. Fuera de cobertura: fuzzing de contenedores corruptos, todas las variantes de EXIF/ICC, imágenes grandes y ejecución de estos últimos cambios en Android. Motor C++ se recompiló host con mismas fuentes Exiv2/Expat, no sustitutos. Informes originales se mantienen como historial de hallazgos, este documento registra su regresión.
