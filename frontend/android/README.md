# Android sin servidor (versión de prueba)

La APK procesa documentos dentro del teléfono. Incluye Angular, MuPDF.js en
WebAssembly, Ghostscript 10.08.0, qpdf 12.4.2, Exiv2 0.28.9, LibreOfficeKit
26.2.6.3, Tesseract con español/inglés y PDFBox Android/Bouncy Castle.
No ejecuta Flask ni necesita configurar un servidor. Motores, modelos y fuentes
se incluyen en el paquete para el primer arranque sin conexión. El permiso
`INTERNET` se utiliza para la TSA opcional: sólo envía una huella SHA-256.
Office se ejecuta en un proceso separado con llamadas de red bloqueadas.

La disponibilidad de una herramienta no implica equivalencia exacta con Windows.
Las diferencias de formatos y visor se documentan abajo y en
[la matriz de paridad](../../docs/paridad-android.md).

## Qué incluye

- Unir PDF, dividir por rangos o por páginas, reordenar, girar y eliminar páginas.
- Poner y quitar contraseña AES-256; aplanar anotaciones y formularios.
- Anonimizar PDF: nueve tipos de dato, recuento previo, expresiones propias y
  borrado real de texto con barra negra o hueco blanco. Incluye el ayudante.
- Comparar dos PDF: cambios de texto, páginas añadidas/quitadas y diferencias
  visuales recuadradas en un informe PDF. En Android se compara el texto por
  líneas extraídas; Windows utiliza Markdown estructurado. Hasta 100 páginas,
  25 imágenes y 120 cambios de texto mostrados.
- Pasar PDF a grises con Ghostscript local, conservando texto seleccionable y vectores.
- Convertir páginas PDF a JPG/PNG y reunir imágenes en un PDF.
- Convertir imágenes a JPG/PNG/WebP; comprimir por calidad o tamaño objetivo;
  recortar, girar, reflejar y redimensionar. Las fotos HEIC/HEIF se pasan a JPEG
  al elegirlas, con el decodificador de Android 9 o posterior.
- Generar QR en PNG/SVG: texto, wifi, contacto, correo y teléfono.
- El visor de la web en modo lectura: desplazamiento continuo, zoom con dos dedos,
  modos de lectura, buscar, índice, enlaces, miniaturas, presentación y guardar
  una copia.
- Renombrar resultados, encadenar herramientas y descargar conjuntos en ZIP.
- Numeración y marcas de agua de texto o imagen con vista previa local.
- Efecto escáner en blanco y negro, gris y color con corrección de iluminación.
- EPUB a PDF con texto seleccionable, opciones de página/letra y metadatos.
- Lectura de códigos en imágenes y PDF mediante ZXing-C++ empaquetado en WebAssembly.
- Firma manuscrita sobre PDF e imágenes, eliminación de fondo y colocación con giro.
- Extracción de imágenes PDF: original, PNG o JPEG, con filtro por dimensiones.
- Visor Markdown con temas, tablas, tareas y resaltado; exportación PDF local.
- Markdown y HTML a PDF con texto seleccionable y opciones de página. La
  maquetación MuPDF difiere de WeasyPrint; no se descargan recursos externos.
  En Markdown falta el pie con título; se incluyen portada y numeración.
- Creación de certificados autofirmados en Android: RSA 2048/4096, PKCS12 cifrado
  con AES y certificado público PEM. También se puede firmar con un certificado PKCS12 o uno del almacén Android.
- OCR con varios Tesseract a la vez (tres como mucho, según núcleos, memoria y
  tamaño de página): en un OnePlus 6, 40 páginas escaneadas en 80 s.

### Con el resto del teléfono

- **Abrir con y Compartir**: la app sale al abrir o compartir un PDF, una foto,
  un documento de Office, un EPUB, un correo, Markdown o HTML desde otra app.
  Un PDF suelto va al visor; lo demás, a la portada, que ofrece las herramientas
  que lo aceptan. Hasta 50 MB por archivo.
