# Certificación previa: regresión independiente

Copia aislada de CertificacionPdf/SellarPdf/FirmasPdf; PDFBoxAndroid real y BC1.79 en JVM, stub Android Log y recursos AFM originales del AAR. TSA mock HTTPS produce tokens RFC3161 reales; no solicitudes externas. Fixtures firmados con PyHanko y contrastados con su análisis de revisiones.

Resultado: 139 controles, tres escenarios fallan.

- M02a, media: `p2-segunda.pdf` y `p3-segunda.pdf` tienen segunda firma previa permitida (`docmdp_ok=True`), pero preflight rechaza añadir sello. Revisar recorrido `/P` desde campos hacia página y `/Annots`, que incluye nuevos widgets permitidos.
- M02b, media: `p2-locked-form.pdf` modifica `/V` en campo protegido mediante FieldMDP ALL; PyHanko declara violación, preflight acepta y consulta TSA. Falta aplicar restricciones FieldMDP a valores/apariencias de campos bloqueados.

Sí pasan certificaciones intactas, cambios de formulario desbloqueado, rechazo de cambios de contenido/recursos antes de consultar TSA y regresiones criptográficas anteriores. El caso de anotación P3 se considera rechazable para comparar con política PyHanko/Windows actual, no representa exhaustividad del estándar P3.

Repro: `python3 auditoria/ejecutar-arnes.py`. Generar fixtures: `/home/david/Desarrollos/merge-pdf/backend/.venv/bin/python auditoria/matriz-permisos.py > auditoria/matriz-base.log`. Evidencia completa en `criptografico.log`, `matriz-base.log` y PDFs homónimos. No se modificó la implementación principal.

## Segunda revisión

La corrección de /P y FieldMDP resuelve las tres incidencias iniciales. Ampliación Include/Exclude (17 escenarios) revela un falso rechazo adicional: Exclude Nombre rechaza modificar Nombre, aunque está excluido del bloqueo. Causa confirmada: hash del campo firma incluye /V/Reference/FieldMDP/Data, referencia al catálogo, y alcanza por allí campos excluidos. Fixture p2-exclude-nombre.pdf, PyHanko docmdp_ok=True. Include Nombre/Include Otro/Exclude Otro sí se comportan correctamente.

La anotación P3 simple se acepta ahora, conforme al permiso DocMDP3; la política por defecto de PyHanko no soporta esa modificación y la marca sospechosa. El arnés hace explícita esa excepción en lugar de afirmar equivalencia perfecta con el validador Windows.

## Resultado final

Tras omitir exclusivamente /Data de los diccionarios transform DocMDP/FieldMDP, la matriz ampliada completa pasa: 17/17 escenarios, 175 controles, cero fallos. Se aceptan originales, segundas firmas válidas P2/P3, formularios desbloqueados y casos Include/Exclude permitidos; se rechazan modificaciones prohibidas de páginas/recursos/campos bloqueados sin consultar TSA. Regresiones de tokens RFC3161, nonce/huella, integridad, revisiones y manejo de errores pasan. Fuentes exactas usadas conservadas en android-src; criptografico.log es el resultado final. Verificación JVM con PDFBoxAndroid real; no representa validación en dispositivo de esta clase ni confianza externa de TSA (respuesta de prueba local).
