# Inspección final de APK/AAB

Build principal final terminó BUILD SUCCESSFUL. Inspección read-only de app-debug.apk y app-release.aab sin instalar ni interferir con emulador.

Ambos contienen versión0.7.0/code7, cuatroABI,76bibliotecas nativas, modelos OCR spa/eng, motores MuPDF/GS/qpdf/Exiv2/LibreOffice, filtro Office, perfilICC,33fuentesLO y avisos legales. Manifest APK y protobuf AAB declaran INTERNET; APK minSdk26/target36. AAB versión y permiso contrastados directamente con campos protobuf y manifest release generado.

Todos los segmentos PT_LOAD de ELF ARM64/x86_64 tienen alineación mínima16KB; zipalign -c -P16 4 APK pasa. Motores oficiales32bits conservan4KB como limitación documentada. APK firmado con certificado Android Debug, válido para instalación de pruebas; esta inspección no afirma publicación Play con firma de producción.

No hay entradas .java/.kt/.jar/.jks/.keystore/.p12/.pfx/.key ni marcadores PEM de clave privada en entradas menores2MB. No es prueba matemática de ausencia de secretos arbitrarios, pero no se han empaquetado sourceJARs ni almacenes privados reconocibles. Certificado público de firma APK es normal y no equivale a incluir clave privada.

Detalles y SHA256 en inspeccion.json; reproducción en inspeccionar.py. Arnés M02 portable probado contra fuentes actuales: tiempo-portable/run.py, 175controles/0fallos, evidencia portable.log. No se modificó principal.