- **Compartir resultados** con la hoja del sistema, sin guardarlos antes.
- **Atajos del icono**: al mantenerlo pulsado salen hasta cuatro favoritas.
- **Atrás** cierra lo que esté abierto (ventana, menú, hoja) y luego vuelve a la
  pantalla anterior; desde el inicio, minimiza.
- Pellizcar amplía las páginas en el visor, no la interfaz entera.

El ciclo actual incorpora las trece herramientas restantes del catálogo:
compresión PDF (incluida optimización web), correo EML/MSG, metadatos PDF e
imágenes, tablas, PDF a EPUB, extracción Markdown, PDF a Word, OCR, PDF/A,
comprobación de firmas, firma con certificado, marca de tiempo y Office a PDF.
Los informes y planes de regresión están en `docs/android-ciclo/pruebas/`.
Se han ejecutado pruebas de motor, navegador, JVM y un emulador Android 30 x86_64,
y el 5 de noviembre de 2026 las 39 herramientas en un teléfono físico (OnePlus 6,
Android 15), sin conexión y opción a opción: qué se probó y qué se arregló, en
[`docs/android-ciclo/telefono-2026-11-05.md`](../../docs/android-ciclo/telefono-2026-11-05.md).
Las piezas para repetirlo están en [`frontend/tests/telefono/`](../tests/telefono/README.md).

La unión conserva el texto, el orden, el índice, los enlaces internos (también
los que van a un destino con nombre), las anotaciones y los formularios con sus
valores. Si dos documentos traen un campo con el mismo nombre, el segundo se
renombra («firmante_2»): con el mismo nombre compartirían valor.

El visor es el de Windows en modo lectura: marcar, anotar, firmar y rellenar
campos no están, porque guardarlos lo hace PyMuPDF en el servidor. La extracción de tablas reconoce rejillas; la reconstrucción editable de PDF
no garantiza reproducir maquetaciones arbitrarias. La inspección EPUB conserva
el límite de las primeras veinte páginas de Windows. La comprobación de firmas
es criptográfica y local: no consulta revocación ni presume confianza en la raíz;
las revisiones incrementales se presentan conservadoramente como cambios
no clasificados. Las marcas de tiempo de una autoridad externa requieren red.

## Datos y límites

Los archivos se guardan en IndexedDB, dentro del espacio privado del WebView.
Se mantienen entre arranques hasta vaciar el espacio de trabajo, borrar los
datos de la app o desinstalarla. Las copias exportadas con el selector de Android
permanecen en el destino elegido. Si se elige un proveedor en la nube, la
transferencia la realiza ese proveedor, no esta app.

La app desactiva el backup automático y la transferencia de sus datos privados.
No incluye anuncios, cuentas ni analítica. La TSA opcional es el único servicio remoto de procesamiento. No pide acceso
general al almacenamiento: el usuario selecciona cada archivo y cada destino.
Las exportaciones temporales se borran al terminar; tras una interrupción se
limpian en el siguiente arranque.

Límites iniciales: 50 MB por archivo de entrada, 250 MB en el espacio de trabajo,
20 megapíxeles por imagen/página rasterizada y cinco minutos por operación
(una hora para el OCR, que crece con las páginas y se puede cancelar).
El trabajo se ejecuta en un worker; cancelar lo termina y descarta sus resultados
sin publicar un lote incompleto. Al crear un certificado, cancelar descarta el
resultado; la generación criptográfica nativa termina antes de admitir otro
trabajo. Android puede matar la app en segundo plano;
los archivos guardados permanecen, pero el trabajo en curso no se reanuda.

## Compilar e instalar

Requisitos: la versión de Node de `frontend/.nvmrc` compatible con su `engines`,
JDK 21, Android SDK con plataforma 36 y Android Studio compatible con Capacitor 8.
Gradle descarga las dependencias en la primera compilación; eso es necesario en
el ordenador de desarrollo, no en el teléfono. En Linux/macOS:

