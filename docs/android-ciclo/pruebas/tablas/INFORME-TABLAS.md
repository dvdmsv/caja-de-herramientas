# Pruebas independientes: extraer tablas Android

Resultado: **18 pruebas, 15 pasan y 3 fallan**. No aprobar todavía. No se ha modificado código del repositorio principal ni arreglado hallazgos.

## Entorno y reproducción

Copia aislada `/tmp/caja-ciclo/tablas`. Node 22.23.2, MuPDF.js 1.28.1, SheetJS 0.20.3, Vitest 4.1.11. Contraste real con PyMuPDF 1.27.2.2 (Python 3.12). Pruebas directas del motor en Node, no APK ni dispositivo Android.

```
cd /tmp/caja-ciclo/tablas
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/tablas-auditoria.test.ts
python3 referencia-pymupdf.py
```

La suite TypeScript es autónoma: genera sus PDF en memoria y puede copiarse a `frontend/tests/local` para regresión posterior. El contraste Python adicional usa los PDF adjuntos a este directorio. `pruebas-tablas.log` conserva el resultado completo; `referencia-pymupdf.log` conserva la respuesta del motor Windows.

SHA256 de lo revisado:

- `estructura-pdf.ts`: `0baa1f20fcd7341a0b97626be4a1cdb7cc42e4964e23c76086a2f9b082c58404`
- `extraer-tablas.ts`: `6755d6ee1437ba0496d39ffed6d0a7569d7a40a688d4b616856a23c962c8ca31`

## T01 — Alta: inventa una tabla a partir de ejes de gráfico

Código: `estructura-pdf.ts`, líneas 47–64. El grupo de segmentos conectados aporta coordenadas X/Y, pero el algoritmo construye todo su producto cartesiano sin comprobar que existan los cuatro bordes de cada celda. Las marcas de un eje cuentan como divisiones completas.

Reproducción: prueba `no inventa celdas a partir de ejes y marcas de grafico`, también `grafico.pdf`. Dos ejes, marcas cortas y cuatro etiquetas de un gráfico, sin ninguna celda cerrada.

Esperado: inspección `total: 0`; coincide con `find_tables()` de Windows, que devuelve `[]`.

Observado: inspección `total: 1`, permitiendo exportar una tabla inventada. Afecta todos los formatos y, al compartirse `estructuraPdf`, también las futuras conversiones que reutilicen sus tablas. Es especialmente relevante para datos financieros que se interpretan como filas/columnas sin advertencia.

## T02 — Media: desplaza la cabecera de una celda combinada

Código: `estructura-pdf.ts`, líneas 49–59 y `dentro()` líneas 13–15. Se extiende el borde interior de la segunda fila a la primera; el texto se asigna por su centro a una de las dos celdas artificiales.

Reproducción: `respeta texto largo en celda combinada sin desplazarlo a otra columna`, también `combinada.pdf`. Primera fila combinada de 200 puntos, segunda fila con dos celdas; cabecera centrada.

Esperado: primera fila `['Cabecera combinada muy larga', '']`; Windows extrae `['Cabecera combinada muy larga', None]`, que su adaptador convierte a cadena vacía.

Observado: primera celda vacía y texto desplazado a la segunda. No conserva la estructura de las celdas combinadas. El fallo aparece aunque todos los caracteres sí sobrevivan.

## T03 — Baja: no aplica el contrato de extensión PDF

Código: `extraer-tablas.ts`, líneas 14–18. Sólo comprueba que haya entrada y abre bytes con `abrirPdf`.

Reproducción: `rechaza archivo no PDF por extension`, PDF válido llamado `documento.txt`.

Esperado: rechazar como hace `_documento()` en `backend/api/tools/extraer_tablas.py` cuando `record.ext != '.pdf'`.

Observado: genera XLSX. Es diferencia de validación/contrato, no corrupción ni vulnerabilidad demostrada.

## Cobertura positiva

- Rejilla simple, inspección y extracción coherentes.
- Dos tablas independientes en una página.
- Texto alineado sin rejilla y marco simple descartados.
- Rotaciones 90/180/270 coinciden con Windows.
- XLSX con códigos como texto e importes españoles como números.
- CSV con BOM, punto y coma, comillas y CRLF.
- Markdown con caracteres especiales escapados.
- Números negativos, moneda, porcentajes y códigos preservados.
- Factura de cuatro columnas, cinco filas y recuadro adicional.
- Formato desconocido y PDF corrupto rechazados.

La rotación cambia el orden de filas/columnas porque cambia la disposición visual. La primera versión del test esperaba el orden sin rotación; contrastado con Windows, ambos motores devuelven el mismo orden rotado. Se corrigió la expectativa del test y **no se registra como defecto Android**.

## Limitaciones

No se han probado interfaz, /inspeccionar HTTP, APK, cancelación del worker, memoria real en teléfono, documentos de 300 tablas ni todos los formatos de líneas discontinuas o celdas combinadas. La herramienta sigue sin habilitarse y las rutas pendientes eran conocidas; no se duplican como hallazgos. No se ha probado todavía toda la reconstrucción de párrafos/listas/encabezados de `markdownEstructurado`, fuera del alcance de esta tanda de tablas.

Las correcciones y su plan final se reservan para la fase acordada tras recorrer las 13 herramientas.
