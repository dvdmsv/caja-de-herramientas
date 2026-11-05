#!/usr/bin/env python3
"""Exporta los patrones comunes de Python a Android sin mantener dos listas."""
import argparse
import importlib.util
import json
import re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('patrones',root/'backend/api/patrones.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
data=[{'tipo':key,'expresion':value['expresion'].pattern,'ignorarCaso':bool(value['expresion'].flags & re.I)} for key,value in m.PATRONES.items()]
texto=('// Generado por scripts/android/generar-patrones.py desde backend/api/patrones.py.\nexport const PATRONES = '+json.dumps(data,ensure_ascii=False,indent=2)+' as const;\n')

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check',action='store_true')
args=parser.parse_args()
# Corpus determinista: cambios de dígitos/control y contextos con Unicode.
semillas=['12345678Z','12345678 Z','X1234567L','ES91 2100 0418 4502 0005 1332',
          '4539 1488 0343 6467','+34 600 123 456','ana.ruiz@ejemplo.es',
          'A58818501','Q2826004J','G28029643','1234 BCD','M-1234-AB','28001',
          '١٢٣٤٥٦٧٨Z','🙂 12345678Z y correo ana@ejemplo.es']
casos=set(semillas)
for semilla in semillas:
    casos.add(''.join(chr(0x660+int(c)) if c in '0123456789' else c for c in semilla))
    casos.update(['Dato: '+semilla+'.',semilla.lower(),'X'+semilla+'X'])
    for i,c in enumerate(semilla):
        if c in '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            for sustituto in '019AZ':
                casos.add(semilla[:i]+sustituto+semilla[i+1:])
corpus=[]
for caso in sorted(casos):
    hallazgos=m.coincidencias(caso,set(m.PATRONES))
    corpus.append({'texto':caso,'coincidencias':[{
        'inicio':len(caso[:a].encode('utf-16-le'))//2,
        'fin':len(caso[:b].encode('utf-16-le'))//2,'tipo':tipo} for a,b,tipo in hallazgos]})
salidas={root/'frontend/src/app/core/local/patrones-generados.ts':texto,
         root/'frontend/tests/local/fixtures/patrones-python.json':json.dumps(corpus,ensure_ascii=False,indent=2)+'\n'}
for destino,contenido in salidas.items():
    if args.check:
        if not destino.exists() or destino.read_text()!=contenido:
            raise SystemExit('Los patrones o sus pruebas están desactualizados. Ejecuta scripts/android/generar-patrones.py.')
    else:
        destino.parent.mkdir(parents=True,exist_ok=True)
        destino.write_text(contenido)
