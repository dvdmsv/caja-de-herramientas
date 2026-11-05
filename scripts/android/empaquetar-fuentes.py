#!/usr/bin/env python3
"""Agrupa fuentes de la app y motores nativos usados por una distribución local."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--ghostscript',type=Path,required=True)
p.add_argument('--qpdf',type=Path,required=True)
p.add_argument('--metadatos',type=Path,required=True)
p.add_argument('--libreoffice',type=Path,required=True)
p.add_argument('--salida',type=Path,required=True)
a=p.parse_args();repo=Path(__file__).resolve().parents[2]
config=json.loads((repo/'scripts/android/libreoffice-motores.json').read_text())
assert hashlib.file_digest(a.libreoffice.open('rb'),'sha256').hexdigest()==config['fuentes_sha256'], 'Fuentes LibreOffice incorrectas'
archives=[a.ghostscript,a.libreoffice,a.qpdf/'qpdf-12.4.2.tar.gz',a.qpdf/'jpeg-9f.tar.gz',a.metadatos/'exiv2-0.28.9.tar.gz',a.metadatos/'expat-2.9.0.tar.gz',a.metadatos/'json.hpp']
for source in archives:
 if not source.is_file():raise SystemExit('Falta '+str(source))
a.salida.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(a.salida,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for source in archives:z.write(source,'motores/'+source.name,compress_type=zipfile.ZIP_STORED)
 for folder in ['frontend/src','frontend/tests','frontend/scripts','frontend/android/app/src/main/java','frontend/android/app/src/main/res','frontend/android/app/src/test','frontend/android/app/src/androidTest','frontend/android/native','frontend/android/legal','frontend/android/gradle','scripts','docs/android-ciclo']:
  for file in sorted((repo/folder).rglob('*')):
   if file.is_file() and '__pycache__' not in file.parts:z.write(file,file.relative_to(repo))
 for pattern in ['frontend/*.json','frontend/*.ts','frontend/.nvmrc','frontend/android/*.gradle','frontend/android/gradle.properties','frontend/android/gradlew*','frontend/android/app/*.gradle','frontend/android/app/*.pro','frontend/android/app/src/main/AndroidManifest.xml','frontend/android/README.md','backend/api/patrones.py','docs/paridad-android*','LICENSE*']:
  for file in sorted(repo.glob(pattern)):
   if file.is_file():z.write(file,file.relative_to(repo))
 z.writestr('LEEME.txt','Fuentes de la app y motores nativos para Android.\nCompilación: frontend/android/README.md y scripts/android.\nDependencias Java y npm fijadas por Gradle y package-lock.json.\nFuentes LibreOffice oficiales y adaptadores modificados incluidos.\nLos APK upstream se obtienen con preparar-libreoffice.py y sus SHA256 fijados.\nNo contiene claves de publicación. Los certificados de pruebas son fixtures públicos.\n')
print(a.salida)
