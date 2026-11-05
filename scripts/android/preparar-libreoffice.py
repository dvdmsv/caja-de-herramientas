#!/usr/bin/env python3
"""Instala las bibliotecas y recursos oficiales LibreOffice 26.2.6.3, sin descargar en ejecución."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directorio',type=Path,required=True);p.add_argument('--ndk',type=Path,required=True);a=p.parse_args()
 repo=Path(__file__).resolve().parents[2];config=json.loads((repo/'scripts/android/libreoffice-motores.json').read_text());a.directorio.mkdir(parents=True,exist_ok=True)
 targets={'arm64-v8a':'aarch64-linux-android','armeabi-v7a':'armv7a-linux-androideabi','x86_64':'x86_64-linux-android','x86':'i686-linux-android'}
 for paquete in config['paquetes']:
  apk=a.directorio/f"libreoffice-{paquete['versionCode']}.apk"
  if not apk.exists():urllib.request.urlretrieve(paquete['url'],apk)
  if hashlib.sha256(apk.read_bytes()).hexdigest()!=paquete['sha256']:raise SystemExit('SHA256 incorrecto: '+str(apk))
  with zipfile.ZipFile(apk) as z:
   for name in z.namelist():
    if name.startswith('lib/'+paquete['abi']+'/') and name.endswith('.so'):
     dest=repo/'frontend/android/app/src/main/jniLibs'/paquete['abi']/Path(name).name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(name))
    elif paquete['abi']=='arm64-v8a' and name.startswith(('assets/program/','assets/share/','assets/unpack/')) and not name.endswith('/'):
     relative=Path(name).relative_to('assets')
     if '..' in relative.parts:raise SystemExit('Ruta de recursos no válida')
     dest=repo/'frontend/android/app/src/main/assets'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(name))
  clang=a.ndk.resolve()/'toolchains/llvm/prebuilt/linux-x86_64/bin'/(targets[paquete['abi']]+'26-clang')
  output=repo/'frontend/android/app/src/main/jniLibs'/paquete['abi']/'liboffice-aislamiento.so'
  subprocess.run([str(clang),'-shared','-fPIC','-O2','-Wl,-z,max-page-size=16384',str(repo/'frontend/android/native/office-aislamiento.c'),'-o',str(output)],check=True)
 print('LibreOffice instalado para las cuatro ABI; fuentes y fuentes tipográficas incluidas en la instalación.')
if __name__=='__main__':main()
