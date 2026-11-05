# Pruebas en un teléfono

Herramientas para manejar la app **instalada** en un teléfono desde el ordenador:
Playwright conectado al WebView por el depurador remoto (`adb forward`), que sólo
abren las compilaciones **debug**. No es una batería que se ejecute sola: son
piezas para las pasadas a mano, como la del informe
`docs/android-ciclo/telefono-2026-11-05.md`, que explica el método y sus trampas.

```bash
export CAJA_TELEFONO=192.168.1.18:41131      # el puerto cambia cada vez
backend/.venv/bin/python frontend/tests/telefono/muestras.py
node -e "import('./frontend/tests/telefono/adb.mjs').then(m => m.enlazar())"
```

- `adb.mjs`: el teléfono (siempre con `-s`), abrir la app y enlazar su WebView,
  capturar la pantalla de verdad y pulsar elementos nativos por su texto.
- `app.mjs`: abrir una herramienta, elegir archivos, pulsar la acción principal y
  sacar los resultados de IndexedDB a `salidas/` para comprobarlos aquí.
- `muestras.py`: las muestras de `scripts/barrido.py` y un escaneado de 40 páginas.

`muestras/` y `salidas/` no se versionan.
