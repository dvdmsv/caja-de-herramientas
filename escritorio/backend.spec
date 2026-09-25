# -*- mode: python ; coding: utf-8 -*-
"""El backend empaquetado con PyInstaller para la aplicación de escritorio.

    cd escritorio && pyinstaller backend.spec --noconfirm

Sale en `dist/merge-pdf-backend/`, en modo **carpeta** (onedir) y no en un solo
.exe: el de un archivo se descomprime entero en una carpeta temporal en cada
arranque —segundos de espera cada vez que se abre la aplicación— y es el que
más falsos positivos da en los antivirus.

PyInstaller encuentra solo casi todo, incluso lo que se importa dentro de una
función, porque lee el bytecode. Lo que no ve es lo que se carga **por nombre**
o se lee como archivo de datos, y eso es lo que se le dice aquí:

- `ocrmypdf` descubre sus plugins recorriendo `builtin_plugins` con `pkgutil`.
- `markitdown` detecta tipos con `magika`, que lee un modelo ONNX del disco.
- `weasyprint`, `pyphen` y `tinycss2` traen hojas de estilo y diccionarios.
- `pdf2docx` arranca con `fire`, y los módulos de sus comandos no los importa
  nadie de forma estática.
- `pyhanko` y su validador cargan datos y submódulos a demanda.
- `pypdfium2` es con lo que ocrmypdf rasteriza las páginas para el OCR. Lo
  importa dentro de un `try` y sólo se queja al rasterizar, y su DLL y su
  `version.json` son archivos de datos: sin recogerlo, PDF/A funciona —no
  rasteriza— y el OCR falla.

Añadir una herramienta que traiga un paquete así obliga a añadirlo aquí; si no,
funcionará en desarrollo y fallará sólo en el instalado.
"""
import os

from PyInstaller.utils.hooks import collect_all

BACKEND = os.path.abspath(os.path.join(SPECPATH, '..', 'backend'))
FRONTEND = os.path.abspath(os.path.join(SPECPATH, '..', 'frontend', 'dist', 'merge-pdf', 'browser'))

CON_DATOS_O_PLUGINS = [
    'ocrmypdf', 'markitdown', 'magika', 'weasyprint', 'pyphen', 'tinycss2',
    'cssselect2', 'pdf2docx', 'fire', 'pyhanko', 'pyhanko_certvalidator',
    'pymupdf', 'pikepdf', 'pillow_heif', 'zxingcpp', 'segno', 'uharfbuzz',
    'pypdfium2', 'pypdfium2_raw', 'pypdfium2_cfg',
]

datas = [(FRONTEND, 'frontend')]
binaries = []
hiddenimports = []
for paquete in CON_DATOS_O_PLUGINS:
    d, b, h = collect_all(paquete)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [os.path.join(BACKEND, 'escritorio.py')],
    pathex=[BACKEND],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + ['waitress'],
    # Lo que sólo sirve al servicio web o a los tests.
    excludes=['gunicorn', 'pytest', 'tkinter'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='merge-pdf-backend',
    # Con consola: Tauri lee la línea LISTO por la salida estándar, y sin
    # consola no la hay. La ventana negra no llega a verse porque Tauri lo lanza
    # con CREATE_NO_WINDOW.
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name='merge-pdf-backend', upx=False)
