# Pruebas independientes: marca de tiempo Android

Dos defectos pendientes: **M01 bajo**, año cero admitido en fecha visible; **M02 medio**, el sellador permite un PDF que ya incumple las restricciones de su certificación anterior. No se ha cambiado código del proyecto principal ni corregido hallazgos.

**Visible:** 24 pruebas, 23 pasan y una falla. **Criptográfico:** el arnés termina con 112 comprobaciones internas superadas y un escenario de permisos fallido. La firma y huella de los sellos generados se verifican además con **OpenSSL** y **pyHanko** independientes.

## Entorno y alcance

Copia `/tmp/caja-ciclo/tiempo`. Node 22.23.2, MuPDF.js 1.28.1, Vitest 4.1.11. Java 21 con PDFBoxAndroid 2.0.27.0 y BouncyCastle 1.79 reales del caché de dependencias. Único stub Android usado: `android.util.Log`; no sustituye el motor PDF ni criptografía. Se compilan los originales `FirmasPdf.java` y `SellarPdf.java` de la copia.

La TSA es sintética, con certificado RSA que contiene EKU crítico exclusivamente de timestamping. `URLStreamHandlerFactory` intercepta la conexión HTTPS en el proceso de prueba y entrega una `HttpURLConnection` en memoria. **No se enviaron documentos ni solicitudes a una TSA real.** Se comprueban URL HTTPS fija, método, cabeceras, límites, timeouts y mensajes ASN.1; no se prueba TLS/DNS real de Android.

Lectores independientes: OpenSSL 3.0.13 y pyHanko del entorno `backend/.venv`. No hay dispositivo Android.

## M01 — Bajo: permite año 0000

Código: `marca-tiempo.ts`, validación de la fecha. La expresión regular acepta cuatro dígitos y `Date.parse` admite año cero; falta restringir el año al intervalo compatible con el contrato Windows.

Reproducción: test `rechaza año cero como Windows`, fecha `0000-01-01T00:00:00Z`.

Esperado: rechazo, como `datetime.fromisoformat` del backend Windows.

Observado: produce PDF con `01/01/0000 00:00:00 UTC+00:00`.

## M02 — Medio: sella un documento con DocMDP previamente incumplido

Código: `SellarPdf.ejecutar`, comprobación de permisos antes de `addSignature`. Sólo inspecciona `/Perms/DocMDP/Reference/TransformParams/P` y rechaza P=1. No analiza si las revisiones anteriores ya infringieron DocMDP/FieldMDP.

Fixture:

1. `auditoria/certificada.pdf`: certificación real pyHanko, DocMDP P=2, intacta y permitiendo formularios/firmas.
2. `auditoria/certificada-alterada.pdf`: revisión incremental que sustituye `/Contents` de página por un rectángulo, operación no permitida por esa certificación.
3. pyHanko `compute_integrity_info()` confirma `docmdp_ok=False` y modificación `OTHER` antes de sellar.

Esperado: rechazo antes de consultar la TSA, según `_comprobar_permisos` en `backend/api/tools/marca_de_tiempo.py`.

Observado: `SellarPdf.ejecutar(..., sello=true, ...)` consulta la TSA una vez y produce `certificada-alterada-sellada.pdf`. El nuevo sello es íntegro, pero la certificación anterior continúa con `docmdp_ok=False`. El log del arnés marca el escenario como FAIL y termina con código 1.

No se afirma que el nuevo sello valide o sanee la certificación anterior. El defecto es saltarse la condición de admisión que mantiene Windows y que debería impedir esta operación. Sobre `certificada.pdf` sin alterar, añadir sello sí conserva íntegra la firma anterior y `docmdp_ok=True`.

## Comprobaciones que pasan

### Fecha visible

