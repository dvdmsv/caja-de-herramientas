# OCR local — pruebas independientes del snapshot

Directorio `/tmp/caja-ciclo/ocr`. No se ha cambiado implementación, principal ni node_modules. Sólo se han añadido fixtures, pruebas y evidencias. Motor real ejecutado en Chromium con worker compilado `worker-QPKQS47E.js`, no un mock de Tesseract.

Resultado automatizado: **16 comprobaciones: 10 pasan, 6 fallan**. Las seis fallidas reproducen el mismo hallazgo O01: cinco variantes de navegador y una reproducción directa sin Tesseract. Registro `tests/independiente/vitest.log`.

## O01 — pérdida de texto visible y gráficos al rehacer y guardar (alta)

Fixture mínimo: PDF con fondo vectorial, marco azul, texto visible `TEXTO VISIBLE` y enlace. Llamar quitarTextoInvisible y guardar mediante guardarPdf; abrir de nuevo. El texto desaparece y se pierden gráficos. MuPDF avisa `content stream is not a stream (16 0 R)`; en otro fixture la referencia es 20 0 R. El objeto Form conserva su diccionario y Length pero deja de ser stream al abrir la salida.

La comprobación directa demuestra que **antes del guardado** el texto y los píxeles todavía coinciden. El fallo aparece al serializar con garbage3/4. Un diagnóstico que abre siempre el original desde cero arroja:

| garbage | Texto tras guardar/abrir |
|---|---|
| 0, 1, 2 | TEXTO VISIBLE |
| 3, 4 | vacío |

No se ha aplicado ninguna solución. Cambiar temporalmente parámetros sólo se hace dentro del test diagnóstico, sin cambiar guardarPdf. El motivo exacto de la deduplicación inválida de streams requiere investigación posterior; no se atribuye todavía a un fallo específico de MuPDF o de la reconstrucción.

Resultados del worker real, comparados canal a canal a escala 1:

| Caso rehacer | Canales cambiados | Consecuencia |
|---|---:|---|
| escaneo y texto visible | 101216 | desaparece TEXTO VISIBLE y parte gráfica |
| escaneo y texto Tr3 | 100170 | desaparece CAPA ANTIGUA, pero también gráficos |
| escaneo y texto alfa0 | 100170 | misma pérdida gráfica |
| página rotada90 con CropBox | 67170 | pérdida gráfica; dimensiones conservadas |
| sólo texto visible y vectores | 383246 | desaparecen texto y gráficos |

Todas estas salidas conservan enlace y dimensiones, pero **no se pueden aprobar** por pérdida de contenido.

Reproducción corta:

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/ocr-independiente.test.ts
```

El primer test usa `tests/independiente/redo-visible-only-in.pdf`, llama directamente al código original y falla al reabrir; no necesita navegador, red ni Tesseract. Salida: `direct-redo-out.pdf`. Diagnóstico: `save-diagnostic.json`.

## Comprobaciones aprobadas y calidad observada

- OCR normal spa añade capa de texto invisible y conserva exactamente todos los píxeles, geometría y enlace. Reconoce `España, año 2026. Información útil.` con ñ y tildes. La búsqueda de España retorna coordenadas aproximadas x27–90/y57–80, correspondientes al renglón rasterizado.
- Modos eng y spa+eng conservan todos los píxeles. En este fixture ambos transcriben `Espana, ano 2026. Informacion util.`: **limitación de precisión del modo bilingüe por defecto**, frente a spa solo. No se afirma que sea un fallo de integración ni equivalencia OCR con Windows. Hay además falsos caracteres al reconocer el marco vectorial.
- skip-text conserva el texto y los píxeles de una página mixta existente; no añade OCR al escaneo de esa página, conforme al criterio de omitir páginas con texto.
- Tr3 y alfa0 antiguos desaparecen con rehacer, pero este resultado está afectado por O01 y no aprueba el modo.
- La página cuyo contenido aparece girado90 conserva bounds; el reconocimiento produce caracteres incorrectos. No se ha implementado ni validado orientación automática y no se exige aquí como regresión respecto a Windows.
- Se rechazan idioma no admitido, rehacer que no es booleano, PDF roto y PDF cifrado antes de arrancar OCR.
- Cancelación real: documento de 12 páginas, se termina el worker tras progreso1/12. Durante el segundo posterior no aparece resultado ni mensaje adicional. Un worker nuevo reconoce otro PDF correctamente. No prueba la liberación completa de memoria de workers hijos ni la interfaz de cancelación LocalService, porque OCR aún no está en catálogo.

## Sin conexiones externas y modelos

El servidor de pruebas sirve únicamente la copia de dist, en 127.0.0.1. Playwright aborta URLs externas. Se ejecuta en página limpia, sin caché previa de la aplicación, con cacheMethod:none de Tesseract. No se observaron intentos externos ni errores JS. Las peticiones de core WASM y modelos son `/assets/ocr/...`; los modelos spa/eng se cargan en sus modos correspondientes. Los archivos `.wasm.js` incluyen la carga WASM y no requieren un CDN.

Hashes de modelos coinciden con modelos.json:

- spa: 6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
- eng: 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
- tessdata_fast revisión 87416418657359cb625c412a48b6e1d6d41c29bd

## Reproducir pruebas de navegador

Desde este directorio:

```
node tests/independiente/ocr-browser.mjs > tests/independiente/browser.log 2>&1
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/ocr-independiente.test.ts tests/local/ocr-browser-results.test.ts
```

El primer comando levanta servidor localhost, ejecuta Chromium y cierra ambos al finalizar. Necesitó permiso de ejecución fuera del sandbox porque éste rechaza listen con EPERM; fue concedido. No necesita conexiones externas. Genera PDFs de entrada/salida y report.json con métricas y URLs. El segundo test de resultados comprueba ese informe; para regenerarlo hay que ejecutar primero el navegador.

## Versiones y límites

Node22.23.2, MuPDF1.28.1, Vitest4.1.11, Tesseract.js6.0.1, tesseract.js-core6.1.2; Chromium instalado `/home/david/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` con Playwright1.64.1.

SHA256 módulo OCR: d136d70f4476f7f09e8ef8265eb3308fa34ea8999b7e367fff5dd81a4105c2b3. Worker: 6a4f72400b24fb4f0415a09abe5a234d1dc176ff400d5bb90870b56d8f940102.

Sin dispositivo Android: quedan pendientes WebView/Capacitor, presión de memoria en teléfono, cancelación de la UI, instalación y catálogo final. No se ha validado un corpus de formularios, anotaciones complejas, firmas, máscaras de recorte de texto, grupos de transparencia y PDFs corruptos recuperables. No se declara completa la herramienta. Las correcciones y el plan detallado de regresión quedan para después de las 13 implementaciones.
