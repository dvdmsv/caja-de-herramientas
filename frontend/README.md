# Frontend de la Caja de herramientas

Desde `frontend/`, activa la versión de Node de `.nvmrc` con `nvm use` e instala las dependencias con `npm ci`. Usa `npm start` para abrir el servidor de desarrollo y `npm run build` para compilar la web de producción en `dist/merge-pdf/browser/`.

## Pruebas

| Suite | Comando | Qué comprueba |
|---|---|---|
| Angular | `npm test -- --watch=false` | Componentes, servicios y lógica de la interfaz con Vitest y jsdom. |
| Motores locales | `npm run test:local` | Operaciones sin servidor y sus documentos de referencia. Las pruebas opcionales de PDF/A usan `PDFA_GS_LIB_DIR` y `PDFA_VERAPDF`. |
| Navegador móvil | `npm run test:android` | Playwright abre la compilación Android en Chromium, en vertical y horizontal. Requiere Python 3 y el puerto local 8765 disponible. |

Antes de la suite de navegador, ejecuta `npx ng build --configuration production,android` y `npx playwright install chromium`. El servidor de pruebas sirve los recursos desde `dist/android/browser/`. Las pruebas en un teléfono usan el procedimiento de [pruebas en dispositivo](tests/telefono/README.md).

Los comandos de compilación y las opciones de desarrollo del servidor están en la [guía del proyecto](../README.md).
