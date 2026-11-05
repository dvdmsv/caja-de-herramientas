# Auditoría aislada PDF a EPUB

Copia: /tmp/caja-ciclo/epub. Implementación y repositorio principal sin editar. node_modules enlazado sin modificar.

Ejecución: ./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/pdf-a-epub-auditoria.test.ts
Resultado: 14 pruebas, 12 pasan y 2 fallan: un defecto de estilo y una limitación común heredada de Windows. Log /tmp/epub-test-result.txt.
Validación adicional: python3 validar_epub.py -> PASS.
Artefacto real generado: resultado.epub. Abierto y paginado con MuPDF en una prueba, comprobando texto extraído del libro.

## Hallazgos y plan de regresión posterior

1. Limitación común heredada de Windows (no regresión Android): inspección declara sin texto un PDF válido si éste empieza después de la página 20. Prueba real: crear PDF de contenido y anteponer 20 páginas vacías. Conversión directa produce EPUB, pero inspeccionar devuelve con_texto:false. UI actual PdfAEpubComponent escaneado/listo bloquea la conversión cuando ese valor es false. Causa: Math.min(doc.countPages(),20) en inspección. Confirmado backend/api/tools/pdf_a_epub.py:30,51-52 también limita PAGINAS_A_MIRAR=20. Mejora futura fuera de paridad: inspección completa o distinguir resultado desconocido de escaneado; verificar que el documento mixto puede convertirse desde interfaz y que PDF de sólo imagen sigue rechazándose.
2. Baja: texto negrita+cursiva pierde cursiva. Fixture PDF usa Helvetica-BoldOblique; EPUB contiene <strong>Texto combinado</strong> sin <em>. Causa: selección excluyente mono/negrita/cursiva en markdownEstructurado. Componer estilos compatibles y pasar prueba existente, manteniendo negrita y cursiva simples.

## Cobertura correcta

Inspección obtiene título/autor Unicode de metadatos, número de páginas y texto en primera página. Opciones título/autor se escapan en XML; título vacío usa metadatos. ZIP comienza por mimetype sin compresión, package EPUB3 con identificador, navegación, portada, spine y referencias existentes. XML container/OPF/XHTML bien formado; ids únicos y enlaces internos comprobados. MuPDF abre EPUB, pagina y extrae texto y tabla. Título, listas con guion, negrita/cursiva separadas, monoespaciado, rejilla 2x2, imagen PNG y portada PNG de 1200px se conservan en fixture. Opción sin portada elimina portada. PDF con imagen solamente devuelve con_texto:false y rechaza con indicación OCR. Rechaza título numérico, autor >300 caracteres, portada no booleana, entrada vacía y PDF corrupto. Progreso correcto. Portada de proporción extrema se rechaza por superar 20 megapíxeles.

## Límites

No hay epubcheck ni xmllint disponibles: validación XML con Python ElementTree y lectura con MuPDF, no certificación EPUBCheck completa. No probado en lector Android/WebView ni UI real; efecto bloqueo fundamentado en código UI, no prueba interactiva. Cuota de salida 250MB y acumulación imágenes 100MB revisadas en código pero no agotadas con archivos enormes; sí probado límite de píxeles de portada. No probadas tablas complejas, varias columnas, jerarquías complejas de títulos, enlaces PDF, fuentes especiales o imágenes con máscaras. Habilitación de catálogo/ruta pendiente por diseño, no hallazgo. Correcciones diferidas a fase final.
