import { Routes } from '@angular/router';

/**
 * Cada herramienta se carga bajo demanda: la portada no arrastra el código de
 * ninguna. Al añadir una herramienta nueva, añade aquí su ruta y su entrada en
 * `core/tools.ts` (el test de `core/tools.spec.ts` comprueba que no se olvide).
 */
export const routes: Routes = [
  {
    path: '',
    title: 'Herramientas para PDF e imágenes',
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent),
  },
  {
    path: 'herramientas/unir-pdf',
    title: 'Unir PDF',
    loadComponent: () =>
      import('./pages/tools/unir-pdf/unir-pdf.component').then(m => m.UnirPdfComponent),
  },
  {
    path: 'herramientas/pdf-a-imagen',
    title: 'PDF a imagen',
    loadComponent: () =>
      import('./pages/tools/pdf-a-imagen/pdf-a-imagen.component').then(m => m.PdfAImagenComponent),
  },
  {
    path: 'herramientas/firmar',
    title: 'Firmar documento',
    loadComponent: () =>
      import('./pages/tools/firmar/firmar.component').then(m => m.FirmarComponent),
  },
  {
    path: 'herramientas/firmar-certificado',
    title: 'Firmar con certificado',
    loadComponent: () =>
      import('./pages/tools/firmar-certificado/firmar-certificado.component')
        .then(m => m.FirmarCertificadoComponent),
  },
  {
    path: 'herramientas/comprobar-firmas',
    title: 'Comprobar firmas',
    loadComponent: () =>
      import('./pages/tools/comprobar-firmas/comprobar-firmas.component')
        .then(m => m.ComprobarFirmasComponent),
  },
  {
    path: 'herramientas/crear-certificado',
    title: 'Crear certificado',
    loadComponent: () =>
      import('./pages/tools/crear-certificado/crear-certificado.component')
        .then(m => m.CrearCertificadoComponent),
  },
  {
    path: 'herramientas/dividir-pdf',
    title: 'Dividir PDF',
    loadComponent: () =>
      import('./pages/tools/dividir-pdf/dividir-pdf.component').then(m => m.DividirPdfComponent),
  },
  {
    path: 'herramientas/organizar-pdf',
    title: 'Organizar PDF',
    loadComponent: () =>
      import('./pages/tools/organizar-pdf/organizar-pdf.component').then(m => m.OrganizarPdfComponent),
  },
  {
    path: 'herramientas/proteger-pdf',
    title: 'Proteger PDF',
    loadComponent: () =>
      import('./pages/tools/proteger-pdf/proteger-pdf.component').then(m => m.ProtegerPdfComponent),
  },
  {
    path: 'herramientas/anonimizar-pdf',
    title: 'Anonimizar PDF',
    loadComponent: () =>
      import('./pages/tools/anonimizar-pdf/anonimizar-pdf.component')
        .then(m => m.AnonimizarPdfComponent),
  },
  {
    path: 'herramientas/ocr-pdf',
    title: 'PDF con OCR',
    loadComponent: () =>
      import('./pages/tools/ocr-pdf/ocr-pdf.component').then(m => m.OcrPdfComponent),
  },
  {
    path: 'herramientas/pdf-a-pdfa',
    title: 'Convertir a PDF/A',
    loadComponent: () =>
      import('./pages/tools/pdf-a-pdfa/pdf-a-pdfa.component').then(m => m.PdfAPdfaComponent),
  },
  {
    path: 'herramientas/comprimir-pdf',
    title: 'Comprimir PDF',
    loadComponent: () =>
      import('./pages/tools/comprimir-pdf/comprimir-pdf.component').then(m => m.ComprimirPdfComponent),
  },
  {
    path: 'herramientas/comprimir-imagen',
    title: 'Comprimir imagen',
    loadComponent: () =>
      import('./pages/tools/comprimir-imagen/comprimir-imagen.component')
        .then(m => m.ComprimirImagenComponent),
  },
  {
    path: 'herramientas/convertir-imagen',
    title: 'Convertir imagen',
    loadComponent: () =>
      import('./pages/tools/convertir-imagen/convertir-imagen.component')
        .then(m => m.ConvertirImagenComponent),
  },
  {
    path: 'herramientas/editar-imagen',
    title: 'Editar imagen',
    loadComponent: () =>
      import('./pages/tools/editar-imagen/editar-imagen.component')
        .then(m => m.EditarImagenComponent),
  },
  {
    path: 'herramientas/efecto-escaner',
    title: 'Efecto escáner',
    loadComponent: () =>
      import('./pages/tools/efecto-escaner/efecto-escaner.component')
        .then(m => m.EfectoEscanerComponent),
  },
  {
    path: 'herramientas/imagen-a-pdf',
    title: 'Imagen a PDF',
    loadComponent: () =>
      import('./pages/tools/imagen-a-pdf/imagen-a-pdf.component').then(m => m.ImagenAPdfComponent),
  },
  {
    path: 'herramientas/marca-de-agua',
    title: 'Marca de agua',
    loadComponent: () =>
      import('./pages/tools/marca-de-agua/marca-de-agua.component').then(m => m.MarcaDeAguaComponent),
  },
  {
    path: 'herramientas/numerar-paginas',
    title: 'Numerar páginas',
    loadComponent: () =>
      import('./pages/tools/numerar-paginas/numerar-paginas.component')
        .then(m => m.NumerarPaginasComponent),
  },
  {
    path: 'herramientas/comparar-pdf',
    title: 'Comparar PDF',
    loadComponent: () =>
      import('./pages/tools/comparar-pdf/comparar-pdf.component')
        .then(m => m.CompararPdfComponent),
  },
  {
    path: 'herramientas/aplanar-pdf',
    title: 'Aplanar PDF',
    loadComponent: () =>
      import('./pages/tools/aplanar-pdf/aplanar-pdf.component')
        .then(m => m.AplanarPdfComponent),
  },
  {
    path: 'herramientas/extraer-imagenes',
    title: 'Extraer imágenes',
    loadComponent: () =>
      import('./pages/tools/extraer-imagenes/extraer-imagenes.component')
        .then(m => m.ExtraerImagenesComponent),
  },
  {
    path: 'herramientas/limpiar-metadatos',
    title: 'Editar metadatos',
    loadComponent: () =>
      import('./pages/tools/limpiar-metadatos/limpiar-metadatos.component')
        .then(m => m.LimpiarMetadatosComponent),
  },
  {
    path: 'herramientas/leer-codigo',
    title: 'Leer QR o código de barras',
    loadComponent: () =>
      import('./pages/tools/leer-codigo/leer-codigo.component').then(m => m.LeerCodigoComponent),
  },
  {
    path: 'herramientas/generar-qr',
    title: 'Generar QR',
    loadComponent: () =>
      import('./pages/tools/generar-qr/generar-qr.component').then(m => m.GenerarQrComponent),
  },
  {
    path: 'herramientas/documento-a-pdf',
    title: 'Documento a PDF',
    loadComponent: () =>
      import('./pages/tools/documento-a-pdf/documento-a-pdf.component')
        .then(m => m.DocumentoAPdfComponent),
  },
  {
    path: 'herramientas/pdf-a-word',
    title: 'PDF a Word',
    loadComponent: () =>
      import('./pages/tools/pdf-a-word/pdf-a-word.component').then(m => m.PdfAWordComponent),
  },
  {
    path: 'herramientas/extraer-tablas',
    title: 'Extraer tablas',
    loadComponent: () =>
      import('./pages/tools/extraer-tablas/extraer-tablas.component')
        .then(m => m.ExtraerTablasComponent),
  },
  {
    path: 'herramientas/a-markdown',
    title: 'Documento a Markdown',
    loadComponent: () =>
      import('./pages/tools/a-markdown/a-markdown.component').then(m => m.AMarkdownComponent),
  },
  {
    path: 'herramientas/markdown-a-pdf',
    title: 'Markdown a PDF',
    loadComponent: () =>
      import('./pages/tools/markdown-a-pdf/markdown-a-pdf.component')
        .then(m => m.MarkdownAPdfComponent),
  },
  {
    // El visor manda en toda la pantalla: sin barra de navegación ni pie.
    path: 'visor',
    title: 'Visor de PDF',
    data: { pantallaCompleta: true },
    loadComponent: () => import('./pages/visor/visor.component').then(m => m.VisorComponent),
  },
  { path: '**', redirectTo: '' },
];
