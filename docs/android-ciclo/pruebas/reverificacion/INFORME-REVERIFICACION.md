# Reverificación C01, O01, F01 y F02

Copia nueva `/tmp/caja-ciclo/reverificacion`. Código src copiado del principal después de los arreglos; assets de navegador extraídos del APK debug de integración. No se ha modificado principal. Q02, licencias/build y otros cambios en curso quedan fuera de esta aprobación.

## Resultado

**28/28 comprobaciones Vitest y 20/20 casos de firmas pasan.**

- C01: las 8 pruebas originales independientes pasan, incluido el caso de alfa variable que antes convertía SMask a DeviceRGB/DCTDecode. Continúan pasando reducción RGB, cuadrantes, texto/enlaces, tamaño objetivo/mínimo, repetibilidad y validación.
- O01: prueba real Tesseract en Chromium contra los assets del APK. Los cinco casos rehacer (visible, Tr3, alfa0, CropBox+Rotate90, sólo texto visible) tienen **cero canales visuales cambiados** tras guardar/reabrir. Texto visible preservado, texto oculto antiguo ausente, enlaces y geometría conservados. Cancelación después de página1/12 y OCR posterior también pasan. Se mantienen las limitaciones de precisión spa+eng y texto girado90: este fix no implementa orientación automática.
- Metadatos profundo: cinco fixtures pasan por metadatosPdf real con a_fondo=true; tras reabrir conservan exactamente render, bounds y enlaces, retiran texto oculto y conservan visible. El guard de diccionarios evita el fallo previo sobre arrays.
- Pipeline: OCR corregido → Word y EPUB preserva TEXTO VISIBLE una sola vez, texto OCR España y la imagen. OCR → limpieza profunda → Word/EPUB conserva visible e imagen; la limpieza profunda elimina intencionalmente la capa OCR invisible, de modo que esa rama no exige conservar España como texto seleccionable.
- F01/F02: 20 fixtures JVM con PDFBoxAndroid2.0.27.0 y BC1.79. expired/future ahora intacta=true y vigente=false con identidad/cobertura; expired-now-valid-then sigue true/true. tampered y malformed-date ahora intacta=false, con identidad y cobertura, sin error genérico. Regresión RSA/EC/DSA, firma alterada, múltiples firmas, DocTimeStamp, sello CMS, rangos/CMS rotos y PDF sin firma pasa.

La prueba del helper antiguo con guardarPdf por defecto se ha conservado como diagnóstico fuera del patrón de tests (`tests/independiente/diagnostico-original-no-ejecutar.ts`): el arreglo es deliberadamente una política de guardado localizada en OCR/metadatos, no una modificación global del helper ni una corrección interna de MuPDF.

## Comandos/evidencias

```
node tests/independiente/ocr-browser.mjs > tests/independiente/browser.log 2>&1
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/compresion-independiente.test.ts tests/local/ocr-browser-results.test.ts tests/local/metadatos-pipeline.test.ts
java -cp "firmas/classes:$(cat firmas/classpath.txt)" io.github.dvdmsv.cajadeherramientas.Check /tmp/caja-ciclo/firmas/independiente/fixtures/*.pdf > firmas/report.jsonl
python3 firmas/assertions.py
```

`tests/independiente/report.json` conserva métricas y URLs; `regression.log` resultado28/28. `firmas/tests.log` resultado20/20, report.jsonl detalles. `worker-sha256.txt` identifica worker extraído del APK. Navegador local necesitó excepción de sandbox para listen127.0.0.1; ninguna petición externa observada.

SHA256 de fuentes verificadas:

- comprimir-pdf.ts: ab9221dbf12c42a4f45d5c5454e575f903bfe417f11112ced16b0fd9e328a3d6
- ocr-pdf.ts: 10370182df8220f36583f1b02b1081963e7315b653effb4e02088e0308e422da
- metadatos-pdf.ts: a21067a1caef98fa69665f7c81d42df2192506cdc1fc0ddc83d64d5ecb5826f5
- FirmasPdf.java: 66f07cadc69e8dffb0f64bb0372679e44fd930cd7823f579909d3549acee9b08

## Alcance

C01/O01/F01/F02 quedan verificados para los casos reproducibles y regresiones indicados. No es aprobación completa del APK ni certificación de todos los PDFs. No se ha utilizado el emulador ocupado por pruebas Office; checker mantiene los mismos stubs Log/JSON documentados y motor PDFBoxAndroid real. WebView Android, ciclos de vida y memoria en dispositivo, corpus amplio de máscaras/Forms/clipping y revisiones PDF ambiguas siguen requiriendo pruebas adicionales. No se certifica Q02 ni otros cambios posteriores a esta copia.
