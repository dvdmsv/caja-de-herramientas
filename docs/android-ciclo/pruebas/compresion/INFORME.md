# Pruebas independientes: compresión PDF inicial

Copia evaluada: `/tmp/caja-ciclo/compresion`.
Pruebas: `tests/local/compresion-independiente.test.ts`.
Comando: `./node_modules/.bin/vitest run --config vitest.local.config.ts tests/local/compresion-independiente.test.ts`.
Resultado: 8 pruebas, 7 aprobadas y 1 fallida. Sin cambios de implementación.

## Hallazgo C01 — Alta: se modifica una máscara de transparencia protegida

Reproducción: crear un PDF con una imagen RGB de 300 × 200 y alfa variable pseudoaleatorio. Su `/SMask` ocupa más de 20 KB. Comprimir con `nivel: fuerte`.

Esperado: conservar la imagen con transparencia y su máscara sin recomprimir, manteniendo `/ColorSpace /DeviceGray` en la máscara.

Observado: el recorrido de todos los objetos salta la imagen principal porque tiene `/SMask`, pero procesa por separado el objeto de esa máscara. La convierte a JPEG y establece `/ColorSpace /DeviceRGB`. La prueba falla con `expected 'DeviceRGB' to be 'DeviceGray'`.

La máscara puede perder exactitud de alfa por el JPEG y deja de cumplir la representación gris esperada para una máscara de imagen. La conservación de transparencias no está garantizada. Debe bloquear su aprobación.

Prueba de reproducción/regresión: `no recomprime ni cambia a RGB la máscara alfa de una imagen transparente`.

## Comprobaciones aprobadas

- Imagen grande reducida a 1100 píxeles conservando texto seleccionable, enlace y tamaño de página.
- Posición y color de los cuatro cuadrantes después del reescalado.
- Transparencia constante con máscara pequeña: apariencia renderizada idéntica.
- Mínimo repetible y objetivo solicitado exactamente igual al mínimo alcanzado.
- Objetivo imposible informado como no logrado, sin aumentar tamaño.
- Original ya dentro del objetivo conservado byte a byte.
- Rechazo de contraseña, PDF dañado, nivel inválido, objetivo negativo y web pendiente.

## Cobertura pendiente

Web/qpdf y rutas no están implementados y por tanto no fueron aprobados. No hay validación de APK, dispositivo Android, formularios complejos, firmas existentes ni corpus completo de codecs de imagen. Esta implementación inicial no debe declararse terminada.

Según el flujo acordado, el plan detallado de reparación y ampliación de regresiones se elaborará cuando el principal complete el recorrido de las 13 tareas. El hallazgo queda registrado, sin aplicar correcciones.

Identificador del motor examinado (SHA256): `b206f9eccac578f2a26148bd0e7079b4ad014358f32c3654ecfea96ca01c7e6e`.

Versiones efectivas: Node 22.23.2, MuPDF 1.28.1, Vitest 4.1.11, TypeScript 6.0.3. Dependencias enlazadas al proyecto principal; el principal ha comunicado incorporación de lectores de correo, sin modificar MuPDF ni la instantánea de fuentes evaluada.
