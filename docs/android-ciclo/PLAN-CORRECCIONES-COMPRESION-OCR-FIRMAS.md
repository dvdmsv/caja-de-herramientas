# Plan concreto de reparación y regresión — sin cambios de implementación

Orden propuesto: O01 → C01 → F01/F02 → Q02 → Q01 → Q03. O01 y C01 pierden contenido; deben bloquear la incorporación de sus rutas afectadas al catálogo. Q01 bloquea la distribución, aunque no bloquea probar las reparaciones. Ninguno de los casos de firmas ensayados fue aceptado falsamente.

## 1. O01: preservar contenido al reconstruir páginas

**Causa acotada con evidencia nueva:** el Form que contiene la página reconstruida es stream válido en memoria. Deduplicar objetos al guardar con garbage3/4 hace que se reabra como un diccionario sin stream. No ocurre con garbage0/1/2. Guardar0 → reabrir → guardar4 también funciona: el problema depende del estado del documento recién injertado, no de que el PDF serializado sea intrínsecamente inválido. No está probado si el origen exacto es una invariancia incumplida en nuestro injerto o un fallo interno MuPDF; evitar afirmarlo.

**Corrección conservadora aplicable:** en los caminos que ejecutan quitarTextoInvisible, guardar con garbage2, que elimina/compacta objetos sin deduplicarlos. Debe aplicarse en OCR rehacer y limpieza profunda de metadatos. No cambiar globalmente guardarPdf a otro modo ni rasterizar la página. La elección debe quedar explícita en la ruta que reconstruye o encapsulada en un helper de guardado de reconstrucción. No basta arreglar sólo ocrPdf: metadatos-pdf llama al mismo helper y guarda después. Coordinar con M01 de test_correo, que impide recorrer diccionarios cuando un xref es array; primero superar ese bloqueo para probar salida profunda.

Evidencia del cambio de política (sólo diagnóstico, sin tocar implementación): `/tmp/caja-ciclo/ocr/tests/independiente/alternative-diagnostic.json` registra cero canales distintos en los cinco fixtures, visible conservado, Tr3/alfa0 retirados. En `objects-before.json` se comprueba isStream=true antes de serializar. El posible coste es un PDF mayor que con deduplicación4, no pérdida visual.

