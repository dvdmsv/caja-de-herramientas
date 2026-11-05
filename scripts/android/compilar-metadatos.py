#!/usr/bin/env python3
"""Compila Exiv2, Expat y el adaptador local para las imágenes Android."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

FUENTES = [
 ('exiv2-0.28.9', 'https://github.com/Exiv2/exiv2/archive/refs/tags/v0.28.9.tar.gz', '700b76b97695b2fab4ef8c79619c68ae57d09e0c130724791cafbd39e0eb4aef'),
 ('expat-2.9.0', 'https://github.com/libexpat/libexpat/releases/download/R_2_9_0/expat-2.9.0.tar.gz', '16afbb9cefead2aa278105cf27d9f597bde7fbf3dbb85015857ca7ca6a4e89ba'),
 ('json.hpp', 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp', 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'),
]
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--ndk',type=Path,required=True);p.add_argument('--cmake',required=True)
 p.add_argument('--directorio',type=Path,required=True);p.add_argument('--abi',choices=['arm64-v8a','armeabi-v7a','x86_64','x86'],required=True)
 p.add_argument('--instalar',action='store_true');a=p.parse_args()
 root=a.directorio.resolve();root.mkdir(parents=True,exist_ok=True)
 for name,url,digest in FUENTES:
  path=root/(name if name.endswith('.hpp') else name+'.tar.gz')
  if not path.exists():urllib.request.urlretrieve(url,path)
  if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise SystemExit('SHA256 incorrecto: '+name)
  if not name.endswith('.hpp') and not (root/name).exists():
   with tarfile.open(path) as tar:tar.extractall(root,filter='data')
 build=root/a.abi;prefix=build/'prefix'
 common=['-DCMAKE_TOOLCHAIN_FILE='+str(a.ndk.resolve()/'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI='+a.abi,'-DANDROID_PLATFORM=26','-DANDROID_STL=c++_static','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_POSITION_INDEPENDENT_CODE=ON']
 env=dict(os.environ,PKG_CONFIG_LIBDIR='/nonexistent')
 def run(args):subprocess.run(args,check=True,env=env)
 run([a.cmake,'-S',str(root/'expat-2.9.0'),'-B',str(build/'expat'),*common,'-DEXPAT_SHARED_LIBS=OFF','-DEXPAT_BUILD_TOOLS=OFF','-DEXPAT_BUILD_EXAMPLES=OFF','-DEXPAT_BUILD_TESTS=OFF','-DEXPAT_BUILD_DOCS=OFF','-DCMAKE_INSTALL_PREFIX='+str(prefix)])
 run([a.cmake,'--build',str(build/'expat'),'--target','install','-j4'])
 repo=Path(__file__).resolve().parents[2]
 run([a.cmake,'-S',str(repo/'frontend/android/native/metadatos'),'-B',str(build/'motor'),*common,'-DEXIV2_SOURCE='+str(root/'exiv2-0.28.9'),'-DJSON_INCLUDE='+str(root),'-DCMAKE_PREFIX_PATH='+str(prefix),'-DEXPAT_LIBRARY='+str(prefix/'lib/libexpat.a'),'-DEXPAT_INCLUDE_DIR='+str(prefix/'include')])
 run([a.cmake,'--build',str(build/'motor'),'--target','metadatos','-j4'])
 if a.instalar:
  dest=repo/'frontend/android/app/src/main/jniLibs'/a.abi/'libmetadatosrun.so';dest.parent.mkdir(parents=True,exist_ok=True)
  shutil.copyfile(build/'motor/metadatos',dest)
  run([str(a.ndk.resolve()/'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip'),'--strip-unneeded',str(dest)])
  legal='Exiv2 0.28.9 / Expat 2.9.0 / nlohmann JSON 3.12.0\n'
  for name,url,digest in FUENTES:legal+=f'\n{name}\n{url}\nSHA256: {digest}\n'
  for directory in [root/'exiv2-0.28.9',root/'expat-2.9.0']:
   for file in directory.iterdir():
    if file.is_file() and file.name.lower().startswith(('copying','license','copyright')):legal+='\n'+file.read_text(errors='replace')
  legal+='\n'+(root/'json.hpp').read_text().split('#ifndef')[0]
  (repo/'frontend/src/assets/legal/METADATOS.txt').write_text(legal)
if __name__=='__main__':main()
