#!/usr/bin/env python3
"""Comprueba las cuatro ABI y alineación ELF de 16 KB, en el proyecto o una APK."""
import argparse
from pathlib import Path
import struct
import zipfile

MACHINES = {'arm64-v8a': 183, 'armeabi-v7a': 40, 'x86_64': 62, 'x86': 3}


def comprobar(data, machine, minimo=16384):
    assert data[:4] == b'\x7fELF' and data[5] == 1, 'No es ELF little-endian'
    assert struct.unpack_from('<H', data, 18)[0] == machine, 'Arquitectura incorrecta'
    wide = data[4] == 2
    phoff = struct.unpack_from('<Q' if wide else '<I', data, 32 if wide else 28)[0]
    size, count = struct.unpack_from('<HH', data, 54 if wide else 42)
    loads = 0
    for i in range(count):
        offset = phoff + i*size
        if struct.unpack_from('<I', data, offset)[0] != 1:
            continue
        loads += 1
        align = struct.unpack_from('<Q' if wide else '<I', data, offset+(48 if wide else 28))[0]
        assert align >= minimo, f'Segmento sin alineación de {minimo} bytes'
    assert loads, 'ELF sin segmentos cargables'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]/'frontend/android/app/src/main/jniLibs'
    archive = zipfile.ZipFile(args.apk) if args.apk else None
    try:
        for abi, machine in MACHINES.items():
            requeridos={'libgs.so','libgsrun.so','libqpdfrun.so','libmetadatosrun.so','liboffice-aislamiento.so','liblo-native-code.so','libc++_shared.so','libnss3.so','libnspr4.so','libfreebl3.so','libnssckbi.so','libnssdbm3.so','libnssutil3.so','libplc4.so','libplds4.so','libsmime3.so','libsoftokn3.so','libsqlite3.so','libssl3.so'}
            disponibles={Path(n).name for n in archive.namelist() if n.startswith(f'lib/{abi}/') and n.endswith('.so')} if archive else {n.name for n in (root/abi).glob('*.so')}
            assert requeridos <= disponibles, f'Motores ausentes para {abi}: {requeridos-disponibles}'
            for lib in sorted(disponibles):
                data = archive.read(f'lib/{abi}/{lib}') if archive else (root/abi/lib).read_bytes()
                comprobar(data, machine, 16384 if abi in ('arm64-v8a','x86_64') or lib in ('libgs.so','libgsrun.so','libqpdfrun.so','libmetadatosrun.so','liboffice-aislamiento.so') else 4096)
                print(f'{abi}/{lib}: ELF y alineación compatibles ({"16 KB" if abi in ("arm64-v8a","x86_64") else "ABI heredada de 32 bits"})')
    finally:
        if archive:
            archive.close()


if __name__ == '__main__':
    main()
