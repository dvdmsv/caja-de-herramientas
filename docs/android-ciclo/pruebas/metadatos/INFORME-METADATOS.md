# Auditoría aislada de metadatos

Copia /tmp/caja-ciclo/metadatos. Implementación TS/C++/Java y repo principal sin modificar. Fuentes C++ originales compiladas host en host/build/metadatos: Exiv2 0.28.9 y Expat2.9.0 de /tmp/caja-metadatos-build, nlohmannJSON3.12.0. Compilador clang++ NDK apuntando host Linux, libc++ del arnés qpdf, zlib host. No se ejecutaron binarios Android/ABI.

## Ejecuciones

PDF: ./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/metadatos-auditoria.test.ts
10 pruebas: 9 pasan y 1 falla. Log /tmp/metadatos-pdf-test-result.txt.

Imágenes: /home/david/Desarrollos/merge-pdf/backend/.venv/bin/python host/probar.py
32 comprobaciones: 28 pasan y 4 fallan. Log host/pruebas.log, detalle host/fixtures/resultados.json, fixtures/salidas en host/fixtures. Script imprime fallos en log y JSON; no usa exit no-cero para señalarlos.

## Hallazgos y plan de regresión final

M01 Alta funcional: limpieza profunda PDF lanza not a dict (array). PDF mínimo real con texto y XMP entra en recorrido xrefs de metadatos-pdf.ts; línea94 llama obj.delete('Metadata') indiscriminadamente, incluido objeto array. Distinto al fallo O01 ya registrado en quitarTextoInvisible. No se obtiene resultado. Comprobar tipo de objeto antes de operaciones de diccionario y ejecutar regresión PDF con distintos tipos indirectos; después repetir conservación de contenido y borrado profundo.

M02 Baja: no-op imagen reescribe JPEG y altera sus bytes. seleccion:[] sin cambios debería copiar, como backend _limpiar_imagen que hace shutil.copyfile; wrapper siempre llama setExifData/writeMetadata. Fixture JPEG con EXIF/GPS/XMP/IPTC/comentario reproduce comparación binaria diferente. Ejecutado backend _limpiar_imagen no-op sobre mismo JPEG: bytes idénticos confirmados. No se observó recomposición del scan JPEG en operaciones selectivas. Cortocircuitar sin cambios y verificar hash idéntico en formatos admitidos.

M03 Media: BMP y GIF no se pueden limpiar: Exiv2 responde Setting Exif metadata in BMP/GIF images is not supported, incluso sin EXIF. ICO válido se rechaza como tipo desconocido. Verificado ejecutando _limpiar_imagen real del backend sobre los mismos tres fixtures: BMP/GIF/ICO pasan; Pillow también confirma que las tres entradas son válidas. Windows los admite mediante Pillow y conserva/formatea salida según capacidades. Wrapper establece EXIF indiscriminadamente; resolver ruta apropiada para estos formatos manteniendo contrato, o informar explícitamente una limitación de formato. Añadir pruebas end-to-end para inspección, limpieza y no-op BMP/GIF/ICO; no habilitar promesa universal basada sólo en formatos soportados por Exiv2.

## Cobertura correcta

PDF inspección devuelve fecha legible, Unicode, id y XMP no editable. No-op byte idéntico. Borrado selectivo título conserva autor/XMP. Borrado total básico elimina Info/XMP sin perder texto. Edición Unicode con emoji y fecha válida; rechazo fecha imposible, borrar/editar simultáneo, valor >500 y tipo inválido a_fondo.

JPEG inspección reconoce EXIF cámara/software/autor, GPS, XMP, IPTC y comentario. Borrado selectivo de cada grupo conserva los restantes. Segmento JPEG desde SOS hasta final idéntico byte a byte: no recomprime. Eliminación total deja informe sin campos y mantiene scan. Autor Unicode José García 日本 se lee exactamente. PNG/WebP con EXIF/GPS limpian y conservan píxeles RGB. TIFF con autor/cámara limpia y conserva píxeles (fixture sin GPS por limitación de construcción Pillow). Resolución no alterada en fixtures.

## Limitaciones

O01 conocido sigue afectando a_fondo mediante quitarTextoInvisible; no se duplica diagnóstico ni se ha corregido. Nuevo M01 interrumpe el fixture, por lo que no se demuestra limpieza profunda completa. No probados documentos con formularios, adjuntos, JS, redacciones, cifrado o firmas previas; deberán formar corpus de regresión al corregir profundo. No se probaron HEIC/AVIF/RAW ni TIFF multipágina/animaciones GIF/WebP. Límite de 500 caracteres lo valida fachada TypeScript además del límite bytes nativo; no se registra como defecto que el nativo solo limite2000 bytes. No estrés cuotas ni cancelación proceso. Compatibilidad Android real/SELinux y alineación16KB fuera de ejecución host; compilación4ABI informada por padre. Sin cambios de catálogo, no se considera fallo de auditoría.
