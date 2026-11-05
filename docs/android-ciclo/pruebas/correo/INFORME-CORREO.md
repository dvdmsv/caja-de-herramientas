# Auditoría aislada correo-a-pdf

Snapshot: /tmp/caja-ciclo/correo. Implementación y repositorio principal sin modificar.
Pruebas: tests/local/correo-auditoria.test.ts.
Ejecución: ./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/correo-auditoria.test.ts
Resultado: 12 pruebas, 8 pasan, 4 fallan (3 defectos). Log: /tmp/correo-test-result.txt.

## Defectos reproducidos y plan de corrección posterior

1. Media: MSG pierde destinatarios. El fixture real backend/tests/archivos/outlook.msg produce PDF con Para vacío, aunque el lector obtiene test.recipient@example.com. correo.ts filtra recipientType === 1/2; el lector real devuelve recipType: 'to'/'cc'/'bcc'. Corregir adaptación y pasar prueba MSG real; añadir fixture CC o prueba de contrato correspondiente. El asunto, remitente, fecha y cuerpo aparecen correctamente en la extracción observada. No requiere sustituir el lector.
2. Media: adjuntos repetidos generan nombres idénticos. Dos partes MIME con filename=datos.csv devuelven datos.csv/datos.csv frente a datos.csv/datos-2.csv del contrato Windows (backend/tests/test_correo.py). Puede confundir al identificar/guardar adjuntos; esta prueba no demuestra sobrescritura en almacenamiento. Incorporar asignación única de nombres tras sanear y considerar colisiones con el PDF principal; pasar test existente y añadir colisiones tras quitar directorios.
3. Baja: EML vacío o texto arbitrario se acepta y genera PDF. Dos pruebas fallan porque la promesa resuelve. Windows rechaza la nota arbitraria (test_lo_que_no_es_un_correo_se_rechaza). Validar estructura mínima de correo sin excluir mensajes legítimos con cabeceras opcionales y volver a ejecutar ambos casos inválidos y EML válidos.

## Casos que pasan

EML UTF8 con asunto RFC2047, remitente, Para, CC, fecha y texto acentuado; quoted-printable ISO8859-1; adjunto base64 con bytes [0,1,2,3,255,254] exactos y eliminación de prefijo ../../; HTML con script/iframe/imagen remota sin ejecución observable ni llamadas global fetch en Node; extensión incorrecta; lista vacía; MSG inválido con error comprensible; progreso por cada mensaje de lote.

## Revisión navegador

MsgReader no usa directamente Buffer global en su código lib JS. DataStream importa iconv-lite; iconv-lite importa Buffer desde safer-buffer y puede importar stream de forma opcional. Se probó también getFileData del MSG real retirando global.Buffer después de cargar el módulo: lectura correcta. Esto respalda que esa ruta no exige Buffer global, pero no equivale a importar/ejecutar el bundle en WebView. La prueba no descarta dependencias de inicialización ni todas las rutas ANSI/RTF. La compilación Android informada por el agente padre resuelve el bundle tras añadir buffer; pendiente ejecución real en navegador/WebView. No se ha probado Android, UI, ruta ni catálogo (herramienta aún deshabilitada en snapshot).

## Límites

MSG real probado sin adjuntos; sin fixtures reales de adjuntos MSG, cuerpo HTML/ANSI/RTF MSG ni destinatarios CC. No se ejecutaron límites 200 adjuntos/250 MB, nombres RFC2231, adjuntos message/rfc822, colisión con nombre PDF, recursos CSS remotos ni documentos enormes. La prueba fetch de Node no demuestra ausencia de toda conexión de red en navegador. No se hizo instalación ni modificación en node_modules enlazado. Reparaciones aplazadas a la fase final indicada por el usuario.
