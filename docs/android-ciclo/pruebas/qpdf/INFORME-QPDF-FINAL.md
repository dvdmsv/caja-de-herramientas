# Reverificación Q01/Q02/Q03

Copia nueva `/tmp/caja-ciclo/qpdf-final`, fuentes copiadas del principal; ninguna edición del principal. qpdf12.4.2 host real compilado anteriormente, MuPDF1.28.1. No se ejecuta binario Android en estas pruebas.

## Resultado

- **Q02 motor/servicio: 11/11 pruebas pasan** (6 nuevas con qpdf real y control del servicio + 5 del puente).
- **Q01/Q03: 7/7 pruebas pasan** (avisos, árbol limpio/extraído, modificación, ausencia, tar alterado y copia por ABI).
- **UI/API caché: 3/4 pasan; queda un fallo residual descrito abajo.**

## Q02 corregido: tamaño final, mínimo y cancelación

La ruta LocalService real se prueba sustituyendo únicamente transporte Worker por llamada al módulo comprimirPdf original y transporte Android por proceso qpdf host real. No se simulan compresión, linearización ni tamaño. Cada salida se comprueba con qpdf --check-linearization.

Fixture original: objetivo **82575 bytes**. Candidatos ya linearizados: **645347,83230,33936**. El servicio continúa tras el candidato que antes se aceptaba prematuramente y devuelve **33936**, logrado=true, resumen igual a bytes guardados.

Mínimo web mide las8 salidas: **645347,83230,33936,18659,9424,7548,5756,3774**; informa3774. Pedir exactamente3774 termina con logrado=true. Objetivo imposible devuelve menor final y logrado=false. Nivel fijo realiza una linearización. `/minimo` sin web no usa nativo y conserva la ruta anterior.

Cancelación entre candidatos, después de la primera linearización, detiene búsqueda y no guarda parcial. Validación rechaza objetivo negativo y pasos fuera de0..7/no enteros. El puente existente conserva transferencias por bloques, rechazo de tamaños/lecturas inválidos y limpieza/cancelación.

## Residual Q02-UI — cambio web con petición antigua que falla

Tres casos pasan: ApiService envía web y defaultfalse; toggle limpia mínimos y pide modo nuevo; respuesta exitosa de petición vieja no contamina caché y dispara consulta nueva.

Falla: iniciar mínimo web=false; cambiar checkbox a web=true mientras petición sigue en vuelo; la petición vieja termina con error/cancelación. cambiarParaWeb no puede pedir todavía por calculandoMinimo=true; callback error sólo lo pone false y nunca pide el mínimo web actual. Resultado: ninguna ayuda de mínimo hasta otra interacción. No afecta al cálculo final de compresión ni muestra un mínimo incorrecto, pero deja incompleta la actualización automática.

Repro: `tests/local/cache-web.test.ts`, caso `error de consulta anterior debe iniciar consulta para webactual`, esperado2 llamadas, observado1. Sugerencia ya enviada: al fallar, limpiar flag y pedirMinimo únicamente si el web capturado difiere del actual; evitar reintentos infinitos del mismo modo.

## Q01 corregido en fuente y agregación

QPDF.txt contiene NOTICE, copyright qpdf, licencia SHA-2 RNRT/SAPHIR y procedencia/hash JPEG9f. Generador licencias-android.mjs copiado y ejecutado en snapshot produce AVISOS.txt con RNRT y JPEG: comprobado en dist/android/browser/assets/legal/AVISOS.txt. No se ha generado un APK nuevo aquí ni comprobado estos avisos dentro del APK final posterior.

## Q03 corregido para contenido de archivos del tar

comprobar_arbol compara cada archivo regular del tar con fuente extraída y copia JPEG ABI. Los tests verifican limpio, reextracción, archivo modificado, ausente, archivo tar cambiado y copia ABI modificada. También se ejecutó contra las fuentes reales qpdf/JPEG y copia ARM64 del build previo: las tres pasan, de modo que la verificación no rechaza ese build normal.

El script registra NDK/CMake, hashes y ABI en compilacion.json al instalar. Se ha revisado el código, pero no se ha hecho rebuild completo de cuatro ABI ni ejecutado --instalar en esta auditoría; no hay evidencia nueva de manifiesto de instalación ni reproducibilidad binaria doble. El verificador comprueba archivos originales, no prohíbe todos los archivos adicionales del directorio (hay archivos generados de build); no describirlo como igualdad exacta de árbol completo.

Pendiente de integración observado: preBuild del principal sigue comprobando sólo libgs.so/libgsrun.so, no libqpdfrun.so. Los binarios existentes no están ausentes; falta la defensa automática frente a un empaquetado futuro incompleto. No es regresión del cálculo Q02.

## Reproducción

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/qpdf-final.test.ts tests/local/ghostscript.test.ts
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/cache-web.test.ts
python3 evidencia/source-check.py
node evidencia/licencias-android.mjs
```

Evidencias: evidencia/{tests,cache,source}.log, objetivo.json, minimo.json, source-hashes.txt. Tests y dependencias en snapshot; node_modules sólo leído. Las tres pruebas JVM/Android y ciclos de vida de dispositivo no se han repetido con este cambio; el control de bucle sí se ejercita con servicio real y cancelación AbortSignal.

### Actualización posterior: residual UI cerrado

Componente recopiado tras arreglo del callback error; suite cache-web ahora **4/4 pasa** (`evidencia/cache-fixed.log`). La petición vieja que falla después del toggle dispara el mínimo nuevo correctamente. Resto del alcance y límites del informe sin cambios.