- Fecha, segundos y desplazamiento UTC correctos en todas las páginas; original inmutable.
- Fecha bisiesta y offsets hasta ±14:00 válidos; fechas imposibles, segundos 60, hora 24, desplazamientos fuera de rango y fecha sin zona rechazados.
- Rotaciones 0/90/180/270: texto dentro de los límites visibles.
- Preview JPEG coincide byte a byte con el render del PDF final para la página pedida; página inexistente rechazada.
- Modo criptográfico rechazado por el motor visible, sin sustitución automática.
- Rechazo de PDF con sello RFC3161 **real** tanto al convertir como al previsualizar, además del fixture sintético ByteRange.
- Posición, fuente, tamaño, color y alineación; error de texto que no cabe.

### RFC3161

- Solicitud SHA256 con nonce, petición del certificado y menos de 200 bytes: sólo huella y datos RFC3161.
- URL exacta `https://freetsa.org/tsr`, POST y tipo `application/timestamp-query`; sin redirecciones; timeouts configurados 5 s/10 s.
- Rechazo de nonce distinto, huella distinta, certificado ausente, firma del token alterada, HTTP 503/302 y respuesta mayor de 1 MB.
- Cancelación previa sin consulta; fallo TSA elimina la salida parcial y no crea fecha visible.
- `/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`, digest del ByteRange y firma del token correctos.
- Dos sellos consecutivos en revisiones incrementales; prefijo de cada revisión anterior idéntico.
- OpenSSL verifica token contra bytes firmados y rechaza esos bytes cuando se altera uno.
- pyHanko confirma ambos sellos `intact=True, valid=True`, cobertura de revisión para el primero y de archivo completo para el segundo.

**Confianza:** pyHanko usa `trust_roots=[]`, `allow_fetching=False` y declara `trusted=False`, como corresponde al certificado sintético no confiado. OpenSSL usa explícitamente el certificado de prueba como ancla sólo para ese ensayo. Ningún resultado implica confianza pública, revocación comprobada o validación legal de una TSA real.

## Reproducción y evidencias

```
cd /tmp/caja-ciclo/tiempo
python3 auditoria/ejecutar-arnes.py
/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python auditoria/preparar-permisos.py
python3 auditoria/ejecutar-arnes.py
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/tiempo-auditoria.test.ts
/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python auditoria/validar-pyhanko.py
openssl ts -verify -token_in -in auditoria/ultimo-token.tst -data auditoria/ultimo-contenido.bin -CAfile auditoria/tsa.pem
```

La primera ejecución del arnés genera `base.pdf`; tras preparar los permisos, la segunda devuelve código 1 por M02. La suite visible devuelve código 1 por M01. Las pruebas trabajan sobre la copia; el caché de dependencias y el entorno Python sólo se leen.

- `pruebas-visible.log`, `tests/local/tiempo-auditoria.test.ts`.
- `auditoria/java/ArnesTiempo.java`: mock TSA, solicitudes, errores y sellado incremental.
- `auditoria/criptografico.log`, `auditoria/permisos-previos.log`, `auditoria/pyhanko.log`.
- `auditoria/openssl-verificacion.log`, `auditoria/openssl-alterado.log`.
- PDF, certificado sintético y token RFC3161 conservados en `auditoria/`.

## Limitaciones

No prueba conectividad TLS real, disponibilidad de FreeTSA, cancelación durante una lectura de red bloqueada, AndroidKeyStore/KeyChain, revocación, cadenas confiables reales ni límites de memoria en teléfono. Se probaron las revisiones y el caso DocMDP descritos; no todas las combinaciones FieldMDP/certificación. No equivale a aprobar el resto del motor de firma, que está siendo auditado por otros subagentes.

Huellas SHA256 de la copia:

- `marca-tiempo.ts`: `9d807badc285483339b37376e8f1955f7a35c33023e8b450abc9819b609da0ec`
- `SellarPdf.java`: `e0e5e894816d7d5142fa17b04077f534d451359f6a7503a1bcba8c623b9afa87`

Las correcciones y su plan final quedan reservados para la fase acordada tras recorrer las 13 herramientas.
