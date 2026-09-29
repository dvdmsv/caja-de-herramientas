"""Paquetes de actualización: sólo los archivos que cambian de una versión a otra.

El instalador completo pesa ~310 MB y escribe 1,27 GB, pero una versión normal
cambia unos 30 MB: nuestro backend (`merge-pdf-backend.exe`), el frontend y la
aplicación de Tauri. LibreOffice, Tesseract y las bibliotecas de Python casi
nunca. Así que cada release publica:

- `archivos.json`, el **manifiesto**: cada archivo de la instalación con su
  SHA-256 y su tamaño, y una huella de lo que decide el propio instalador;
- para cada una de las últimas versiones que tengan manifiesto, un **paquete**
  (`CajaDeHerramientas-cambios-desde-<versión>.tar.gz`) con los archivos nuevos o
  distintos y `cambios.json`, que dice qué hay y cómo tiene que quedar.

Quien los aplica es la aplicación (`escritorio/src-tauri/src/parche.rs`). Si la
huella del instalador cambia entre dos versiones —las asociaciones de «Abrir
con…», los iconos, la configuración de NSIS—, no hay paquete: eso sólo lo sabe
aplicar NSIS, y se usa el instalador completo.

Se usa desde la CI (`.github/workflows/escritorio.yml`):

    python paquetes.py manifiesto --version 0.2.3 --salida archivos.json
    python paquetes.py anteriores --actual v0.2.3 < releases.json
    python paquetes.py paquete --viejo anterior.json --nuevo archivos.json --salida dir/
    python paquetes.py podar --ultima v0.2.3 < releases.json

`releases.json` es lo que da `gh api repos/<repo>/releases`, de la más nueva a
la más vieja.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import io
import re
import sys
import tarfile
from pathlib import Path

FORMATO = 1

AQUI = Path(__file__).resolve().parent.parent  # escritorio/

# Dónde pone cada cosa el instalador: lo mismo que `bundle.resources` de
# tauri.conf.json, más el ejecutable de Tauri en la raíz. Si cambia uno, el otro.
def origenes(escritorio: Path = AQUI) -> dict[str, Path]:
    return {
        'caja-de-herramientas.exe': escritorio / 'src-tauri' / 'target' / 'release' / 'caja-de-herramientas.exe',
        'backend': escritorio / 'dist' / 'merge-pdf-backend',
        'vendor': escritorio / 'dist' / 'vendor',
    }


# Lo que sólo aplica NSIS. Si cambia, no puede haber paquete.
ARCHIVOS_DEL_INSTALADOR = ('src-tauri/windows/ganchos.nsh', 'src-tauri/windows/lateral.bmp',
                           'src-tauri/windows/cabecera.bmp', 'src-tauri/icons/icon.ico',
                           'src-tauri/icons/instalador.ico')

PREFIJO_PAQUETE = 'CajaDeHerramientas-cambios-desde-'
MANIFIESTO = 'archivos.json'

# Desde cuántas versiones atrás hay paquete. Quien venga de más lejos usa el
# instalador completo; con más, cada release subiría más paquetes que casi nadie
# usa.
VERSIONES_CON_PAQUETE = 5


def sha256(ruta: Path) -> str:
    resumen = hashlib.sha256()
    with open(ruta, 'rb') as archivo:
        for trozo in iter(lambda: archivo.read(1 << 20), b''):
            resumen.update(trozo)
    return resumen.hexdigest()


def recorrer(fuentes: dict[str, Path]) -> dict[str, Path]:
    """Cada archivo de la instalación, por su ruta relativa (con `/`)."""
    archivos: dict[str, Path] = {}
    for destino, origen in fuentes.items():
        if origen.is_file():
            archivos[destino] = origen
            continue
        for ruta in sorted(origen.rglob('*')):
            if ruta.is_file():
                archivos[f'{destino}/{ruta.relative_to(origen).as_posix()}'] = ruta
    return archivos


def huella_del_instalador(escritorio: Path = AQUI) -> str:
    """Resumen de lo que decide NSIS: sus ganchos, sus imágenes y la
    configuración de Tauri **sin el número de versión**, que cambia siempre."""
    resumen = hashlib.sha256()
    configuracion = json.loads((escritorio / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))
    configuracion.pop('version', None)
    resumen.update(json.dumps(configuracion, sort_keys=True).encode())
    for relativa in ARCHIVOS_DEL_INSTALADOR:
        ruta = escritorio / relativa
        resumen.update(relativa.encode())
        resumen.update(ruta.read_bytes() if ruta.exists() else b'-')
    return resumen.hexdigest()


def manifiesto(version: str, archivos: dict[str, Path], huella: str) -> dict:
    return {
        'formato': FORMATO,
        'version': version,
        'instalador': huella,
        'archivos': {ruta: {'sha256': sha256(origen), 'tamano': origen.stat().st_size}
                     for ruta, origen in sorted(archivos.items())},
    }


def cambios(viejo: dict, nuevo: dict) -> dict | None:
    """Qué hay que hacer para pasar de `viejo` a `nuevo`; `None` si no se puede
    por paquete (cambia el instalador o el formato)."""
    if viejo.get('formato') != FORMATO or nuevo.get('formato') != FORMATO:
        return None
    if viejo.get('instalador') != nuevo.get('instalador'):
        return None
    antes, despues = viejo['archivos'], nuevo['archivos']
    return {
        'formato': FORMATO,
        'desde': viejo['version'],
        'hasta': nuevo['version'],
        # Los que llegan en el paquete, con su resumen para comprobarlos.
        'archivos': {ruta: datos['sha256'] for ruta, datos in despues.items()
                     if antes.get(ruta, {}).get('sha256') != datos['sha256']},
        # Para las notas y el registro: la aplicación borra todo lo que sobre en
        # las carpetas gestionadas, lo sepa el manifiesto viejo o no.
        'borrar': sorted(set(antes) - set(despues)),
        # La lista entera: con ella la aplicación barre lo que sobre en
        # `backend/` y `vendor/`, aunque no viniera de ningún manifiesto
        # (`CARPETAS` en `src-tauri/src/parche_plan.rs`).
        'todos': sorted(despues),
    }


def escribir_paquete(plan: dict, archivos: dict[str, Path], destino: Path) -> Path:
    """El paquete: un `.tar.gz` con `cambios.json` **el primero** y los archivos
    bajo `archivos/`. Tar y gzip, y no zip, porque la aplicación ya lleva con qué
    leerlos (`tar` y `flate2` entran con Tauri) y así no suma otra dependencia.
    El orden importa: la aplicación lee `cambios.json` antes que nada para saber
    qué resumen tiene que tener cada archivo que viene detrás."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(destino, 'w:gz', compresslevel=9, format=tarfile.PAX_FORMAT) as paquete:
        datos = json.dumps(plan, ensure_ascii=False, indent=1).encode()
        cabecera = tarfile.TarInfo('cambios.json')
        cabecera.size = len(datos)
        paquete.addfile(cabecera, io.BytesIO(datos))
        for ruta in sorted(plan['archivos']):
            paquete.add(archivos[ruta], f'archivos/{ruta}', recursive=False)
    return destino


