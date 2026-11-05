# Ciclo de las 13 herramientas — fase final

Se completó la implementación inicial de las trece herramientas en el orden acordado.
Cada bloque tuvo revisión independiente en copias aisladas. Después se recogieron
los planes de corrección y se aplicaron los arreglos en el proyecto principal.

| Bloque | Implementación y regresión |
|---|---|
| Compresión | MuPDF + qpdf en cuatro ABI. Máscaras, avisos, fuentes reproducibles y medición del tamaño final corregidos. |
| Correo | EML/MSG; destinatarios, validación y nombres de adjuntos corregidos. 12/12 regresiones. |
| Metadatos | PDF profundo + Exiv2; GIF animado y contenedores ICO conservados. PDF 10/10, imágenes 38/38, contenedores 13/13. |
| Tablas | CSV/XLSX/JSON/Markdown; gráficos falsos y celdas combinadas corregidos. 18/18. |
| EPUB | EPUB3, estilos y capítulos. 14/14; mantiene inspección de 20 páginas de Windows. |
| Markdown | CSV codificado, estilos/listas DOCX y orden PPTX corregidos. 21/21. |
| Word | DOCX editable e imágenes orientadas. 14/14. |
| OCR | Tesseract WASM spa/eng local. Corregida pérdida de contenido al rehacer; regresión visual y textual independiente. |
| PDF/A | Ghostscript 1b/2b. Restauración de texto Unicode después de transparencias: 8/8 y 8/8 conformes veraPDF. |
| Verificar firmas | PDFBox/BC. Integridad independiente de vigencia y diagnóstico de manipulación corregidos. 20/20. |
| Firma digital | PKCS12 y puente KeyChain. Sello PNG corregido; cuatro giros, segunda firma y anotación previa pasan en Android. |
| Marca temporal | Fecha local y RFC3161. Año cero corregido; preflight DocMDP/FieldMDP: 17 escenarios y 175 controles pasan. |
| Office | LibreOfficeKit, once formatos probados en emulador Android 30. Cancelación real; filtro de red ampliado: sendmsg/sendmmsg/sendto bloqueados y 11 formatos vuelven a pasar. |

El catálogo incorpora las 39 herramientas para la regresión integrada.
Pruebas Angular: 371/371. Pruebas de motor locales: 191 aprobadas. Ocho pruebas de integración
PDF/A se omiten sin motores externos y pasan al ejecutar con Ghostscript/veraPDF.
Interfaz móvil: 22 pruebas aprobadas en vertical y horizontal. La compilación Java/Android pasa.
Hallazgos del ciclo corregidos y regresiones aprobadas. La distribución 0.7.0
incluye APK debug instalable, AAB sin firmar, fuentes, licencias y huellas.

## Evidencia y alcance

Informes y planes en `pruebas/`. Las evidencias completas de emulador, JVM,
Chromium, pyHanko y veraPDF están en los directorios `/tmp/caja-ciclo/` citados.
Las pruebas portables añadidas al repositorio están en `frontend/tests/local`.
KeyChain software probado mediante instalación de PKCS12 y selector real de Android;
firma válida y apariencia visible. WebView 83 del emulador muestra correctamente
el aviso de actualización; la interfaz Angular completa se probó en Chromium,
no en ese WebView antiguo. No se han probado teléfonos físicos ni claves hardware.
El visor y las limitaciones anteriores de las otras 26 herramientas no se
presentan como paridad completa; véase `docs/paridad-android.md`.

> **Después de este ciclo**: el 5 de noviembre de 2026 se probó la APK en un
> teléfono físico. Ver [`telefono-2026-11-05.md`](telefono-2026-11-05.md).
