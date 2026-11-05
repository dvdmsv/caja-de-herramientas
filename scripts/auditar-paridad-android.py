#!/usr/bin/env python3
"""Inventario reproducible del catálogo Android y contratos Flask (sin dependencias)."""
import argparse
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def contratos(path):
    tree = ast.parse(path.read_text())
    prefix = ''
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'Blueprint':
            for kw in node.keywords:
                if kw.arg == 'url_prefix' and isinstance(kw.value, ast.Constant):
                    prefix = kw.value.value
    routes = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
                continue
            method = dec.func.attr
            if method not in {'get', 'post', 'put', 'patch', 'delete', 'route'} or not dec.args:
                continue
            if not isinstance(dec.args[0], ast.Constant):
                continue
            methods = [method.upper()]
            if method == 'route':
                methods = ['GET']
                for kw in dec.keywords:
                    if kw.arg == 'methods':
                        methods = ast.literal_eval(kw.value)
            routes.extend({'metodo': m, 'ruta': prefix + dec.args[0].value} for m in methods)
    return routes


def inventario():
    catalog = (ROOT / 'frontend/src/app/core/tools.ts').read_text()
    local = (ROOT / 'frontend/src/app/core/local/catalogo.ts').read_text()
    slugs = re.findall(r"slug:\s*'([^']+)'", catalog)
    enabled = set(re.findall(r"'([^']+)'", local.split('new Set([')[1].split(']);')[0]))
    if len(slugs) != len(set(slugs)) or enabled - set(slugs):
        raise ValueError('Catálogo duplicado o herramientas locales sin entrada en el catálogo')
    evidence_path = ROOT / 'docs/paridad-android-evidencias.json'
    evidence = json.loads(evidence_path.read_text()) if evidence_path.exists() else {}
    if set(evidence) - set(slugs):
        raise ValueError('Hay evidencias de herramientas que no existen')
    for entry in evidence.values():
        for test in entry['pruebas']:
            if not (ROOT / test).is_file():
                raise ValueError(f'No existe la prueba {test}')
    routes = {}
    for path in sorted((ROOT / 'backend/api').rglob('*.py')):
        found = contratos(path)
        if found:
            routes[str(path.relative_to(ROOT))] = found
    return {'herramientas': [{'slug': slug, 'habilitada': slug in enabled,
        'estado': evidence.get(slug, {}).get('estado', 'parcial; verificar opciones' if slug in enabled else 'pendiente'),
        'pruebas': evidence.get(slug, {}).get('pruebas', []),
        'contratos': [route for values in routes.values() for route in values
                      if route['ruta'].startswith('/api/tools/' + slug + '/')
                      or route['ruta'] == '/api/tools/' + slug]}
        for slug in slugs], 'contratos_backend': routes}


def markdown(data):
    rows = ['# Paridad Android', '',
        'Inventario generado con `python3 scripts/auditar-paridad-android.py`.', '',
        'Evidencias persistentes: `docs/paridad-android-evidencias.json` (no se sobrescriben al regenerar).', '',
        'Habilitada no significa paridad: cada opción, formato y operación auxiliar necesita evidencia.', '',
        '| Herramienta | Estado | Contratos específicos |', '|---|---|---|']
    for tool in data['herramientas']:
        routes = '<br>'.join(f"`{r['metodo']} {r['ruta']}`" for r in tool['contratos']) or 'Revisar contratos compartidos'
        rows.append(f"| {tool['slug']} | {tool['estado']} | {routes} |")
    rows += ['', '## Contratos compartidos y auxiliares', '',
        'La salida `--json` incluye todas las rutas del backend, también archivos, sesión, visor y bóveda.', '',
        '## Criterios de aceptación', '',
        '- Prueba del motor real y de todas las opciones de la pantalla.',
        '- Primera ejecución en modo avión con recursos incluidos en la instalación.',
        '- Importación, previsualización, cancelación, lotes y exportación en Android real.',
        '- Conservación de texto, formularios, enlaces, marcadores y anotaciones cuando corresponda.',
        '- Comparación con documentos de referencia de Windows.', '',
        '## Motores integrados', '',
        '- Office: LibreOfficeKit 26.2.6.3, cuatro ABI, recursos y fuentes incluidos.',
        '- Firma: PDFBox Android 2.0.27.0 y Bouncy Castle 1.79; PKCS12 y almacén Android.',
        '- PDF/A y grises: Ghostscript 10.08.0; validación externa de muestras con veraPDF.',
        '- OCR: Tesseract 6.0.1 WebAssembly y modelos locales español/inglés.',
        '- Optimización web: qpdf 12.4.2. Metadatos de imagen: Exiv2 0.28.9.', '',
        '## Limitaciones conocidas de las herramientas habilitadas', '',
        '- Unión: rechazo de formularios, enlaces y anotaciones; no hay paridad estructural.',
        '- Visor: solo lectura; faltan edición, anotaciones y búsqueda avanzada.',
        '- Imágenes: el adaptador ofrece JPG, PNG y WebP; falta comparar formatos con Windows.',
        '- Emulador Android 30 probado; faltan dispositivos físicos y cobertura exhaustiva de versiones.',
        '- Firmas: integridad local sin consulta de revocación; clasificación conservadora de revisiones.',
        '- Tablas: detección de rejillas; documentos complejos requieren comparación con el original.', '']
    return '\n'.join(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='Contratos completos legibles por herramientas')
    args = parser.parse_args()
    data = inventario()
    print(json.dumps(data, ensure_ascii=False, indent=2) if args.json else markdown(data))
