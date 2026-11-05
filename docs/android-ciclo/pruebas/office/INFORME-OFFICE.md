# Pruebas independientes: Office local Android

**Los once formatos admitidos se han convertido realmente en Android**, con LibreOfficeKit empaquetado en la APK: DOCX, DOC, ODT, RTF, TXT, XLSX, XLS, ODS, PPTX, PPT y ODP. La cancelación real también funciona. **Un hallazgo medio, O01**, afecta al aislamiento de red; no afecta a que estos documentos se hayan convertido correctamente.

El puente TypeScript supera **23/23 pruebas**. Se ha ejecutado además qpdf y Exiv2 dentro de Android, correctamente.

## Entorno real

- Emulador AOSP API 30 x86_64, ejecución software sin KVM; `sys.boot_completed=1`.
- SDK, AVD y usuario de pruebas creados en `/tmp/caja-office-*`; SDK principal sólo leído. ADB separado en puerto 5038, dispositivo `emulator-5556`.
- APK de integración del agente principal, copiada a `auditoria/app-integracion.apk`. SHA256 conservado en `auditoria/apk.sha256`. No se reemplazó `dist/android` ni se publicó una distribución.
- Instrumentación independiente compilada sin Gradle: `auditoria/instrumentacion/office-audit.apk`, paquete `io.github.dvdmsv.cajadeherramientas.auditoffice`. Invoca por reflexión **MotorOffice original de la APK**; no sustituye su servicio, importadores, JNI ni bibliotecas.
- LibreOfficeKit 26.2.6.3 de APK oficiales F-Droid, las mismas bibliotecas que se verificaron por hash.

## Resultados de importación

Todos producen un PDF de una página válido y con texto extraíble esperado. Se recuperaron los archivos del emulador y se abrieron con PyMuPDF. Evidencia: `auditoria/contenido-pdf-final.json` y PDF en `auditoria/audit-office/`.

| Entrada | Resultado observado |
|---|---|
| DOCX y DOC | Título, español con acentos/ñ/interrogación y tabla con Concepto/Importe/Servicio/12,50 |
| XLSX y XLS | Celdas y fórmula SUM recalculada, total 12,5 |
| PPTX y PPT | Título y contenido español de diapositiva |
| ODT | Texto español completo |
| ODS | Celdas y valor numérico 12,5 |
| ODP | Texto de diapositiva |
| RTF | Texto y escape Unicode de ñ |
| TXT | Dos líneas y español completo |

DOCX/XLSX/PPTX se generaron con python-docx/openpyxl/python-pptx; ODF con paquetes XML mínimos y RTF/TXT directamente. Para los tres formatos binarios heredados, LibreOfficeKit exportó las fuentes OOXML a DOC/XLS/PPT en una invocación de instrumentación separada; se comprobó su cabecera OLE y luego se pasaron por **la ruta normal MotorOffice→OfficeService→PDF**. No son archivos OOXML simplemente renombrados. Este origen compartido puede ocultar problemas particulares de documentos heredados de terceros, por lo que no sustituye un corpus amplio.

El lote de ocho formatos consecutivos terminó sin carreras ni desconexiones entre procesos. El lote binario de tres también. Tiempos del emulador software: aproximadamente 7–15 segundos por conversión. Logs `android-lote.log` y `android-binarios.log`.

Cancelación a un segundo durante conversión: `Operación cancelada` recibida en 1,08 segundos, sin salida entregada. Se pudo convertir después de cancelar. Log `android-cancelacion.log`. La instrumentación llama al motor directamente; la limpieza adicional del plugin/IndexedDB no queda acreditada por este ensayo.

## O01 — Medio: el guard no bloquea sendmsg UDP

Código de la copia inicial: `android/native/office-aislamiento.c`. El filtro seccomp TSYNC deniega `connect`, `sendto` y `socketcall`, pero no `sendmsg`/`sendmmsg` ni la creación de sockets INET.

Reproducción real en Android:

1. La instrumentación carga el guard empaquetado y ejecuta `OfficeService.aislarRed()`; devuelve verdadero.
2. Un `connect` recibe EACCES: ese camino sí está bloqueado.
3. JNI de prueba crea un socket UDP y usa `sendmsg` para enviar el texto sintético `OFFICE-AUDIT` al receptor local del host a través de 10.0.2.2:45679.
4. `sendmsg` devuelve 12; el receptor recibe exactamente esos 12 bytes después de activar el guard.

