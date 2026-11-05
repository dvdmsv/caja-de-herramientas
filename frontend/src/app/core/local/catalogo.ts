/** Sólo se ofrecen operaciones cuya implementación está incluida en la APK. */
export const HERRAMIENTAS_LOCALES = new Set([
  'comprimir-pdf', 'correo-a-pdf', 'limpiar-metadatos', 'extraer-tablas', 'pdf-a-epub',
  'a-markdown', 'pdf-a-word', 'ocr-pdf', 'pdf-a-pdfa', 'comprobar-firmas',
  'firmar-certificado', 'marca-de-tiempo', 'documento-a-pdf',
  'unir-pdf', 'dividir-pdf', 'organizar-pdf', 'proteger-pdf', 'aplanar-pdf',
  'anonimizar-pdf', 'comparar-pdf', 'pdf-a-grises', 'pdf-a-imagen', 'imagen-a-pdf', 'convertir-imagen', 'comprimir-imagen',
  'editar-imagen', 'generar-qr', 'visor', 'numerar-paginas', 'efecto-escaner',
  'markdown-a-pdf', 'html-a-pdf', 'visor-markdown', 'extraer-imagenes', 'epub-a-pdf', 'marca-de-agua', 'leer-codigo', 'crear-certificado', 'firmar',
]);

export const MAXIMO_ARCHIVO = 50 * 1024 * 1024;
export const CUOTA_LOCAL = 250 * 1024 * 1024;
export const MAXIMO_PIXELES = 20_000_000;
