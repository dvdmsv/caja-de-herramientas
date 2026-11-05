# Office: regresión final

APK 0.7.0 SHA256 fe9d8ba3db9f90c0d14d33f8fc56599b196b8b33539c07f56c21de137eb3d52a. Emulador AOSP API30 x86_64, software TCG.

O01 corregido: tras activar filtro de la APK, las tres llamadas nativas sendmsg, sendmmsg y sendto devuelven -13/EACCES. Prueba JNI ejecutada en Android, sin mocks del filtro. Evidencia android-udp-regresion.log y código instrumentacion/udp.c.

11/11 conversiones reales posteriores pasan: DOCX, DOC, ODT, RTF, TXT, XLSX, XLS, ODS, PPTX, PPT, ODP. Duración 6–15 segundos por archivo. PDFs extraídos y abiertos con PyMuPDF: once documentos legibles con texto no vacío, contenido conservado en contenido-regresion.json. Evidencia android-office-regresion.log y resultados-regresion.tar.

Cancelación real interrumpe conversión en 1041 ms y devuelve Operación cancelada (android-cancelacion-regresion.log). Ningún fallo en estas regresiones. Límites: sólo API30/x86_64 ejecutado; corpus sintético pequeño. Las librerías 64 bits tienen alineación16KB; los motores oficiales32bits tienen4KB y se destinan a dispositivos heredados. No se certifica compatibilidad universal de documentos ni dispositivos.