```bash
cd frontend
npm ci
npm run android:apk
```

Configura `JAVA_HOME` y `ANDROID_HOME` en el entorno si Android Studio no los ha
configurado, o `sdk.dir` en `android/local.properties` (no se versiona).
Sale **una APK por arquitectura** en `frontend/android/app/build/outputs/apk/debug/`:
`app-arm64-v8a-debug.apk` es la de casi todos los teléfonos (~140 MB),
`app-armeabi-v7a-debug.apk` la de los de 32 bits, y las dos `x86` sirven para
emuladores. La universal pesaba 427 MB, casi todo de las bibliotecas x86. Puedes
copiarla al teléfono y abrirla, autorizando la instalación desde el gestor de
archivos, o usar `adb install -r` con un dispositivo de pruebas.

En Windows, ejecuta `npm run android:sync`, entra en `android` y usa
`gradlew.bat assembleDebug`. Para abrir el proyecto: `npm run android:open`.

Identificador: `io.github.dvdmsv.cajadeherramientas`. Mínimo declarado: Android 8
(API 26), con Android System WebView 130 o posterior; objetivo: API 36. No se ha
comprobado todavía el funcionamiento en todas las versiones declaradas.

## Pruebas

```bash
cd frontend
npm test -- --watch=false
npm run test:local
# Desde frontend/android: ./gradlew :app:testDebugUnitTest
npm run android:sync
npx playwright install chromium
npm run test:android
```

Las pruebas locales abren los PDF generados con el motor real, comprueban
cifrado, orden, marcadores, aplanado, rechazo de pérdidas y persistencia/cuota.
Las pruebas Playwright ejercitan el build Android a 360×780 y 844×390:
unión, descarga, visor, imágenes y QR. El flujo de unión bloquea cualquier
petición a una API o a otro origen. El servidor de pruebas sólo sirve archivos
estáticos incluidos en la APK. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` permite usar
un Chromium ya instalado.

Estas pruebas no sustituyen una prueba de la APK en un teléfono. En uno físico
ya se han probado el selector de guardado y su cancelación, el uso sin red, el
botón Atrás, el giro y salir y volver a la app; siguen pendientes poco espacio,
documentos cerca del tope de 50 MB y otros fabricantes y versiones. Cómo manejar
la app instalada desde el ordenador está en el informe de esa prueba.
En cada cambio, la CI compila todo y guarda la APK de prueba de arm64 durante
14 días; no publica nada salvo con una etiqueta (ver «Firma y versiones publicadas»).

## Firma y versiones publicadas

Android sólo actualiza una app si la versión nueva va firmada **con la misma
clave**. Sin clave propia, cada ordenador firma con su clave de depuración, y
una APK compilada en otro sitio no se instala encima sin desinstalar la anterior,
que se lleva el espacio de trabajo de la app. Para Google Play, además, la clave
propia es obligatoria.

**La clave se crea una vez y no se pierde nunca**: sin ella no se pueden publicar
más actualizaciones de la app. Se genera fuera del repositorio:

```bash
keytool -genkeypair -v -keystore caja-subida.jks -alias caja \
  -keyalg RSA -keysize 4096 -validity 10000
