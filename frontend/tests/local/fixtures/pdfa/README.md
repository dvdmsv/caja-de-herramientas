# Corpus portable de restauración de texto PDF/A

Los PDF son sintéticos. Los originales contienen español acentuado, griego y cirílico; variantes CropBox/Rotate0/90/180/270, fuentes subdivididas, páginas mixtas y un carácter suplementario U+1F600. Los `*-aplanado.pdf` son salidas pre-generadas con Ghostscript10.08.0 y el perfil sRGB de la aplicación, PDF/A-1b. `manifest.json` identifica los8 casos positivos y sus SHA256.

Los tests locales **no ejecutan Ghostscript, Java, veraPDF ni red**, y no dependen de rutas temporales del autor. Reconstruyen las capas con MuPDF y comprueban al reabrir: texto original normalizado, geometría, píxeles idénticos al aplanado y ausencia de cambios en el control opaco. Las fuentes DejaVu incrustadas se distribuyen con su aviso en DEJAVU-LICENSE.txt.

Desde frontend:

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdfa-restauracion.test.ts
```

Se esperan8 aprobadas y8 pruebas de integración omitidas.

## Integración opcional: segunda GS y veraPDF

Requiere Java/Javac, motor Ghostscript para el **host** que incluya libgsrun.so y sus bibliotecas en un directorio, y veraPDF instalado. No usar un ejecutable Android sobre Linux. Los motores se preparan externamente; el test no descarga nada.

```
PDFA_GS_LIB_DIR=/ruta/motor-host \
PDFA_VERAPDF=/ruta/verapdf/verapdf \
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdfa-restauracion.test.ts
```

Se esperan16 aprobadas. El arnés compila MotorGhostscript.java actual y tests/native/pdfa/ProbarPdfa.java en un directorio temporal propio, procesa la capa restaurada por PDF/A1 y valida texto y conformidad con veraPDF. Borra temporales al terminar. El PS/ICC equivalen al plugin. No certifica todas las entradas posibles ni sustituye pruebas de WebView/Android.

## Rechazo de colisiones

`collision-original.pdf` contiene dos fuentes llamadas DejaVuSans, con el mismo glifo36: una lo mapea a U+0041(A) y otra a U+0391(Α). El original extrae A/Α; mezclar mapas por nombre sobrescribe el primer valor y corrompe a Α/Α. `collision-aplanado.pdf` permite probar su rechazo sin ejecutar GS.

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdfa-colision.test.ts
```

Este test exige rechazo explícito. Debe incorporarse junto con el guard de mapa ambiguo, pues falla contra la versión previa que sobrescribía silenciosamente. No es un noveno caso positivo del manifest ni debe enviarse al test de conformidad como si tuviese salida válida.
