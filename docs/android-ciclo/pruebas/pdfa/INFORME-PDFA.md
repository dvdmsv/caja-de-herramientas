# Pruebas independientes: PDF/A Android

Resultado: **ocho conversiones reales, ocho conformes según veraPDF 1.30.3**. Suite TypeScript/puente: **23 pruebas, 22 pasan y una falla** por pérdida de texto seleccionable al aplanar transparencias en PDF/A-1b. Tres controles del proceso Java pasan (cancelación previa, cancelación en curso y rechazo de entrada vacía). No se ha modificado el repositorio principal.

## Qué se ejecutó

- Copia aislada `/tmp/caja-ciclo/pdfa`.
- `MotorGhostscript.java` de la copia compilado con javac, sin usar Gradle ni su caché. Arnés `java-harness/io/github/dvdmsv/cajadeherramientas/ProbarPdfa.java`, que prepara exactamente el PS y la copia ICC que usa `GhostscriptPlugin`.
- Ghostscript real del host: `/tmp/merge-pdf-gs-host/ghostscript-10.08.0/sobin/libgsrun.so`; el propio `MotorGhostscript` establece `LD_LIBRARY_PATH`.
- Perfil sRGB de `src/assets/pdfa/srgb.icc` de la copia.
- Dos perfiles × cuatro documentos: texto español, imagen, transparencia, Unicode griego/cirílico.
- Lectura/texto/renderizado con PyMuPDF 1.27.2.2 y MuPDF.js 1.28.1; Node 22.23.2, Vitest 4.1.11.
- veraPDF CLI oficial **1.30.3**, descargado desde `https://software.verapdf.org/releases/verapdf-installer.zip` e instalado sólo en `/tmp/caja-ciclo/pdfa/verapdf`. SHA256 del ZIP: `b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59`.

## Reproducción

```
cd /tmp/caja-ciclo/pdfa
javac java-harness/io/github/dvdmsv/cajadeherramientas/*.java
python3 preparar-muestras.py
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdfa-auditoria.test.ts
python3 probar-nativo.py
./verapdf/verapdf --format xml resultados/*/salida.pdf
```

Evidencias: `muestras.log`, `pruebas-pdfa.log`, `pruebas-nativo.log`, `verapdf-resultados.xml`. `resultados/` conserva entradas, salidas y logs de cada conversión. Scripts y tests sólo escriben en la copia temporal.

## P01 — Media: PDF/A-1b con transparencia pierde el texto seleccionable

Ubicación: `MotorGhostscript.ordenPdfa`, uso de Ghostscript `pdfwrite` con `-dPDFA=1`, y flujo posterior de `LocalService`: sólo se comprueba la declaración XMP, no la conservación de la capa textual.

Reproducción: `resultados/pdfa1-transparencia/entrada.pdf` contiene texto seleccionable «Español: áéíóú ñ ¿Qué?» y dos rectángulos solapados, uno con alfa 0,5. La conversión real produce `salida.pdf` con una imagen de toda la página, sin texto extraíble. Prueba fallida: `conserva texto seleccionable con transparencia PDF/A1b`.

Esperado funcional: conservar texto utilizable para buscar/copiar, o decidir expresamente cómo gestionar esta pérdida antes de aprobar el perfil 1b. La conversión PDF/A-2b del mismo documento conserva el texto.

Observado: texto antes no vacío, texto después `''`. La apariencia se conserva de forma aproximada (error absoluto medio RGB a 72 dpi de 0,5356/255), pero se pierde la funcionalidad textual. No es un defecto de conformidad: **veraPDF declara conforme ese archivo PDF/A-1b**. Es una limitación real del aplanado que hace Ghostscript. No se afirma que sea una regresión respecto de toda versión de ocrmypdf/Windows, cuya canalización completa no se ejecutó aquí.

Consecuencia para revisar en la fase final: activar OCR antes de esta conversión no garantiza que su capa sobreviva al aplanado posterior. Se inspeccionó ese orden en `LocalService`; no se ejecutó la combinación OCR+PDF/A en esta tanda.

## Validaciones que pasan

- Las ocho salidas declaran y satisfacen veraPDF para el perfil solicitado: cuatro PDF/A-1b y cuatro PDF/A-2b, cero reglas fallidas.
- Español y Unicode griego/cirílico sobreviven con ToUnicode explícito válido.
- Imágenes y dimensiones conservadas en las muestras. Siete de ocho comparaciones de raster a 72 dpi son idénticas; la diferencia es la transparencia aplanada en 1b.
- Puente envía `1b`/`2b` correctamente y devuelve sufijo `-pdfa.pdf`.
- Validación previa acepta PDF ordinario y rechaza extensión ajena, cifrado y corrupción; validación final rechaza declaración ausente o perfil equivocado.
- Cancelación previa no crea trabajo; cancelación durante el puente libera sin leer resultado; error del segundo archivo no entrega lote parcial; salida mayor de cuota rechazada.
- Java rechaza entrada vacía y cancelación previa; cancelación durante un proceso simulado termina el proceso en unos 0,3 segundos y verifica que desaparece de `/proc`. Este último caso prueba la mecánica de destrucción, no una carrera concreta del binario Android.

## Diagnósticos y falso positivo descartado

El primer fixture Unicode generado directamente por PyMuPDF contenía un rango ToUnicode que cruzaba el límite de un byte de destino. MuPDF lo interpretaba como cirílico y Ghostscript producía marcas combinantes, manteniendo la apariencia. Al usar `bfchar` explícito, los dos perfiles conservan los caracteres correctamente. **El aviso preliminar de corrupción de cirílico queda retirado; no es un defecto demostrado de la app.** `preparar-muestras.py` genera ahora el mapa explícito para evitar ese problema del fixture.

Ghostscript puede devolver éxito recuperando una entrada corrupta, pero la validación previa TypeScript de este flujo la rechaza. No se registra como fallo de extremo a extremo.

Como prueba de diagnóstico se reemplazó el ICC por bytes inválidos: Ghostscript produjo una salida que veraPDF declaró no conforme. Esto no pertenece al flujo normal, cuyo ICC está empaquetado y pasó las ocho validaciones. Confirma que la declaración XMP por sí sola no certifica conformidad; la implementación y la interfaz ya distinguen ambos conceptos. Evidencia separada `verapdf-icc-invalido.xml`.

## Límites

No hubo dispositivo/emulador Android, por lo que no se verificaron extracción/ejecución del binario bajo Android, asset manager, puente Capacitor real ni ciclo de vida de la actividad. No se probó OCR opcional de extremo a extremo, conservación de firmas existentes, adjuntos, formularios complejos, PDF dañados recuperables, cuotas con documentos grandes ni todos los espacios de color/fuentes.

Estos resultados acreditan las ocho muestras, no certifican todas las salidas futuras. Los hallazgos y las decisiones pendientes se reservan para la fase final acordada; no se ha cambiado ni arreglado la implementación.

## Huellas de la copia revisada

- `pdfa.ts`: `f7f625dbfba077ba2e8a3cf844f3dee2e6988e31be46a6afe0c129b1648693f2`
- `ghostscript.ts`: `89eb0b314a48c0b7249b8ae52b081ded4073fcba92507a779aa4bc08dd28270c`
- `MotorGhostscript.java`: `2a8809413082b2387027e4f5924c6c29dac98096a8f0766cf447021060fc6114`
- `GhostscriptPlugin.java`: `3e0cbb42cb50b2c3d3e367aff68db6094895ebf9f67b6aef947f85fc9f7f0b77`
