#!/usr/bin/env python3
"""Run with Python containing pyhanko, pymupdf, cryptography; no network needed."""
import argparse,os,subprocess,tempfile,zipfile,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--sdk',type=Path,required=True);p.add_argument('--gradle-cache',type=Path,default=Path.home()/'.gradle/caches');p.add_argument('--output',type=Path,required=True);a=p.parse_args();here=Path(__file__).resolve().parent;out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);audit=out/'auditoria';audit.mkdir(exist_ok=True);classes=audit/'classes';classes.mkdir(exist_ok=True)
def one(pattern):
 files=list(a.gradle_cache.rglob(pattern));assert files,pattern;return files[0]
aar=one('pdfbox-android-2.0.27.0.aar')
with zipfile.ZipFile(aar) as z:
 jar=audit/'pdfbox.jar';jar.write_bytes(z.read('classes.jar'))
 for n in z.namelist():
  if n.startswith('assets/com/') and not n.endswith('/'):
   dest=classes/n[7:];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(n))
android=sorted((a.sdk/'platforms').glob('android-*/android.jar'))[-1]
cp=os.pathsep.join(map(str,[jar,*[one(n+'-1.79.jar') for n in ['bcprov-jdk18on','bcpkix-jdk18on','bcutil-jdk18on']],android]))
sources=a.repo.resolve()/'frontend/android/app/src/main/java/io/github/dvdmsv/cajadeherramientas'
subprocess.run(['javac','-cp',cp,'-d',str(classes),str(here/'java/android/util/Log.java'),*[str(sources/(n+'.java')) for n in ['FirmasPdf','SellarPdf','CertificacionPdf']],str(here/'java/ArnesTiempo.java')],check=True)
with (audit/'matriz-base.log').open('w') as log:subprocess.run([__import__('sys').executable,str(here/'matriz-permisos.py')],cwd=out,stdout=log,check=True)
r=subprocess.run(['java','-cp',str(classes)+os.pathsep+cp,'io.github.dvdmsv.cajadeherramientas.ArnesTiempo'],cwd=out,capture_output=True,text=True);(audit/'criptografico.log').write_text(r.stdout+r.stderr);print(r.stdout+r.stderr);raise SystemExit(r.returncode)