**Puerta de regresión:**
1. Reutilizar tests/independiente/*-in.pdf del snapshot OCR y el test directo de quitarTextoInvisible. Guardar y abrir una instancia nueva antes de comparar; comparar sólo el documento en memoria no detecta el fallo.
2. Los cinco casos redo-visible, redo-hidden, redo-alpha0, redo-rotated-crop y redo-visible-only deben conservar render canal a canal, bounds y enlaces; visible debe seguir seleccionable y CAPA ANTIGUA debe desaparecer.
3. Ejecutar OCR real después del cambio, no sólo el helper: el texto raster España/año/Información/útil aparece, visible se mantiene una sola vez y oculto antiguo no aparece. Probar segunda ejecución rehacer para evitar duplicados y pérdida acumulativa.
4. Añadir multipágina con fuentes/imágenes/Resources compartidos, contenido Form anidado, texto de trazo y clip de texto, grupos de transparencia/soft masks y páginas con CropBox/Rotate. Comparar gráficos y textos tras guardar/reabrir. Si clipping depende del texto, eliminar su pintura no debe eliminar su efecto de recorte.
5. Limpieza profunda: los mismos fixtures deben conservar contenido visual y retirar sólo metadatos/oculto acordados, después de superar M01. Comprobar también limpieza normal para no activar sin querer la política de reconstrucción.
6. No modificar estructura-pdf por O01: EPUB/Word no llaman a quitarTextoInvisible; son consumidores aguas abajo. Hacer una regresión de pipeline con PDF OCR corregido y profundo corregido → estructuraPdf → Word y EPUB: palabras visibles/OCR esperadas presentes una sola vez, CAPA ANTIGUA ausente, imágenes mantenidas, orden conocido de página y tablas consistente entre formatos. Al compartir estructuraPdf, arreglar una inferencia en ese helper exige ejecutar ambas suites, no sólo el formato que detectó el fallo.
7. Cancelar entre páginas, no guardar salida parcial, y ejecutar otro OCR después. Mantener pruebas de español y límites de memoria. No convertir la precisión spa+eng o orientación90 automática en criterios ya garantizados: hoy son limitaciones documentadas.

## 2. C01: no recomprimir máscaras de otras imágenes

**Corrección:** hacer una pasada previa de referencias que recoja todos los objetos usados como SMask o Mask de otra imagen (Mask array de color-key no es una imagen). Saltarlos en la pasada de recomprimir, además de las exclusiones actuales por máscara propia e ImageMask. El conjunto debe usar identidad estable de objeto/xref y cubrir máscaras compartidas; no comparar wrappers JS por igualdad. Mantener gris, dimensiones y bytes de las máscaras. Como variante muy conservadora se puede excluir de recomprimir todas las imágenes de gris, pero perdería compresión válida y no expresa el motivo real; preferible identificar referencias.

**Regresión:**
- Test fallido `compresion/tests/local/compresion-independiente.test.ts`: imagen alfa variable con máscara >20KiB deja SMask DeviceGray y no DCTDecode.
- Imagen alfa constante, alfa variable, Mask explícita monocroma, ImageMask stencil, máscara compartida por varias imágenes y máscara dentro de Form. Antes/después de guardar/reabrir: apariencia y bordes alfa exactos para las imágenes omitidas; máscara no convertida ni redimensionada.
- Imagen RGB sin transparencia sí reduce tamaño y dimensiones y conserva cuadrantes/texto/enlaces. Gris normal sin rol de máscara sigue siendo candidato si el algoritmo lo permite.
- Repetir niveles suave/media/fuerte y ladder objetivo/minimo, porque el conjunto de exclusión debe regenerarse correctamente por pasada; ejecutar dos veces para descubrir cambios acumulativos.
- Pipeline con imagen transparente → compresión → EPUB/Word: no introducir imagen negra, RGB opaco ni pérdida de máscara. Si los exportadores ya tienen limitación propia, registrarla separada, sin atribuirla al arreglo C01.

## 3. F01/F02: separar certificado, hash, firma y cobertura

**Corrección F01:** resolver certificado e identidad y parsear fecha firmada antes del paso criptográfico. Para firmas CMS ordinarias, verificar con la clave pública (`JcaSimpleSignerInfoVerifierBuilder.setProvider(BC).build(cert.getPublicKey())`, overload confirmado en BC1.79), y calcular vigencia histórica por separado. Así no se corta por verifier not valid at signingTime. No capturar esa excepción y asumir intacta=true: hay que verificar realmente los bytes y firma. Mantener selección de certificado por SID y sin afirmar confianza CA.

**Corrección F02:** una vez CMS/certificado/rango son parseables, una discrepancia message-digest (`CMSSignerDigestMismatchException`) es intacta=false. Retener identidad, fecha, vigencia y cobertura calculable. No convertir cualquier CMSException en false: ASN.1 roto, certificado ausente o algoritmo no admitido deben seguir siendo desconocidos con error. Capturar condiciones concretas, no mensajes en inglés.

**Timestamp:** no reemplazar ciegamente el verifier del TimeStampToken por una clave pública: token.validate también exige certificado asociado y verifica ESS/EKU/imprint. Mantener validación de token separado. En firma con sello fallido, distinguir integridad de la firma principal y validez del sello; no marcar bueno el sello por tener fecha. La fecha firmada autodeclarada no se vuelve fecha acreditada sin sello válido.

**Regresión:**
- `firmas/independiente/fixtures` y baseline pyHanko ya conservados: RSA/EC/DSA intactas; expired/future deben tener intacta=true y vigente=false, con identidad/cobertura; expired-now-valid-then debe seguir vigente=true.
- tampered y malformed-date: intacta=false, datos del certificado disponibles y fecha CMS original cuando parseable; bad-signature ya false debe seguir así.
- CMS/rangos malformados quedan desconocidos con error, no falsas aprobaciones. Campos sin fecha ⇒ vigente=null; fecha PDF /M no debe sustituir silenciosamente fecha firmada CMS válida.
- Firma CMS con timestamp, DocTimeStamp bueno y DocTimeStamp alterado; token de otra firma y token con certificado/ESS inválido deben rechazarse como sello.
- Múltiples firmas: informe independiente para cada una, primera revision, última todo; añadir una firma nueva no debe borrar la identidad de la anterior.
- Reejecutar los seis fixtures creados por SellarPdf de test_correo y confirmar compatibilidad RSA/EC/DSA.
- Mantener cambios desconocidos para revisiones no analizadas. No proponer relajarlo a nada o a modificación permitida mientras no exista análisis de diferencias.

## 4. Q02: seleccionar por tamaño final linearizado

**Corrección:** cuando web=true, coordinar candidatos de compresión y qpdf para decidir con blob final, no con el intermedio. Recorrer desde menor pérdida; linearizar candidato y parar sólo si ese archivo final cabe. Si no cabe, probar siguiente. Si ninguno cabe, devolver el menor FINAL y logrado=false. Reutilizar resultado ya calculado; no volver a linearizarlo después. Para nivel fijo, aplicar sólo ese nivel y una linearización.

Si original ya cabe, aun así hay que medir su salida linearizada: el overhead puede sacarlo del límite. No hacer fallback al original no linearizado para fingir que web se cumplió. Mantener resumen.despues/objetivo/logrado sobre bytes efectivamente guardados.

`/minimo` debe recibir web y medir mínimo final con igual política; la compresión JPEG no es estrictamente monótona, así que no prometer mínimo por medir sólo el último escalón. El frontend cachea mínimo por id: incluir web/opciones relevantes en la clave o invalidar al cambiar web. Validar que el endpoint y ApiService transportan la opción hasta el cálculo; modificar sólo el motor no basta.

**Regresión:** fixture Q02 (target82575, seleccionado82575, final83230, alternativa3774) debe alcanzar objetivo con linearización válida; comprobar --check-linearization y conservación de texto/enlaces. Añadir original justo bajo objetivo, límite exacto, imposible, archivo sin imágenes, nivel ninguno, cambio web false→true con mínimo ya cacheado, y cancelación entre candidatos/liberación del trabajo qpdf. Avisos de tamaño siempre sobre archivo final.

## 5. Q01: avisos de qpdf completos

**Corrección:** incluir LICENSE.txt y NOTICE.md aplicable de qpdf en QPDF.txt además de JPEG README. No basta el copyright que devuelve el ejecutable. El crypto nativo incluye SHA-2 cuyo aviso RNRT/SAPHIR está en NOTICE. Incluir también versión/fuente/hash JPEG para trazabilidad. Verificar que el generador de avisos agregado incluye QPDF.txt y que éste llega al APK/AAB final.

**Regresión:** build limpio con --instalar; comprobar QPDF.txt contiene copyright qpdf, licencia SHA-2, JPEG y Apache; generar AVISOS y extraer del APK/AAB para buscar las mismas atribuciones. Comprobar preBuild exige libqpdfrun.so para cuatro ABI. Esto era pendiente de integración en snapshot, no asegurar que siga faltando en principal.

## 6. Q03: fuente extraída y entorno de build reproducibles

**Corrección:** no tratar directorio existente como fuente verificada sólo porque el tar pasa SHA. Para build limpio, extraer el tar verificado a un directorio controlado nuevo y crear copia JPEG por ABI desde esa fuente, sin reutilizar silenciosamente árboles editados. Una caché incremental debe comprobar un manifiesto de contenidos/parches o fallar cuando está sucia; no borrar directorios ajenos al build. Registrar versión NDK/CMake, opciones, hashes de fuentes y resultados por ABI. No prometer binarios idénticos si sólo se han fijado fuentes.

**Regresión:** adaptar source-cache-check.py para que modificar fuente extraída no afecte sin detección; tar con hash erróneo debe rechazarse antes de instalar; build nuevo por ABI con mismo entorno; inspeccionar PIE, dependencias y alineación LOAD16KiB. Ejecutar dos builds limpios y comparar hashes, o documentar causas de diferencia (paths/build-id/fecha) y normalizarlas si se requiere igualdad binaria. Pruebas host qpdf conservadas no sustituyen abrir/ejecutar binarios Android ni instalar APK.

## Entrega y criterios finales

Aplicar un cambio por causa y ejecutar sus pruebas pertinentes; integrar después el lote de regresión de rutas compartidas. No usar sólo tsc/build como evidencia de conservación. Para O01/C01 es obligatorio guardar/reabrir y renderizar. Para firmas comparar flags y campos con baseline sin red; para Q02 comprobar tamaño y linearización del archivo descargable. APK en teléfono y WebView siguen pendientes: los informes host no los certifican.

Evidencias base: `/tmp/caja-ciclo/{compresion,qpdf,ocr,firmas}/INFORME*.md`, tests y fixtures de cada snapshot. No se ha modificado principal ni aplicado los arreglos de este plan.
