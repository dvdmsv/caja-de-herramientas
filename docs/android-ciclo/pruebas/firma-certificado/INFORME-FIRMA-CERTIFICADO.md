# Auditoría aislada firma con certificado

Copia /tmp/caja-ciclo/firma-certificado. Fuente principal y fuente copiada sin modificar; arneses y resultados sólo en auditoria/. No TSA ni servicios externos usados.

## Ejecución JVM

PDFBoxAndroid 2.0.27.0 y BC1.79 reales desde Gradle. Compilación contra android.jar35; stub android.util.Log silencioso. FirmasPdf.java y SellarPdf.java originales sin adaptación. JSONObject Android no ejercitado en esta ruta.

Arnés auditoria/java/ArnesFirma.java, classpath auditoria/classpath.txt.
Ejecutar desde copia: java -cp "auditoria/classes:$(cat auditoria/classpath.txt)" io.github.dvdmsv.cajadeherramientas.ArnesFirma
Log auditoria/jvm.log: 30 comprobaciones PASS.

Para RSA2048, EC256 y DSA2048: genera identidad/PKCS12, abre contraseña Unicode, verifica eliminación de buffers password/p12, rechaza contraseña incorrecta. Firma PDF real invisible y verifica CMS con BC. Comprueba que original es prefijo byte a byte del resultado. Firma por segunda vez y verifica ambas firmas criptográficamente. Cancelación inicial no crea salida. Página inválida no deja salida. DocMDP P1 rechaza sin salida (diccionario sintético, no certificación criptográfica real).

## Validación independiente

Arnés auditoria/validar.py con pyHanko backend; log auditoria/pyhanko.log. Verifica 9 firmas en seis PDFs. RSA/EC: intact=true, valid=true, trusted=true, bottom_line=true al establecer explícitamente como raíz de prueba el certificado autofirmado generado. Primera firma tras añadir segunda: ENTIRE_REVISION y FORM_FILLING; última ENTIRE_FILE y NONE. No equivale a confianza pública de certificados autofirmados.

DSA2048: intact=true y valid=true, trusted/bottom_line=false porque la política por defecto de pyHanko exige tamaño DSA >=3192. No es fallo de cálculo CMS ni demuestra compatibilidad de aceptación con todos los validadores. Algoritmo firma SHA256withDSA probado; aceptación de política debe distinguirse de integridad.

## Apariencia navegador

Arnés auditoria/browser-entry.ts empaquetado con esbuild, ejecutado por auditoria/browser.cjs en Chromium real headless mediante Playwright. Servidor exclusivamente loopback para módulos MuPDF; se autorizó ejecución fuera sandbox para abrir loopback/Chromium. Resultados auditoria/browser.json y apariencia-{0,90,180,270}.png. No mocks OffscreenCanvas.

PDF de 600x800 con giros0/90/180/270. Sello sin trazo mide227x84 (84x227 en giros90/270). Recuadro central con fracción35% dentro de página y transformación inversa coherente. Invisible devuelve recuadro null y ningún archivo en cuatro giros. Posición x=0/y=0 rechaza en cuatro giros. Trazo PNG blanco/negro opcional se procesa y produce sello367x125. Imagen sin giro inspeccionada visualmente: tres líneas completas y legibles. Estas son comprobaciones de generación/geométricas, no integración completa del sello en PDF nativo.

## Límite de integración nativa visible

ArnesVisible intenta incrustar PNG real usando SellarPdf original y llega a android.graphics.BitmapFactory.decodeStream, que en android.jar lanza Stub!. Log auditoria/visible.log. No es defecto Android: falta runtime gráfico Android en JVM. Salida visible.pdf se elimina por catch (atomicidad de error). Pendiente probar firma visible final y orientación renderizada en dispositivo/emulador.

## Hallazgos

Sin defectos nuevos reproducidos en las rutas ejecutadas. No extrapolar las pruebas de firma invisible a KeyChain, claves hardware, UI Android o apariencia nativa final. KeyChain se revisó en código: obtiene cadena/clave del alias y comprueba certificado público seleccionado, pero no pudo ejecutarse sin dispositivo. No se probaron cancelación durante crypto/IO, PDF cifrado, límites de tamaño, DocMDP P2/P3 o FieldMDP, certificación real previa, PKCS12 con múltiples identidades ni claves EdDSA. DocMDP P1 prueba sólo restricción sintética. Conformidad PAdES/CAdES de perfil completo no certificada; validación realizada con pyHanko y BC. TSA excluida por agente específico. No se declara habilitación de catálogo como fallo.
