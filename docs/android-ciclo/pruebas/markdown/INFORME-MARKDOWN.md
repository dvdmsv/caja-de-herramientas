# Auditoría aislada a-markdown

Copia /tmp/caja-ciclo/markdown. No se modifica implementación ni repositorio principal; node_modules enlazado sin modificar.

Pruebas: tests/local/a-markdown-auditoria.test.ts
Comando: ./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/a-markdown-auditoria.test.ts
Resultado: 21 pruebas, 16 pasan, 5 fallan. Log /tmp/markdown-test-result.txt.
Fixtures reales: fixtures-auditoria/generar.py usa python-docx/python-pptx y MarkItDown del venv backend. DOCX/PPTX guardados, salidas Windows *.windows.md y Android *.android.md disponibles en esa carpeta. XLS/XLSX se generan con SheetJS en las pruebas; PDF con MuPDF; EPUB/MIME ZIP/XML/EML mínimos válidos para rutas ejercitadas. MSG fixture real backend/tests/archivos/outlook.msg.

## Hallazgos y plan de regresión posterior

1. Media: CSV UTF8 sin BOM decodificado como bytes ANSI. Entrada Nombre,Valor seguido de "Café, té",2 produce CafÃ©, tÃ©. Windows MarkItDown produce Café, té correctamente. Leer/decodificar CSV con codificación apropiada antes de SheetJS o establecer codepage correcta; probar sin BOM, con BOM, comillas y Unicode.
2. Media: PPTX reordenado pierde orden de lectura. Fixture creado con diapositivas Primera, Segunda, Tercera y luego Tercera movida al inicio. Windows devuelve Tercera/Primera/Segunda; Android Primera/Segunda/Tercera. Causa: orden numérico del nombre ppt/slides/slideN.xml en lugar de resolver presentation.xml sldIdLst y relaciones. Respetar índice real y relaciones; mantener prueba existente y añadir numeración de archivo discontinua/relaciones relativas.
3. Media: DOCX con lista ListBullet pierde viñetas. Fixture python-docx add_paragraph(..., style='List Bullet') produce Elemento primero como párrafo plano, Windows produce * Elemento primero. Resolver estilos/numbering o soporte equivalente de listas heredadas; probar listas numeradas, viñetas y niveles tras corregir.
4. Baja: DOCX w:b val=0 se interpreta como negrita. Run.bold=False produce **No negrita** frente a texto normal Windows. Leer valor booleano de propiedad OOXML y considerar false/off/0; mantener pruebas de true y false.
5. Baja: DOCX negrita+cursiva conserva sólo negrita. Windows ***Estilo doble*** frente Android **Estilo doble**. Componer estilos en officeXml; distinto punto de código del fallo PDF/EPUB ya registrado en estructura-pdf, aunque mismo síntoma.

## Casos correctos

DOCX título, Unicode y tabla simple 2x2. XLS y XLSX con hojas en orden, texto acentuado y decimal. HTML encabezado, negrita, enlace HTTPS, tabla y eliminación script. Markdown literal comparado exactamente con salida Windows: ambos normalizan líneas en blanco múltiples, no se registra como regresión Android. JSON/XML conservan contenido aunque Android lo presenta en bloque de código y Windows JSON sin bloque; diferencia de presentación, no pérdida de datos en fixture. EPUB sigue spine en orden distinto al ZIP y resuelve rutas ../Text. Preview usa puntos de código para caracteres Unicode, cuenta palabras y bytes correctos; presupuesto acumulado omite documento grande sin impedir otro pequeño posterior. Unión y nombre documentos.md coinciden con contrato Windows. ZIP rechaza >10000 entradas y un tamaño descomprimido declarado >250MB antes de inflar. Office XML rechaza DTD. Entrada ausente, opción unir inválida y formato no admitido rechazados. PDF real devuelve texto y PDF vacío requiere OCR. EML devuelve cuerpo/adjunto bytes exactos; MSG real devuelve cuerpo.

## Límites y defectos compartidos

No se repiten como nuevos los defectos de leerCorreo ya registrados: destinatarios MSG, adjuntos duplicados y EML inválido. XLS binario generado por SheetJS, no corpus amplio de Excel. PDF escaneado representado por página vacía para ausencia de texto; OCR fuera de alcance. No probados Office cifrado, macros, notas PPTX, ecuaciones, diagramas, imágenes incrustadas, enlaces internos, tablas fusionadas o estilos heredados complejos. Límite ZIP tamaño se probó con cabecera central declarada de 251MB y archivo minúsculo, no consumo real de 250MB de RAM ni cuota de salida. Sin ejecución en Android/WebView; pruebas Node reales de transformación. Lector MSG ya revisado en auditoría correo. Catálogo/ruta deshabilitados por secuencia de implementación, no hallazgo. Correcciones diferidas a fase final.
