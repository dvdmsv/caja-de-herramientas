# P01 y Q02: revalidación tras mapas Unicode explícitos

**P01 aprobado para el corpus ensayado:8/8 casos pasan,8/8 archivos finales conformes PDF/A-1b en veraPDF. Q02 caché:4/4 pasan.** Sin ediciones del principal.

Fuentes actualizadas en `/tmp/caja-ciclo/pdfa-final`. SHA256 pdfa.ts verificado:67f51f7f5a4bc9a3555e5cc2892b7f31801de1c9fd4895f581fb99f4ff861f3f.

## P01

Se ejecutó primera conversión Ghostscript → restaurar-texto real MuPDF con originales en recursos → segunda Ghostscript si cambiado=true → nueva apertura y veraPDF1.30.3.

Casos:

1. Transparencia y español/griego/cirílico, sin giro.
2. El mismo contenido, CropBox y Rotate90.
3. CropBox y Rotate180.
4. CropBox y Rotate270.
5. Documento mixto: una página transparente y una opaca.
6. Control opaco Unicode (cambiado=false, no segunda pasada).
7. Variante con fuentes subdivididas.
8. Variante con carácter suplementario U+1F600, además del corpus Unicode.

Tras el arreglo ToUnicode bfchar, todos conservan `Español: áéíóú ñ ¿Qué?` y `Ωμέγα Привет`, una sola vez. El octavo conserva también `Emoji 😀`. Selección/búsqueda devuelve posiciones correspondientes al texto original (centros de selección a menos de2pt). El proceso Ghostscript cambia las métricas de altura de selección incluso en el control opaco; no se exige altura idéntica cuando píxeles y posición se conservan.

La capa invisible restaurada no modifica ningún píxel del primer raster. Comparación visual final/original mantiene MAE RGB aproximadamente0.74–0.85/255 en casos transparentes y0 en control opaco; bounds se conservan. Las8 salidas finales son conformes PDF/A-1b según veraPDF. La página opaca del documento mixto conserva texto sin duplicarlo.

Fuentes observadas por Text.walk: Helvetica y DejaVuSans. La variante subdividida devuelve los mismos nombres, por lo que el mapa coincide con BaseFont normalizado. No apareció una fuente con nombre sin correspondencia en este corpus; no se afirma cobertura de todas las fuentes ni de dos fuentes distintas con mismo nombre/glyph IDs incompatibles. Esa identificación por nombre sigue siendo una limitación que requiere corpus adicional.

## Evidencias

- `results/tests.log`:6 casos iniciales aprobados tras corrección.
- `results/subset.log`:caso de fuentes subdivididas aprobado.
- `results/supplementary.log`:caso UTF16 suplementario aprobado.
- `results/summary.json`:los8 textos extraídos, errores visuales y atributos de conformidad veraPDF.
- Cada `results/<caso>/` conserva entrada, primeraGS, restored.pdf, segundaGS, final.pdf, stats.json y verapdf.xml.
- `results-initial/` e `INFORME-P01-Q02-ANTES-MAPAS.md` conservan la reproducción del fallo anterior. No confundirlos con la revisión aprobada.

Repetir:

```
./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdfa-revalidation.test.ts
```

Los fixtures permanecen guardados; make.py y supplementary.py permiten generarlos. El fixture subset se creó con PyMuPDF subset_fonts sobre trans-unicode-0.pdf.

Ghostscript10.08.0 real del host, MotorGhostscript.java actual compilado, ICC de la app y PS equivalente al plugin. MuPDF1.28.1, veraPDF1.30.3. No se ha probado este arreglo en Android/WebView ni mediante UI; LocalService se revisó y el arnés replica su orden condicional. La conformidad es del corpus, no una garantía universal ni preservación de firmas digitales originales.

## Q02 residual de caché

Componente actualizado, suite `/tmp/caja-ciclo/qpdf-final/tests/local/cache-web.test.ts`:4/4 pasan. Cambiar web con petición antigua en curso y recibir error ya dispara el mínimo del modo actual. Evidencia cache-fixed.log. Queda cerrado el residual de esa auditoría; no implica una nueva prueba del empaquetado qpdf ni del manifiesto de build.
