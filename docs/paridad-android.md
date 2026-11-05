# Paridad Android

Inventario generado con `python3 scripts/auditar-paridad-android.py`.

Evidencias persistentes: `docs/paridad-android-evidencias.json` (no se sobrescriben al regenerar).

Habilitada no significa paridad: cada opción, formato y operación auxiliar necesita evidencia.

La columna «Teléfono» es lo que se hizo en un teléfono físico (OnePlus 6, Android 15 con LineageOS 22.2 y WebView 155, el 5 de noviembre de 2026), casi siempre con las opciones de serie, y comprobando aparte el archivo que salió. No sustituye a probar cada opción.

| Herramienta | Estado | Teléfono | Contratos específicos |
|---|---|---|---|
| unir-pdf | parcial; verificar opciones | Dos PDF sin formularios; uno con formulario se rechaza (limitación conocida). | `POST /api/tools/unir-pdf` |
| pdf-a-imagen | parcial; verificar opciones | JPG a 150 ppp, cuatro páginas. | `GET /api/tools/pdf-a-imagen/formatos`<br>`POST /api/tools/pdf-a-imagen` |
| firmar | Implementada para PDF e imágenes compatibles con WebView. Firma sobre PDF probada; pendientes formatos restantes. | Rúbrica en imagen sobre un PDF. | `POST /api/tools/firmar/preparar`<br>`POST /api/tools/firmar` |
| firmar-certificado | PKCS12 y puente KeyChain, firma incremental, sello visible y TSA opcional. P12, apariencia 4 giros y KeyChain software probados en emulador; hardware no probado. | Con un .p12 creado en el propio teléfono: válida e incremental según pyHanko. KeyChain sin probar en teléfono. | `POST /api/tools/firmar-certificado/certificado`<br>`POST /api/tools/firmar-certificado/apariencia`<br>`POST /api/tools/firmar-certificado/autofirma`<br>`POST /api/tools/firmar-certificado` |
| comprobar-firmas | CMS/RFC3161 local, integridad/cobertura/fechas. Sin revocación ni confianza implícita; cambios incrementales no clasificados. | Firma hecha en el teléfono: correcta y cubriendo todo el archivo. | `POST /api/tools/comprobar-firmas/inspeccionar` |
| visor | parcial; verificar opciones | Abre y pinta un PDF de 30 páginas. | `POST /api/tools/visor/guardar` |
| dividir-pdf | parcial; verificar opciones | Opciones de serie; conserva índice, enlace y campo. | `POST /api/tools/dividir-pdf` |
| organizar-pdf | parcial; verificar opciones | Girar y quitar páginas; conserva índice y campo. | `POST /api/tools/organizar-pdf` |
| proteger-pdf | parcial; verificar opciones | Se abre con la contraseña y conserva índice y campo. | `POST /api/tools/proteger-pdf` |
| comparar-pdf | Implementada localmente: alineación de páginas, cambios de texto, diferencias RGB e informe PDF con recuadros. Límites 100 páginas/25 imágenes/120 cambios mostrados. Texto comparado por líneas extraídas, no por el Markdown estructurado de Windows; pendiente corpus complejo. | Informe de 28 páginas. | `POST /api/tools/comparar-pdf` |
| aplanar-pdf | parcial; verificar opciones | Campo aplanado; índice y enlace conservados. | `POST /api/tools/aplanar-pdf` |
| anonimizar-pdf | Implementada: nueve tipos de dato con validación, inspección previa, ayudante, expresiones propias y borrado real en negro/blanco. Patrones generados desde Python y contrastados en 698 casos; texto y flujos eliminados, giros probados. Expresiones propias JavaScript Unicode: no paridad completa con re de Python. Rechaza tachados previos pendientes; no modifica metadatos ni adjuntos. | DNI, teléfono, IBAN y correo borrados; la factura de ocho cifras, intacta. | `POST /api/tools/anonimizar-pdf/inspeccionar`<br>`POST /api/tools/anonimizar-pdf/probar`<br>`POST /api/tools/anonimizar-pdf` |
| ocr-pdf | Tesseract spa/eng local; reconocimiento y rehacer probados en Chromium real, conserva contenido visible. | 40 páginas escaneadas en 186 s (4,6 s por página), 90 % de renglones exactos; cancelar responde en 0,4 s. | `POST /api/tools/ocr-pdf` |
| pdf-a-pdfa | Ghostscript perfiles 1b/2b, OCR opcional. Corrección texto Unicode tras transparencias; ocho muestras finales 1b conformes con veraPDF. Fuentes homónimas con codificaciones incompatibles requieren 2b. | Perfil declarado en el XMP; el enlace interno no se conserva. | `POST /api/tools/pdf-a-pdfa` |
| pdf-a-grises | Integrada con Ghostscript 10.08.0 local en cuatro ABI. Motor real validado en Linux: gris, texto seleccionable y orientación; puente/cancelación probados. Prueba instrumentada compilada, pendiente ejecución en Android. | Píxeles grises de verdad; los campos se aplanan, igual que con Ghostscript en el servidor. | `POST /api/tools/pdf-a-grises` |
| comprimir-pdf | Niveles y objetivo; qpdf mide el tamaño final linearizado. Máscara alfa conservada. | Opciones de serie; conserva índice, enlace y campo. | `POST /api/tools/comprimir-pdf`<br>`POST /api/tools/comprimir-pdf/minimo` |
| marca-de-agua | Implementada: texto, imagen y vista previa. Pendiente comparación visual exhaustiva. | Con vista previa, pulsando sin esperarla. | `POST /api/tools/marca-de-agua`<br>`POST /api/tools/marca-de-agua/previsualizar` |
| marca-de-tiempo | Fecha visible o RFC3161. TSA envía digest SHA256, requiere conexión y no envía documentos. | Sello RFC 3161 sin probar: la app no tenía red en ese teléfono. El fallo se explica en castellano. | `POST /api/tools/marca-de-tiempo`<br>`POST /api/tools/marca-de-tiempo/previsualizar` |
| numerar-paginas | Implementada; validada con MuPDF y navegador móvil. | Con vista previa, pulsando sin esperarla. | `POST /api/tools/numerar-paginas`<br>`POST /api/tools/numerar-paginas/previsualizar` |
| extraer-imagenes | Implementada: extracción de XObject e imágenes en formularios, filtro de tamaño, original/PNG/JPEG. | Cuatro imágenes PNG. | `POST /api/tools/extraer-imagenes` |
| comprimir-imagen | parcial; verificar opciones | JPG. | `POST /api/tools/comprimir-imagen` |
| editar-imagen | parcial; verificar opciones | Opciones de serie. | `POST /api/tools/editar-imagen` |
| efecto-escaner | Implementada: tres modos y vista previa. Verificadas sombras y tinta. | Opciones de serie. | `POST /api/tools/efecto-escaner/previsualizar`<br>`POST /api/tools/efecto-escaner` |
| imagen-a-pdf | parcial; verificar opciones | Una foto. | `POST /api/tools/imagen-a-pdf` |
| generar-qr | parcial; verificar opciones | Enlace en PNG. | `POST /api/tools/generar-qr` |
| limpiar-metadatos | PDF Info/XMP y limpieza profunda; Exiv2 para imágenes y adaptadores GIF/ICO sin perder frames. | PDF: título y autor borrados. | `POST /api/tools/limpiar-metadatos/inspeccionar`<br>`POST /api/tools/limpiar-metadatos` |
| documento-a-pdf | LibreOfficeKit nativo: once formatos convertidos en emulador Android 30; cancelación real probada. | DOCX, XLSX y PPTX en 7,8 s. | `POST /api/tools/documento-a-pdf` |
| epub-a-pdf | Implementada con texto y metadatos. Pendientes corpus de libros complejos. | EPUB 3. | `POST /api/tools/epub-a-pdf` |
| pdf-a-epub | EPUB3, navegación, portada y estilos; inspección limitada a 20 páginas como Windows. | EPUB válido como ZIP. | `POST /api/tools/pdf-a-epub/inspeccionar`<br>`POST /api/tools/pdf-a-epub` |
| pdf-a-word | DOCX editable, tablas e imágenes orientadas; 14 pruebas. No promete maquetación idéntica en documentos arbitrarios. | DOCX con el texto. | `POST /api/tools/pdf-a-word` |
| extraer-tablas | Rejillas PDF y exportación CSV/XLSX/JSON/Markdown; 18 pruebas. No garantiza tablas sin bordes. | XLSX con los importes como números. | `POST /api/tools/extraer-tablas/inspeccionar`<br>`POST /api/tools/extraer-tablas` |
| a-markdown | PDF, Office, HTML, EPUB, correo y texto; 21 pruebas incluyendo estilos, listas y orden PPTX. | PDF de cuatro páginas. | `POST /api/tools/a-markdown` |
| markdown-a-pdf | Implementada con MuPDF: texto seleccionable, tablas, portada, márgenes y numeración. Falta pie con título y comparación visual con WeasyPrint. | Tabla y numeración. | `POST /api/tools/markdown-a-pdf` |
| html-a-pdf | Implementada con MuPDF y recursos embebidos; no descarga recursos externos. CSS y maquetación pueden diferir de WeasyPrint. | Con enlace. | `POST /api/tools/html-a-pdf` |
| visor-markdown | Implementada: temas, tablas, tareas y resaltado; descarga PDF local. Validada en navegador móvil sin red. | Vista previa al subir. | `POST /api/tools/visor-markdown/previsualizar` |
| correo-a-pdf | EML/MSG, destinatarios y adjuntos con nombres únicos; 12 pruebas de regresión. | EML con adjunto. | `POST /api/tools/correo-a-pdf` |
| crear-certificado | Implementada en Java con PKCS12 cifrado AES. Pruebas JVM aprobadas. | .p12 y .crt; el .p12 firma. | `POST /api/tools/crear-certificado` |
| leer-codigo | Implementada con ZXing-C++ local. QR verificado; pendientes corpus de otros códigos. | QR de wifi leído y desglosado al subirlo. | `POST /api/tools/leer-codigo/inspeccionar` |
| convertir-imagen | parcial; verificar opciones | JPG. | `GET /api/tools/convertir-imagen/formatos`<br>`POST /api/tools/convertir-imagen` |