Evidencias: `auditoria/android-udp.log`, `auditoria/udp-host.log`, código `auditoria/instrumentacion/udp.c`. Sólo se utilizó el host local, sin documentos privados ni destinos externos.

Esto demuestra que el filtro no proporciona el aislamiento de red completo que anuncia. **No demuestra que un documento malicioso pueda ejecutar JNI o explotar LibreOffice**; se está probando la propiedad del guard con una llamada nativa controlada.

El agente principal ha iniciado una corrección que también deniega sendmsg/sendmmsg. La copia inicial y este informe no se modifican para ocultar el hallazgo; quedará pendiente la regresión con APK nueva y comprobar que LibreOffice continúa funcionando con ese filtro.

## Motores adicionales probados

`auditoria/android-nativos.log`:

- qpdf real procesa un PDF desde `nativeLibraryDir`; salida válida con `/Linearized 1` y texto `Texto QPDF Android` preservado.
- Exiv2 real inspecciona un JPEG con EXIF y devuelve `exif:271`/Marca de la cámara=`Marca de prueba`.
- El guard devuelve EACCES al `connect`, con la limitación O01 descrita arriba.

## Recursos, fuentes y ELF

`auditoria/recursos.py` y `recursos.log` comprueban:

- SHA256 de los cuatro APK coincidente con `libreoffice-motores.json`.
- Bibliotecas extraídas idénticas byte a byte a las oficiales.
- Los 86 recursos de program/share/unpack coinciden con el APK ARM64 usado como fuente común.
- Las 33 fuentes empaquetadas existen y no están vacías. La conversión real confirma que el bootstrap encuentra recursos y fuentes suficientes para las muestras.
- Todas las bibliotecas de ARM64 y x86_64 revisadas cumplen alineación ELF de 16 KB.
- Las 28 bibliotecas oficiales de ARMv7/x86 tienen alineación 4 KB. El agente principal acordó documentar que esas ABI son para dispositivos heredados de 4 KB; no se anuncia compatibilidad universal de 16 KB. Android con páginas de 16 KB usa procesos de 64 bits. Este dato no se presenta como un fallo probado en teléfonos de 64 bits y 16 KB.

## Reproducción resumida

```
cd /tmp/caja-ciclo/office
python3 auditoria/recursos.py
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/office-auditoria.test.ts
python3 auditoria/compilar-instrumentacion.py
adb -P 5038 -s emulator-5556 install -r -t auditoria/instrumentacion/office-audit.apk
adb -P 5038 -s emulator-5556 shell am instrument -w -e archivos prueba.docx,prueba.xlsx,prueba.pptx,prueba.odt,prueba.ods,prueba.odp,prueba.rtf,prueba.txt io.github.dvdmsv.cajadeherramientas.auditoffice/io.github.dvdmsv.cajadeherramientas.auditoffice.OfficeInstrumentation
adb -P 5038 -s emulator-5556 shell am instrument -w -e archivos prueba.doc,prueba.xls,prueba.ppt io.github.dvdmsv.cajadeherramientas.auditoffice/io.github.dvdmsv.cajadeherramientas.auditoffice.OfficeInstrumentation
```

Usar `ANDROID_USER_HOME=/tmp/caja-office-android-user` y la ruta ADB de `/home/david/Android/Sdk/platform-tools/adb` si no está en PATH. No ejecutar otra instrumentación mientras un subagente utiliza el emulador.

## Límites

Se validó el motor nativo y el contrato del puente, no toda la interfaz Angular/WebView ni la operación completa del almacén local. API 30 puede traer un WebView más antiguo que un teléfono actualizado. No se probó un dispositivo físico ni ejecución ARM64/ARMv7/x86, ni páginas de 16 KB reales: para esas variantes se verificó paquete/ELF.

Quedan sin ejecutar documentos Office con contraseña, macros, enlaces externos desde un documento real, imágenes complejas, notas, comentarios, cambios controlados, fuentes no presentes, decenas de hojas/diapositivas y presión de memoria. Los resultados acreditan las once muestras y el lote/cancelación, no fidelidad universal a cualquier documento Windows.

Plan final de corrección y regresión de todos los hallazgos de este agente: `auditoria/PLAN-CORRECCION-REGRESION.md`.