```

Guarda `caja-subida.jks` y sus contraseñas en un sitio seguro, con copia. Para
que la CI publique, crea en GitHub (*Settings → Secrets and variables →
Actions*) cuatro secretos:

| Secreto | Valor |
|---|---|
| `CAJA_KEYSTORE_B64` | `base64 -w0 caja-subida.jks` |
| `CAJA_STORE_PASSWORD` | la contraseña del almacén |
| `CAJA_KEY_ALIAS` | `caja` |
| `CAJA_KEY_PASSWORD` | la contraseña de la clave |

**Publicar** es empujar una etiqueta `android-vX.Y.Z`. `android.yml` pasa todas
las pruebas y después compila, firma y crea una release con las APK de arm64-v8a
y armeabi-v7a y sus SHA-256. El AAB queda como artefacto del flujo, para subirlo
a Google Play. La release **no** se marca como la última, porque
`releases/latest` es de Windows: de ahí lee su actualizador. Por lo mismo, las
etiquetas de Windows son `vX.Y.Z` y las notas y el aviso de novedades de Windows
no cuentan las de Android.

La versión visible sale de la etiqueta (`CAJA_VERSION_NAME`, de serie 0.8.0), y
el número que Android compara, de la versión: 0.8.0 es 800. El AAB lleva 8000 y
cada APK le suma su arquitectura (armeabi-v7a 1, arm64-v8a 2, x86 3, x86_64 4).

**El primer cambio de clave obliga a desinstalar una vez** la app firmada con la
de depuración. Antes, guarda los resultados que quieras conservar. Con las
cuatro variables `CAJA_*` en el entorno (`CAJA_KEYSTORE` con la ruta del `.jks`),
también la compilación de pruebas se firma con la clave propia y se instala
encima de una versión publicada.

## AAB y Google Play

```bash
cd frontend
npm run android:aab
```

Salida: `android/app/build/outputs/bundle/release/app-release.aab`.
Sin variables de firma es un **AAB sin firmar**, útil para verificar la
compilación, que no se debe subir a Play Console. La APK debug usa la clave de
desarrollo y tampoco es una publicación de producción.

El AAB firmado lo genera la CI al publicar (ver «Firma y versiones publicadas»);
en local, con las cuatro variables `CAJA_*`. No guardes contraseñas ni almacenes
de claves en el repo, y conserva el identificador después de publicar.

Antes de publicar faltan probar más teléfonos y versiones de Android, decidir el alcance de la primera
versión pública, firmar el AAB con tu clave y completar Play Console: ficha,
capturas, contacto, política de privacidad pública, clasificación y declaración
de seguridad de los datos. La política dentro de «Acerca de» describe este build;
la URL pública debe identificar al responsable y su contacto real. No anuncies
las herramientas de Windows que aún no están en Android.

Publica también el código fuente correspondiente y conserva los avisos de
licencia: MuPDF y el proyecto usan AGPL-3.0-or-later. El build incorpora
`assets/legal/LICENCIA.txt` y `assets/legal/AVISOS.txt`.

Referencias oficiales consultadas el 29-10-2026:

- [API objetivo de Google Play](https://support.google.com/googleplay/android-developer/answer/11926878): nuevas apps, API 36.
- [Firma de aplicaciones](https://developer.android.com/studio/publish/app-signing): AAB firmado con la clave de subida y Play App Signing.
- [Pruebas de cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465): para las cuentas a las que aplica, 12 testers durante 14 días antes de solicitar acceso a producción.
- [Política de datos](https://support.google.com/googleplay/android-developer/answer/10144311): política de privacidad dentro de la app y enlazada en Play Console.

## Cómo continuar la adaptación

El catálogo Android vive en `src/app/core/local/catalogo.ts`. `plataforma.ts`
se sustituye sólo con la configuración `android`. El interceptor local resuelve
los contratos de `ApiService` sin enviar tráfico HTTP. Las operaciones están
separadas de Angular y el worker se destruye al terminar para liberar la memoria
WebAssembly. Cada herramienta nueva debe implementar sus opciones y rutas
auxiliares, verificar el resultado y después incorporarse al catálogo.

OCR, Office y firma digital disponen de motores locales incluidos en la APK.
La selección de certificados utiliza KeyChain de Android; no requiere AutoFirma.
Las diferencias de formato y los límites del visor se conservan en la matriz
de paridad y deben ampliarse con pruebas cuando se implementen nuevas opciones.

## Ghostscript incluido desde 0.4.0

El paquete incluye Ghostscript 10.08.0 y su lanzador para ARM64, ARMv7, x86_64
y x86. No se descargan motores, fuentes ni documentos al usar la herramienta.
El lanzador se instala como biblioteca nativa extraída por Android y se ejecuta
mediante `ProcessBuilder`, sin JNI. Tiene límites de CPU y tamaño de salida;
el puente permite cancelar, limita el tiempo a cinco minutos y elimina los
temporales. Si muere el proceso de la app, el lanzador termina también.
Los archivos cruzan el puente por bloques de 512 KB.

Antes de compilar la APK desde un checkout nuevo, genera los binarios (no se
versionan). La primera descarga de las fuentes necesita conexión:

```bash
for abi in arm64-v8a armeabi-v7a x86_64 x86; do
  python3 scripts/android/compilar-ghostscript.py \
    --ndk "$ANDROID_HOME/ndk/28.2.13676358" \
    --directorio /tmp/caja-ghostscript --abi "$abi" --instalar