def nombre_del_paquete(desde: str) -> str:
    return f'{PREFIJO_PAQUETE}{desde}.tar.gz'


def anteriores(releases: list[dict], actual: str) -> list[str]:
    """Las etiquetas de las últimas versiones publicadas con manifiesto, desde
    las que se hace paquete. Sin borradores ni versiones previas: ésas no las
    ofrece el actualizador, así que nadie las tiene instaladas por él."""
    return [release['tag_name'] for release in releases
            if release['tag_name'] != actual and not release.get('draft') and not release.get('prerelease')
            and any(recurso['name'] == MANIFIESTO for recurso in release.get('assets', []))
            ][:VERSIONES_CON_PAQUETE]


def a_podar(releases: list[dict], ultima: str) -> list[tuple[str, str]]:
    """Los paquetes de las releases que no son la última: `(etiqueta, recurso)`.

    Sólo sirven desde la última, que es la que enlaza `latest.json`; en las
    demás ocupan sitio para nada. Se quedan el instalador completo, para quien
    quiera esa versión, y el manifiesto, que hace falta para los paquetes de
    las siguientes.
    """
    patron = re.compile(re.escape(PREFIJO_PAQUETE) + r'.+\.tar\.gz(\.sig)?$')
    return [(release['tag_name'], recurso['name'])
            for release in releases if release['tag_name'] != ultima
            for recurso in release.get('assets', []) if patron.match(recurso['name'])]


def _principal(argumentos: list[str]) -> int:
    lector = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ordenes = lector.add_subparsers(dest='orden', required=True)
    uno = ordenes.add_parser('manifiesto')
    uno.add_argument('--version', required=True)
    uno.add_argument('--salida', type=Path, required=True)
    dos = ordenes.add_parser('paquete')
    dos.add_argument('--viejo', type=Path, required=True)
    dos.add_argument('--nuevo', type=Path, required=True)
    dos.add_argument('--salida', type=Path, required=True, help='carpeta donde dejar el paquete')
    tres = ordenes.add_parser('podar')
    tres.add_argument('--ultima', required=True)
    cuatro = ordenes.add_parser('anteriores')
    cuatro.add_argument('--actual', required=True)
    opciones = lector.parse_args(argumentos)

    if opciones.orden == 'manifiesto':
        datos = manifiesto(opciones.version, recorrer(origenes()), huella_del_instalador())
        opciones.salida.write_text(json.dumps(datos, indent=1), encoding='utf-8')
        total = sum(a['tamano'] for a in datos['archivos'].values())
        print(f'{len(datos["archivos"])} archivos, {total / 1e6:.0f} MB')
    elif opciones.orden == 'paquete':
        viejo = json.loads(opciones.viejo.read_text(encoding='utf-8'))
        nuevo = json.loads(opciones.nuevo.read_text(encoding='utf-8'))
        plan = cambios(viejo, nuevo)
        if plan is None:
            print(f'Sin paquete desde {viejo.get("version")}: cambia el instalador.')
            return 0
        ruta = escribir_paquete(plan, recorrer(origenes()), opciones.salida / nombre_del_paquete(plan['desde']))
        print(f'{ruta.name}: {len(plan["archivos"])} archivos, {len(plan["borrar"])} a borrar, '
              f'{ruta.stat().st_size / 1e6:.1f} MB')
    elif opciones.orden == 'anteriores':
        print('\n'.join(anteriores(json.load(sys.stdin), opciones.actual)))
    else:
        for etiqueta, recurso in a_podar(json.load(sys.stdin), opciones.ultima):
            print(f'{etiqueta}\t{recurso}')
    return 0


if __name__ == '__main__':
    sys.exit(_principal(sys.argv[1:]))
