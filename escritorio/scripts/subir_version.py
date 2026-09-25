#!/usr/bin/env python3
"""Sube la versión de la aplicación de escritorio en los tres sitios donde vive.

    python3 escritorio/scripts/subir_version.py parche   # 0.1.0 → 0.1.1
    python3 escritorio/scripts/subir_version.py menor    # 0.1.3 → 0.2.0
    python3 escritorio/scripts/subir_version.py mayor    # 0.4.2 → 1.0.0

Lo usa el botón «Publicar versión de escritorio» (`publicar-escritorio.yml`),
así que nadie tiene que tocar estos archivos a mano. Escribe en la salida
`version=…` y `etiqueta=v…`, que es lo que lee GitHub Actions de `$GITHUB_OUTPUT`.

La fuente es `tauri.conf.json`: de ahí la lee el instalador, el actualizador y
«Acerca de». `Cargo.toml` y `Cargo.lock` se mantienen a la par para que el
ejecutable diga lo mismo. Se reemplaza el texto con cuidado en vez de reescribir
los archivos enteros, para no cambiarles el formato.
"""
import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent / 'src-tauri'
PAQUETE = 'caja-de-herramientas'


def siguiente(actual: str, tipo: str) -> str:
    mayor, menor, parche = (int(parte) for parte in actual.split('.'))
    if tipo == 'mayor':
        return f'{mayor + 1}.0.0'
    if tipo == 'menor':
        return f'{mayor}.{menor + 1}.0'
    if tipo == 'parche':
        return f'{mayor}.{menor}.{parche + 1}'
    raise SystemExit(f'Tipo de versión desconocido: {tipo!r} (parche, menor o mayor).')


def sustituir_una_vez(ruta: pathlib.Path, patron: str, nuevo: str) -> None:
    texto = ruta.read_text(encoding='utf-8')
    cambiado, veces = re.subn(patron, nuevo, texto, count=1, flags=re.MULTILINE)
    if veces != 1:
        raise SystemExit(f'No se ha encontrado la versión en {ruta}.')
    ruta.write_text(cambiado, encoding='utf-8')


def main(tipo: str) -> None:
    conf = RAIZ / 'tauri.conf.json'
    actual = json.loads(conf.read_text(encoding='utf-8'))['version']
    nueva = siguiente(actual, tipo)

    sustituir_una_vez(conf, r'^(  "version": )"[^"]+"', rf'\g<1>"{nueva}"')
    # La primera línea `version = ` de Cargo.toml es la de [package].
    sustituir_una_vez(RAIZ / 'Cargo.toml', r'^version = "[^"]+"', f'version = "{nueva}"')
    sustituir_una_vez(RAIZ / 'Cargo.lock',
                      rf'(^name = "{PAQUETE}"\nversion = )"[^"]+"', rf'\g<1>"{nueva}"')

    print(f'version={nueva}')
    print(f'etiqueta=v{nueva}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'parche')
