# Regresión real Android: firma PNG

Emulador Android30 x86_64, serial emulator-5556, ADB puerto5038. APK debug0.7.0 recompilada por agente principal, hash en auditoria/android-apk-sha256.txt. Instalación de APK y pequeño arnés de instrumentación autorizada; no cambios del auditor en principal.

Se detectó en APK anterior que cuatro firmas visibles producían CMS válido pero páginas sin Annots y render idéntico al original: ningún sello visible. Evidencia anterior conservada en auditoria/android-antes-fix.tar/log. Causa corroborada con javap PDFBoxAndroid: addSignature sin visualSignature retorna antes de enlazar widget a anotaciones de página. El principal añadió enlace explícito preservando la lista existente.

## Resultado posterior al fix

Instrumentación auditoria/instrumentacion/firma-audit.apk invoca FirmasPdf.abrir y SellarPdf.ejecutar reales desde APK mediante reflexión. PKCS12 RSA de prueba, PNG reales generados por apariencia-certificado.ts y OffscreenCanvas en Chromium. No mocks de BitmapFactory o PDFBox.

Seis documentos producidos: giros0/90/180/270, segunda firma sobre documento firmado y firma sobre PDF con anotación rectangular anterior. Log auditoria/android-instrumentacion.log: seis ejecuciones correctas.

Validación independiente auditoria/validar-android.py con pyHanko/PyMuPDF: siete firmas criptográficas intactas, válidas y bottom_line true usando certificado fixture explícitamente como raíz. En doble firma, primera cubre ENTIRE_REVISION y segunda ENTIRE_FILE. Todos los documentos muestran sello PNG y número correcto de widgets; imagen raster difiere del original. Anotación anterior conserva existencia y rectángulo. Renderizados visibles en cuatro giros revisados visualmente: sello horizontal, legible y centrado, incluida página rotada90/180/270. Log auditoria/android-validacion.log, PDFs/PNGs auditoria/android-resultados/.

## Reproducción

1. python3 auditoria/compilar-instrumentacion.py
2. adb -P5038 -s emulator-5556 install -r auditoria/instrumentacion/firma-audit.apk
3. adb -P5038 -s emulator-5556 shell am instrument -w io.github.dvdmsv.cajadeherramientas.auditfirma/io.github.dvdmsv.cajadeherramientas.auditfirma.FirmaInstrumentation
4. Extraer mediante run-as el directorio files/audit-firma y ejecutar con Python venv backend auditoria/validar-android.py.

## Límites

La prueba inicial usa PKCS12 explícito; se añadió posteriormente prueba KeyChain software real descrita abajo. Claves hardware no probadas. Sin dispositivo físico ARM, sin prueba de firma visible desde UI completa ni prueba de presión de memoria/cancelación. Estado validado corresponde APK cuyo hash quedó guardado. No TSA real. La confianza indicada se limita a raíz fixture de prueba, no CA pública.


## KeyChain software completado

Se instaló mediante interfaz del sistema Android el certificado sintético derivado del mismo fixture, con alias AuditoriaCajaSoftware y uso VPN y aplicaciones. Se abrió el selector real de Android desde MainActivity, se seleccionó explícitamente ese alias y se recuperó clave/cadena mediante KeyChain.getPrivateKey/getCertificateChain. Tipo real de clave: android.security.keystore.AndroidKeyStoreRSAPrivateKey. SellarPdf de la APK firmó PDF con sello PNG usando esa clave no exportada por el arnés.

Resultado auditoria/android-keychain.log: PASS alias AuditoriaCajaSoftware, RSA, salida de 531046 bytes. PDF auditoria/android-resultados/keychain.pdf. PyHanko valida intact/valid/bottom_line true con raíz fixture y ENTIRE_FILE; PyMuPDF confirma sello visible, un widget y 10203 bytes de píxeles distintos del original. Fuentes mínimas: auditoria/instrumentacion/src/KeyChainInstrumentation.java, AndroidManifest.xml y auditoria/compilar-instrumentacion.py. El instalador usa keychain.p12 con contraseña ASCII sintética para automatización; el certificado/clave son los mismos que en validación previa. Instalación y elección se realizaron por UIAutomator/ADB, no por acceso root al almacén. XML del selector: auditoria/keychain-selector.xml.

Esta evidencia prueba API AndroidKeyChain y firma nativa, no flujo Angular/puente completo. No prueba hardware seguro ni biometría. La clave software fixture queda en el emulador de pruebas, que se apaga al cerrar auditoría.

## Interfaz APK y WebView 83

Servicio WebView del emulador: com.android.webview 83.0.4103.120. Al abrir MainActivity de la APK ensayada se ve correctamente la pantalla de compatibilidad: «Actualiza el componente de Android», «Actualiza Android System WebView y Google Chrome desde Google Play…». Captura auditoria/android-webview83.png; árbol UI auditoria/app-ui.xml; registro auditoria/android-ui-logcat.txt confirma carga de assets/android-webview.html.

Por tanto sí se valida el aviso de compatibilidad en Android, pero NO la interfaz Angular de 39 herramientas dentro de APK: exige WebView >= 130. La última recompilación de catálogo anunciada por principal después de estas pruebas no se reinstaló, dado que no cambia esta limitación del runtime. Hash registrado identifica exactamente APK nativa ensayada. Las pruebas Chromium de apariencia y Node/Vitest no sustituyen validación de UI integrada en un dispositivo actualizado.
