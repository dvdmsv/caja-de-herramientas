# Revisión independiente qpdf — snapshot 30 octubre 2026

Se ha trabajado exclusivamente en `/tmp/caja-ciclo/qpdf`; node_modules sólo leído. No se han corregido módulos de aplicación, scripts de build ni el C01 previo. Las pruebas usan el snapshot suministrado: las modificaciones posteriores del principal no están evaluadas.

## Resultado

- 11/11 pruebas Vitest del puente TS y LocalService pasan (5 existentes + 6 independientes).
- 5/5 comprobaciones del motor Java pasan: argv, código warning 3, rechazo exit2/salida inválida, cancelación antes y durante el proceso (ver agrupación en native.log).
- 2/3 pruebas qpdf real pasan; 1 falla y confirma Q02.
- C01 de compresión/transparencia continúa pendiente; no se ha vuelto a corregir ni a aprobar.

## Q01 — Avisos incompletos, prioridad alta antes de distribuir

`compilar-qpdf.py:61` genera QPDF.txt con LICENSE.txt y README JPEG; omite NOTICE.md de qpdf. La fuente incluye copyright qpdf y la licencia del SHA-2 procedente de sphlib/Projet RNRT SAPHIR. El build fuerza REQUIRE_CRYPTO_NATIVE y compila sha2.c/sha2big.c. Ningún aviso entregado en este snapshot contiene RNRT/SAPHIR/Berkenbilt. El ejecutable `--copyright` muestra copyright qpdf, pero no la licencia SHA-2.

Reproducir: comparar `/tmp/caja-qpdf-build/qpdf-12.4.2/NOTICE.md` con `src/assets/legal/QPDF.txt`, y buscar `RNRT|SAPHIR` en los avisos. Deben distribuirse los avisos aplicables del código integrado. No es una evaluación jurídica general.

## Q02 — Objetivo de tamaño alcanzable se abandona antes de qpdf, prioridad media

Test reproducible `tests/local/qpdf-real-independiente.test.ts`, caso Q02. MuPDF produce un PDF de 82.575 bytes que cabe exactamente en el objetivo. qpdf --linearize añade datos y devuelve 83.230 bytes. Otra compresión disponible, procesada por el mismo qpdf, ocupa 3.774 bytes: el objetivo era alcanzable. La selección se detiene antes de considerar el tamaño final.

`LocalService:125-139` sólo lineariza el candidato ya elegido y actualiza logrado=false; no continúa con el siguiente nivel. La actualización de resumen/objetivo es correcta y está probada. Es el criterio de selección el que resulta insuficiente.

Relacionado: `/minimo` fuerza web=false y no mide la salida linearizada, por lo que su mínimo no representa el mínimo web. Debe contemplarse junto al mismo criterio de tamaño final.

## Q03 — Caché de fuentes extraídas no revalidada, prioridad baja para reproducibilidad

`source()` verifica el tar descargado, pero reutiliza el directorio extraído si ya existe. Una edición previa de ese directorio cambia las fuentes compiladas aunque el SHA del tar siga coincidiendo. La copia JPEG por ABI también se reutiliza.

Reproducir: `python3 tests/native/source-cache-check.py`; imprime `Contenido usado pese a archivo fuente tar verificado: modificado`. Es un límite de reproducibilidad de compilaciones incrementales, no una vulnerabilidad remota. No se ha demostrado igualdad binaria entre dos compilaciones limpias y el script no fija versión NDK/CMake.

## Comprobaciones aprobadas

Puente: operación linearizar correcta; no llama grises; conserva nombre y bytes; transfiere bloques; valida tamaños y lecturas truncadas; libera al fallar/cancelar; no publica lotes parciales. LocalService actualiza resumen/objetivo con tamaño final; cancelación HTTP y endpoint de progreso impiden guardar; limpia nativo. Para probar esta rama se habilita comprimir-pdf desde el test: el snapshot aún no registra el slug en catálogo. No se ha alterado catálogo ni implementación.

Motor Java: ejecuta exactamente `libqpdfrun.so --linearize -- <entrada> <salida>` sin shell; acepta exit3 sólo web; rechaza error2 y cabecera inválida; cancela proceso activo y confirma que PID ha terminado; cancelación previa evita arrancar.

qpdf12.4.2 real compilado para host: `--check-linearization` pasa. Un PDF MuPDF con texto, enlace, geometría e imagen alfa variable conserva exactamente texto, enlaces, bounds y píxeles renderizados. Rechaza PDF roto y protegido con contraseña. Esta prueba directa evita el módulo de compresión con C01.

Build/ELF: hashes de tar qpdf y JPEG coinciden con script. ARM64 observado es PIE, intérprete /system/bin/linker64, LOAD alignment 0x4000 (16KiB), sin dependencia JPEG/C++ compartida; sólo libz, libm, libdl, libc Android. Hash del binario observado: `18e9b32255558c79189dcc44b616ede92c2f167a6f770a3621125d02a6f610c5`.

## Versiones y ejecución

Node22.23.2; Vitest4.1.11; MuPDF1.28.1; TypeScript6.0.3; Python3.12.3. qpdf12.4.2; JPEG9f. SDK NDK28.2.13676358/clang19.0.1; CMake3.22.1. Host build usa zlib.so.1 del sistema y JPEG9f estático. `host/REPRODUCIR.txt` documenta la preparación específica del compilador host; `host/qpdf/CMakeCache.txt` conserva opciones exactas.

Comandos desde snapshot:

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/ghostscript.test.ts tests/local/qpdf-bridge-independiente.test.ts
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/qpdf-real-independiente.test.ts
javac -d host/java android/app/src/main/java/io/github/dvdmsv/cajadeherramientas/MotorGhostscript.java tests/native/QpdfMotorCheck.java
java -cp host/java io.github.dvdmsv.cajadeherramientas.QpdfMotorCheck
python3 tests/native/source-cache-check.py
```

Evidencias: bridge.log, native.log, real.log, source-cache.log, host/configure.log, host/build.log. El tsconfig añadido sólo configura experimentalDecorators para cargar LocalService en Vitest, pues el snapshot no lo incluía.

## Límites y pendientes conocidos

No hay dispositivo/emulador: no se ha ejecutado plugin Capacitor Java real ni binario Android, ni probado SELinux, ciclo de vida de Activity, instalación APK/AAB, lentitud/OOM en teléfono o integración Play Store. Host y stubs de proceso no sustituyen esa prueba.

Sólo ARM64 estaba incluido en snapshot; otras ABI estaban en construcción en principal. No se consideran fallo nuevo. preBuild de snapshot comprueba Ghostscript pero todavía no exige libqpdfrun.so; añadir a verificación antes de distribución y verificar las cuatro ABI finales. Catálogo/ruta completa y avisos agregados de publicación pendientes de integración. No se ha recompilado Android dos veces para comprobar reproducibilidad binaria.

Reparaciones y plan detallado de regresión quedan para la fase posterior a las 13 implementaciones, como se pidió.