## Contratos compartidos y auxiliares

La salida `--json` incluye todas las rutas del backend, también archivos, sesión, visor y bóveda.

## Criterios de aceptación

- Prueba del motor real y de todas las opciones de la pantalla.
- Primera ejecución en modo avión con recursos incluidos en la instalación.
- Importación, previsualización, cancelación, lotes y exportación en Android real.
- Conservación de texto, formularios, enlaces, marcadores y anotaciones cuando corresponda.
- Comparación con documentos de referencia de Windows.

## Motores integrados

- Office: LibreOfficeKit 26.2.6.3, cuatro ABI, recursos y fuentes incluidos.
- Firma: PDFBox Android 2.0.27.0 y Bouncy Castle 1.79; PKCS12 y almacén Android.
- PDF/A y grises: Ghostscript 10.08.0; validación externa de muestras con veraPDF.
- OCR: Tesseract 6.0.1 WebAssembly y modelos locales español/inglés.
- Optimización web: qpdf 12.4.2. Metadatos de imagen: Exiv2 0.28.9.

## Limitaciones conocidas de las herramientas habilitadas

- Unión: rechazo de formularios, enlaces y anotaciones; no hay paridad estructural.
- Visor: solo lectura; faltan edición, anotaciones y búsqueda avanzada.
- Imágenes: el adaptador ofrece JPG, PNG y WebP; falta comparar formatos con Windows.
- Probado en un emulador Android 30 y en un teléfono físico (OnePlus 6, Android 15 con LineageOS 22.2 y WebView 155, el 5 de noviembre de 2026); faltan otros fabricantes y versiones, y claves de hardware en KeyChain.
- Firmas: integridad local sin consulta de revocación; clasificación conservadora de revisiones.
- Tablas: detección de rejillas; documentos complejos requieren comparación con el original.