done
python3 scripts/android/verificar-motores.py
```

Ejecuta esos comandos desde la raíz del repositorio. Después sigue los pasos
habituales de `android:sync` y Gradle. La compilación falla si falta alguna ABI.
El script fija versión y SHA256, corrige la macro incompatible con Bionic,
conserva los avisos de licencia y alinea los segmentos ELF a 16 KB.
La APK utiliza extracción de bibliotecas nativas; no depende del alineado ZIP
para cargar las bibliotecas. El AAB contiene todas las ABI y Play puede entregar
sólo la del dispositivo. El tamaño del paquete aumenta por incluir este motor.

Validación de 0.4.0: 45 pruebas locales, 14 de navegador móvil, siete JVM
(cuatro del proceso Ghostscript y tres de certificados). El motor real compilado
para Linux se probó con texto y gráficos de color: conserva el texto y el tamaño
horizontal, y produce píxeles grises. Esta prueba no sustituye ejecutar Android.
La prueba instrumentada está compilada, pero no ejecutada: no hay teléfono ni
emulador conectado en este entorno. Con un dispositivo conectado:

```bash
cd frontend/android
./gradlew :app:connectedDebugAndroidTest
```

Las fuentes oficiales y los adaptadores se distribuyen junto a los artefactos.
PDF/A, OCR y compresión incorporan rutas propias y pruebas de regresión.

## Distribución de prueba 0.5.0

`dist/android` conserva sólo la distribución más reciente: APK instalable,
AAB sin firmar, fuentes del motor Ghostscript y huellas SHA256. Se retiran las
versiones anteriores después de verificar la nueva. Las APK de instrumentación
quedan en los directorios de compilación de Gradle.

La comparación tiene pruebas de páginas insertadas, texto modificado, documentos
idénticos, cambios de logotipo, recuadros, límites y PDF protegidos. La interfaz
se prueba sin red en vertical y horizontal. No se ha ejecutado en teléfono aquí.

Validación de 0.5.0: 52 pruebas locales, 16 de interfaz móvil, 371 de Angular y
siete JVM aprobadas. APK firmada de prueba y cuatro ABI verificadas.

## Anonimización local desde 0.6.0

Busca DNI, NIE, CIF, IBAN, tarjetas, teléfonos, correo, matrículas y códigos
postales, con las mismas comprobaciones de control que Windows. Las expresiones
de los patrones incorporados se generan desde `backend/api/patrones.py`.
`python3 scripts/android/generar-patrones.py --check` impide que el catálogo y
el corpus de 698 resultados calculados por Python se queden desactualizados.

La búsqueda y el probador se ejecutan en un worker que se termina si supera
diez segundos. El tachado conserva el límite de cinco minutos y la cancelación.
No se modifica el original. Se elimina el contenido antes de dibujar la barra
negra o el hueco blanco; se verifica que el texto y los flujos antiguos no
conserven los datos borrados, también en páginas giradas 90, 180 y 270 grados.

Las expresiones propias usan JavaScript Unicode, con compatibilidad para las
banderas iniciales `(?i)`, `(?m)` y `(?s)` y los escapes del ayudante compartido.
Esto no equivale al motor `re` completo de Python. No se reconocen datos partidos
entre renglones, ni imágenes sin capa de texto; esos PDF necesitan OCR. Se limita
el texto a dos millones de caracteres y las coincidencias a 50000.

Los metadatos y adjuntos quedan intactos. Si hay marcas de tachado pendientes,
la herramienta pide resolverlas antes para no aplicar marcas ajenas a esta
operación. El visor Android todavía no permite tachado manual.

Validación de 0.6.0: 85 pruebas locales, 20 pruebas de interfaz móvil sin red,
371 de Angular y siete JVM. La prueba del patrón atascado comprueba que la
interfaz responde y que después se puede volver a usar el probador. Pendiente
probar esta versión en teléfono real.


## Motores añadidos en 0.7.0

Antes de `npm run android:sync`, prepara los motores desde la raíz del proyecto.
El NDK es 28.2.13676358 y CMake 3.22.1; ajusta las rutas de tu SDK:

```bash
for abi in arm64-v8a armeabi-v7a x86_64 x86; do
  python3 scripts/android/compilar-qpdf.py --ndk "$ANDROID_HOME/ndk/28.2.13676358" --cmake "$ANDROID_HOME/cmake/3.22.1/bin/cmake" --directorio /tmp/caja-qpdf --abi "$abi" --instalar
  python3 scripts/android/compilar-metadatos.py --ndk "$ANDROID_HOME/ndk/28.2.13676358" --cmake "$ANDROID_HOME/cmake/3.22.1/bin/cmake" --directorio /tmp/caja-metadatos --abi "$abi" --instalar
