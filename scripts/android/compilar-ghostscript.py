#!/usr/bin/env python3
"""Compila Ghostscript oficial y su lanzador para Android.

Requiere Linux x86_64, Python, gcc, make y Android NDK r28+. La descarga inicial
necesita Internet; después se reutiliza el archivo cuya huella se comprueba.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

VERSION = '10.08.0'
SHA256 = 'caf199e3f233f1290b27d0972d636f66c303355f2353309b7bfddf1edda06b3d'
URL = f'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/ghostscript-{VERSION}.tar.gz'
TARGETS = {'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7a-linux-androideabi',
           'x86_64': 'x86_64-linux-android', 'x86': 'i686-linux-android'}


def avisos(source):
    pieces = []
    for path in sorted(source.rglob('*')):
        name = path.name.lower()
        if path.is_file() and (name.startswith(('license', 'copying', 'copyright')) or name.endswith('.notice') or name == 'ftl.txt'):
            pieces.append('\n--- ' + str(path.relative_to(source)) + ' ---\n' + path.read_text(errors='replace'))
    for name in ['jpeg/README', 'Resource/CMap/Identity-H']:
        path = source/name
        if path.exists():
            pieces.append('\n--- '+name+' ---\n'+path.read_text(errors='replace').split('%%EndComments')[0])
    return '\n'.join(pieces)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ndk', type=Path, required=True)
    parser.add_argument('--abi', choices=TARGETS, default='arm64-v8a')
    parser.add_argument('--directorio', type=Path, required=True, help='Directorio de trabajo fuera del código fuente')
    parser.add_argument('--instalar', action='store_true', help='Copiar las bibliotecas al proyecto Android')
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    root = args.directorio.resolve()
    root.mkdir(parents=True, exist_ok=True)
    archive = root / f'ghostscript-{VERSION}.tar.gz'
    if not archive.exists():
        partial = archive.with_suffix('.part')
        urllib.request.urlretrieve(URL, partial)
        partial.rename(archive)
    with archive.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    if digest != SHA256:
        raise SystemExit('La huella SHA256 de Ghostscript no coincide; no se compilará.')
    build = root / args.abi
    build.mkdir(exist_ok=True)
    source = build / f'ghostscript-{VERSION}'
    if not source.exists():
        with tarfile.open(archive) as tar:
            tar.extractall(build, filter='data')
    # Bionic define __printflike usando printf, que gsio.h redefine. Mantener
    # el atributo de comprobación usando una macro privada de Ghostscript.
    header = source / 'base/gserrors.h'
    header.write_text(header.read_text().replace('__printflike', 'gs_printflike'))
    toolchain = args.ndk.resolve() / 'toolchains/llvm/prebuilt/linux-x86_64/bin'
    target = TARGETS[args.abi]
    env = dict(os.environ, CC=str(toolchain / f'{target}26-clang'),
               CXX=str(toolchain / f'{target}26-clang++'), AR=str(toolchain / 'llvm-ar'),
               RANLIB=str(toolchain / 'llvm-ranlib'))
    subprocess.run(['./configure', f'--host={target}', '--build=x86_64-pc-linux-gnu',
                    '--without-x', '--without-tesseract', '--disable-cups', '--disable-dbus',
                    '--disable-gtk', '--disable-fontconfig', '--without-libidn', '--without-libpaper',
                    '--without-ijs', '--without-urf', '--without-so', '--without-cal', '--disable-contrib'],
                   cwd=source, env=env, check=True)
    # Forzar reenlace cuando se reutiliza una compilación anterior al SONAME Android.
    binary = source / f'sobin/libgs.so.{VERSION[:5]}'
    binary.unlink(missing_ok=True)
    subprocess.run(['make', f'-j{args.jobs}', 'so',
                    'XCFLAGS=-Wno-error=declaration-after-statement',
                    'GS_LDFLAGS_SO=-shared -Wl,-soname=libgs.so -Wl,-z,max-page-size=16384'],
                   cwd=source, env=env, check=True)
    output = root / 'salida' / args.abi
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / f'sobin/libgs.so.{VERSION[:5]}', output / 'libgs.so')
    repository = Path(__file__).resolve().parents[2]
    subprocess.run([env['CC'], '-O2', '-fPIE', '-pie', '-Wl,-z,max-page-size=16384',
                    '-Wl,-rpath,$ORIGIN', '-I'+str(source/'psi'),
                    str(repository/'frontend/android/native/ghostscript-main.c'),
                    '-L'+str(output), '-lgs', '-o', str(output/'libgsrun.so')], check=True)
    for name in ['libgs.so', 'libgsrun.so']:
        subprocess.run([str(toolchain/'llvm-strip'), '--strip-unneeded', str(output/name)], check=True)
    shutil.copyfile(source / 'LICENSE', output / 'COPYING')
    if args.instalar:
        destination = repository/'frontend/android/app/src/main/jniLibs'/args.abi
        destination.mkdir(parents=True, exist_ok=True)
        for name in ['libgs.so', 'libgsrun.so']:
            shutil.copyfile(output/name, destination/name)
        legal = repository/'frontend/src/assets/legal/GHOSTSCRIPT.txt'
        legal.parent.mkdir(parents=True, exist_ok=True)
        legal.write_text(f'Ghostscript {VERSION} — Artifex Software\nFuentes: {URL}\nSHA256: {SHA256}\n'
                         'Compilación y cambios: scripts/android/compilar-ghostscript.py y frontend/android/native/ghostscript-main.c\n\n'
                         + avisos(source))
    print(f'Motor compilado: {output}.')


if __name__ == '__main__':
    main()
