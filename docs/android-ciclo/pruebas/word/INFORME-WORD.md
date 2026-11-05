# Pruebas independientes: PDF a Word Android

**14 pruebas: 13 pasan y 1 falla.** Un hallazgo nuevo de severidad media. Los DOCX probados son paquetes legibles y contienen texto y tablas editables reales. No se ha modificado el código del proyecto principal.

## Entorno y reproducción

Copia `/tmp/caja-ciclo/word`, Node 22.23.2, MuPDF.js 1.28.1, docx 9.5.1, Vitest 4.1.11. Segunda lectura con **python-docx 1.2.0**, lxml 6.1.3, Python 3.12; instalados sólo en `/tmp/caja-ciclo/word/python-reader`. No hay LibreOffice ni dispositivo Android disponibles.

```
cd /tmp/caja-ciclo/word
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/word-auditoria.test.ts
PYTHONPATH=/tmp/caja-ciclo/word/python-reader python3 lector-docx.py
```

Pruebas: `tests/local/word-auditoria.test.ts`; salida: `pruebas-word.log`. La suite genera los PDF en memoria. Guarda DOCX de muestra en `resultados/` para que el lector independiente compruebe ZIP, XML, texto, formato, tablas y dibujos. Resultado de la segunda lectura: `lector-docx.log`, termina en `LECTURA INDEPENDIENTE OK`.

Huellas SHA256:

- `pdf-a-word.ts`: `579a9bdac6730096a68ad99eedc3c213dbe601c92e9d80714e0c1e3694c26422`
- `estructura-pdf.ts`: `0baa1f20fcd7341a0b97626be4a1cdb7cc42e4964e23c76086a2f9b082c58404`

## W01 — Media: pierde el giro de las imágenes y deforma su proporción

Ubicación: `estructura-pdf.ts:87` ignora la matriz `_t` de `onImageBlock`; guarda el PNG original y el rectángulo transformado. `pdf-a-word.ts:29` aplica sólo ancho/alto del rectángulo, sin giro ni normalización del raster.

Reproducción: test `preserva orientación visual de imagen girada 90 grados`. PDF con imagen asimétrica 80×40 píxeles (mitad roja y mitad azul), pintada con matriz `0 80 -40 0 100 400`. El área visual de la imagen es vertical y sus mitades quedan arriba/abajo.

Esperado: conservar ese giro en Word, mediante píxeles ya transformados o transformación equivalente en OOXML.

Observado: el PNG de `word/media/` permanece horizontal 80×40, el `<a:xfrm>` no tiene `rot` y el documento asigna un rectángulo vertical (extent cx=504825, cy=1019175). Word estira la imagen sin girarla; las mitades siguen izquierda/derecha. Archivos concretos: `resultados/imagen-girada.pdf` y `resultados/imagen-girada.docx`.

Consecuencia compartida: cualquier conversor que reutilice los bytes de `estructuraPdf().imagenes` sin aplicar la matriz perderá también la orientación. Se ha demostrado en Word; no se afirma haber ejecutado EPUB/Markdown en esta tanda.

## Cobertura que pasa

1. ZIP DOCX, partes obligatorias y texto editable (`w:t`, `w:r`).
2. Español, acentos, ñ, interrogación y caracteres XML especiales.
3. Negrita, cursiva y tamaño de fuente, verificados también con python-docx.
4. Título y autor en propiedades.
5. Tabla OOXML editable, columnas correctas en rejilla simple; códigos y comas preservados como texto.
6. Imagen PNG incrustada junto al texto.
7. Salto de página explícito entre dos páginas originales.
8. Varios archivos y nombres correspondientes.
9. Rechazo de escaneado puro con indicación de OCR.
10. Rechazo de selección vacía, PDF corrupto y PDF protegido.
11. Rechazo del lote cuando falla el segundo archivo, sin devolver resultados parciales.
12. Todos los XML y relaciones generados se analizan con lxml; todos los ZIP pasan la comprobación CRC; python-docx abre las siete muestras.

## Límites y hallazgos anteriores

No se repiten T01/T02 de rejillas falsas y celdas combinadas: pertenecen al motor compartido y siguen pendientes. Esta tanda valida una tabla simple y no aprueba esos casos defectuosos. La validación de extensión conocida en T03 tampoco se cuenta como un hallazgo nuevo.

No se ha renderizado con Word/LibreOffice ni ejecutado en un teléfono; la comparación de orientación se fundamenta en los píxeles incrustados y la transformación OOXML, no en una captura de Word. No se ha probado fidelidad de diseños complejos, columnas, ecuaciones, listas, encabezados/pies, documentos de gran tamaño, cancelación de worker o presión de memoria Android. No equivale a paridad completa con pdf2docx de Windows.

La herramienta permanece sin aprobar. Conforme al plan del usuario, no se han implementado correcciones y el plan final de reparación se preparará cuando el agente principal termine de recorrer las 13 herramientas.
