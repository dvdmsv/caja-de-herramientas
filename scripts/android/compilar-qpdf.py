#!/usr/bin/env python3
"""qpdf estático para Android; fuentes verificadas, JPEG IJG independiente."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

QPDF = ('qpdf-12.4.2', 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2.tar.gz', '8a58af5b6141319287c1883bec8bd1bd545b7567b7fc5e6ce5d25a1c85f36397')
JPEG = ('jpeg-9f', 'https://www.ijg.org/files/jpegsrc.v9f.tar.gz', '04705c110cb2469caa79fb71fba3d7bf834914706e9641a4589485c1f832565b')
TARGETS = {'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7a-linux-androideabi', 'x86_64': 'x86_64-linux-android', 'x86': 'i686-linux-android'}

def comprobar_arbol(archive, directory):
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = Path(*Path(member.name).parts[1:])
            path = directory/relative
            if not path.is_file() or hashlib.sha256(path.read_bytes()).digest()!=hashlib.sha256(tar.extractfile(member).read()).digest():
                raise SystemExit('Las fuentes extraídas se han modificado: '+str(path)+'. Usa otro directorio de compilación.')

def source(root, spec):
    name, url, digest = spec
    archive = root / (name+'.tar.gz')
    if not archive.exists():
        urllib.request.urlretrieve(url, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise SystemExit('SHA256 incorrecto: '+name)
    if not (root/name).exists():
        with tarfile.open(archive) as tar:
            tar.extractall(root, filter='data')
    comprobar_arbol(archive,root/name)
    return root/name

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ndk', type=Path, required=True)
    p.add_argument('--cmake', required=True)
    p.add_argument('--directorio', type=Path, required=True)
    p.add_argument('--abi', choices=TARGETS, required=True)
    p.add_argument('--instalar', action='store_true')
    a = p.parse_args()
    root = a.directorio.resolve(); root.mkdir(parents=True, exist_ok=True)
    qpdf, jpeg_source = source(root,QPDF), source(root,JPEG)
    build = root/a.abi; build.mkdir(exist_ok=True)
    jpeg = build/'jpeg-9f'
    if not jpeg.exists(): shutil.copytree(jpeg_source,jpeg)
    comprobar_arbol(root/(JPEG[0]+'.tar.gz'),jpeg)
    bin = a.ndk.resolve()/'toolchains/llvm/prebuilt/linux-x86_64/bin'
    target = TARGETS[a.abi]
    env = dict(os.environ, CC=str(bin/(target+'26-clang')), AR=str(bin/'llvm-ar'), RANLIB=str(bin/'llvm-ranlib'), CFLAGS='-O2 -fPIC', PKG_CONFIG_LIBDIR='/nonexistent')
    subprocess.run(['./configure','--host='+target,'--disable-shared','--enable-static'],cwd=jpeg,env=env,check=True)
    subprocess.run(['make','-j4','libjpeg.la'],cwd=jpeg,env=env,check=True)
    out = build/'qpdf'
    subprocess.run([a.cmake,'-S',str(qpdf),'-B',str(out),
        '-DCMAKE_TOOLCHAIN_FILE='+str(a.ndk.resolve()/'build/cmake/android.toolchain.cmake'),
        '-DANDROID_ABI='+a.abi,'-DANDROID_PLATFORM=26','-DANDROID_STL=c++_static',
        '-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DBUILD_STATIC_LIBS=ON',
        '-DBUILD_DOC=OFF','-DUSE_IMPLICIT_CRYPTO=OFF','-DREQUIRE_CRYPTO_NATIVE=ON',
        '-DSTATIC_JPEG=ON','-DLIBJPEG_H_PATH='+str(jpeg),'-DLIBJPEG_LIB_PATH='+str(jpeg/'.libs/libjpeg.a'),
        '-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,max-page-size=16384'],env=env,check=True)
    subprocess.run([a.cmake,'--build',str(out),'--target','qpdf','-j4'],env=env,check=True)
    if a.instalar:
        repo = Path(__file__).resolve().parents[2]
        dest = repo/'frontend/android/app/src/main/jniLibs'/a.abi/'libqpdfrun.so'
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(out/'qpdf/qpdf',dest)
        subprocess.run([str(bin/'llvm-strip'),'--strip-unneeded',str(dest)],check=True)
        (repo/'frontend/src/assets/legal/QPDF.txt').write_text('qpdf 12.4.2\n'+QPDF[1]+'\nSHA256: '+QPDF[2]+'\n'+(qpdf/'LICENSE.txt').read_text()+'\n'+(qpdf/'NOTICE.md').read_text()+'\nJPEG IJG 9f\n'+JPEG[1]+'\nSHA256: '+JPEG[2]+'\n'+(jpeg/'README').read_text())
        (build/'compilacion.json').write_text(json.dumps({'abi':a.abi,'ndk':(a.ndk/'source.properties').read_text(),'cmake':subprocess.check_output([a.cmake,'--version'],text=True),'qpdf':QPDF,'jpeg':JPEG,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()},indent=2)+'\n')

if __name__ == '__main__': main()