done
python3 scripts/android/preparar-libreoffice.py --ndk "$ANDROID_HOME/ndk/28.2.13676358" --directorio /tmp/caja-office
python3 scripts/android/verificar-motores.py
```

La CI ejecuta estas mismas preparaciones. Las descargas se verifican mediante
SHA-256. `libreoffice-motores.json` fija APK oficiales por ABI y la huella del
archivo fuente correspondiente. Los recursos originales de Office no se
versionan: el script los extrae. Los avisos completos y licencias tipográficas
sí están en `frontend/src/assets/legal` y se incorporan a «Acerca de».

Las bibliotecas de 64 bits están alineadas a 16 KB. Las bibliotecas oficiales de
LibreOffice de 32 bits mantienen alineación de 4 KB para dispositivos heredados;
no se anuncian como compatibles con páginas de 16 KB. El verificador comprueba
todas las bibliotecas del paquete, no sólo los lanzadores.

Office incluye once formatos (DOC/DOCX/ODT/RTF/TXT/XLS/XLSX/ODS/PPT/PPTX/ODP),
33 fuentes tipográficas y un proceso cancelable. La APK universal incluye las
cuatro arquitecturas y es considerablemente mayor; Google Play genera paquetes
por arquitectura a partir del AAB. La publicación sigue requiriendo la clave de
subida, las pruebas en dispositivos físicos y la ficha de Play Console.

PDF/A-1b: si distintas fuentes reutilizan el mismo nombre y glifo para caracteres
diferentes, la restauración se detiene y propone PDF/A-2b; no publica texto corrupto.
Prueba portable: `npm run test:local -- tests/local/pdfa-restauracion.test.ts`.
Con `PDFA_GS_LIB_DIR` y `PDFA_VERAPDF` se ejecutan también ocho conversiones
reales y validaciones de conformidad; sin esos motores se omiten explícitamente.

Regresión de permisos de firma (Python con pyHanko, PyMuPDF y cryptography;
JDK 21 en PATH y dependencias Gradle descargadas):

```bash
python3 frontend/tests/native/tiempo/run.py --repo . --sdk "$ANDROID_HOME" --output /tmp/caja-tiempo-regresion
```

Genera certificados y PDF sintéticos, simula la TSA y comprueba 175 condiciones
de DocMDP/FieldMDP sin enviar datos a servicios externos.
