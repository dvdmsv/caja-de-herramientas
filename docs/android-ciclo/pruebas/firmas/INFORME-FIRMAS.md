# Comprobar firmas — prueba independiente offline

Snapshot `/tmp/caja-ciclo/firmas`. Se ha ejecutado **FirmasPdf.java original** con PDFBox Android2.0.27.0 y BC1.79 reales en JVM21. No se ha cambiado implementación ni principal.

Resultado: **20 casos con PDFs reales: 16 pasan y 4 fallan**, agrupados en dos hallazgos. Otros seis PDFs generados por SellarPdf en la auditoría de firma verifican correctamente RSA/EC/DSA y sus segundas firmas. Sin falsos resultados positivos observados.

## F01 — no separa vigencia e integridad, prioridad media

PDFs `expired.pdf` y `future.pdf`: CMS criptográficamente válido pero certificado fuera de vigencia al firmar. El contrato separa `intacta` y `vigente_al_firmar`; baseline pyHanko devuelve `intacta=true`, `vigente=false`, cobertura completa e identidad.

Android devuelve error `verifier not valid at signingTime`, intacta/vigente null, cobertura desconocida y firmante desconocido. Causa localizada: `signer.verify(verifier)` con verifier construido desde el certificado comprueba su vigencia y lanza antes de calcular los campos del informe. No se informa de la circunstancia concreta de forma estructurada.

Control adicional aprobado: `expired-now-valid-then.pdf`, certificado caducado hoy pero firma de hace diez días, cuando era válido, devuelve intacta=true y vigente=true. No se debe sustituir vigencia histórica por vigencia actual.

## F02 — bytes manipulados quedan como desconocidos, prioridad media

`tampered.pdf` cambia la metadata firmada `Original title` por `Tampered title`, conservando longitud y estructura. `malformed-date.pdf` modifica /M del diccionario PDF sin tocar fecha firmada CMS. En ambos el hash ya no coincide.

Baseline pyHanko devuelve `intacta=false`; Android devuelve error `message-digest attribute value does not match calculated value` con intacta=null, cobertura desconocida e identidad perdida. La detección no aprueba la firma incorrectamente, pero incumple el diagnóstico esperado de documento modificado.

Controles aprobados: alterar un bit del valor criptográfico de la firma en CMS (`bad-signature.pdf`) sí devuelve intacta=false; modificar bytes de un PDF DocTimeStamp (`tampered-doctimestamp.pdf`) también devuelve intacta=false. La discrepancia se produce en la excepción del message-digest del CMS normal.

## Casos aprobados

- RSA2048, EC P-256 y DSA2048 autofirmados: identidad, emisor, fecha, autofirmado, integridad y cobertura completa.
- Dos firmas: ambas íntegras, primera cubre revisión y segunda archivo completo.
- Cola añadida tras firma: integridad permanece válida, cobertura revisión y cambios desconocidos.
- DocTimeStamp RFC3161 offline y firma CMS con atributo timestamp: fechas y hash correctos. TSA dummy de pyHanko, sin freetsa ni petición remota.
- Firma criptográfica alterada y DocTimeStamp con documento manipulado: intacta=false.
- PDF sin firmas: lista vacía.
- CMS malformado: error por firma, sin caída del proceso.
- ByteRange inicial distinto de cero, negativo, fuera del archivo y con tres elementos: error de rango, sin caída del proceso.
- Certificado expirado hoy pero válido al firmar: vigencia histórica correcta.
- Compatibilidad con seis fixtures RSA/EC/DSA, una/dos firmas, creados por SellarPdf original desde la auditoría de test_correo.

## Reproducción y artefactos

Desde el snapshot:

```
/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python independiente/fixtures.py
/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python independiente/mutations.py
java -cp "independiente/classes:$(cat independiente/classpath.txt)" io.github.dvdmsv.cajadeherramientas.Check independiente/fixtures/*.pdf > independiente/report.jsonl
/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python independiente/baseline.py > independiente/baseline.jsonl
python3 independiente/assertions.py
```

`fixtures.py` genera claves/certificados de prueba y PDFs mediante pyHanko. `mutations.py` conserva longitudes al manipular metadata/CMS/rangos. `baseline.py` replica la comprobación usada en backend: ValidationContext sin raíces ni red, y compara integridad/cobertura/vigencia. `assertions.py` contiene expectativas y termina con cuatro fallos de F01/F02. Las claves y certificados son exclusivamente de prueba y se generan localmente.

Resultados conservados: `independiente/report.jsonl`, `baseline.jsonl`, `tests.log`, `native-created.jsonl`; fixtures en `independiente/fixtures/`.

Arnés: `independiente/classpath.txt` fija jars efectivos. `independiente/java/.../Check.java` llama al método original. Para compilar se usó javac con ese classpath, FirmasPdf.java original, stubs JSON locales y Log compartido por test_correo. No se sustituyó PDFBox por otra implementación.

## Diferencias del entorno y límites

Únicos stubs: android.util.Log, que descarta mensajes, y org.json JSONObject/JSONArray/JSONException para almacenar/serializar resultados en JVM, con semántica put(null) elimina y JSONObject.NULL conserva null. El JSON Android de android.jar no se puede ejecutar en host. Los stubs no participan en CMS, certificados, fechas, ByteRange ni lectura PDF. No hay prueba Android/WebView/Capacitor ni de la UI en esta auditoría.

La clasificación de modificaciones posteriores es deliberadamente conservadora: no distingue anotaciones, relleno de campos, DSS o cambios de contenido. `cambios desconocidos` no equivale a una modificación permitida. La cobertura se infiere con heurísticas ByteRange/Contents/EOF, no con análisis completo de todas las revisiones. No se ha demostrado resistencia a todo el corpus de PDFs maliciosos o estructuras ambiguas.

No se establece confianza CA, revocación, identidad acreditada ni cumplimiento de política criptográfica; todos los certificados de estos fixtures son autofirmados. DSA2048 comprueba integridad criptográfica pero puede rechazarse bajo una política de algoritmos más exigente. No se han realizado consultas OCSP/CRL/AIA/TSA externas.

Versiones: PDFBox Android2.0.27.0, BC1.79 (bcprov/bcpkix/bcutil), OpenJDK21.0.12.1, android.jar API35 sólo para tipos; pyHanko0.36.2, pyhanko-certvalidator0.31.4, cryptography50.0.1, PyMuPDF1.25.5. SHA256 FirmasPdf original: b5979720818851872111fdfe00719b03d19183fe3dd43cff2ff6f47b67397337.

No se han aplicado reparaciones. Hallazgos reservados para la fase final tras las 13 herramientas.
