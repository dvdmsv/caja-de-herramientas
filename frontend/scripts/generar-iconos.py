#!/usr/bin/env python3
"""Recorta bootstrap-icons a los iconos que esta aplicación usa de verdad.

Bootstrap Icons trae 2078 iconos: 97 kB de CSS y 131 kB de fuente. Aquí se usan
84. Y la fuente es lo único que el gzip de nginx no puede aliviar, porque un
woff2 ya viene comprimido, así que recortarla es el único modo de no enviarla
entera.

Esto **no corre en el build**: genera archivos que se versionan, para que un
clon nuevo compile sin necesitar Python ni fonttools. Se ejecuta a mano cuando
se añade o se quita un icono:

    cd frontend && python3 scripts/generar-iconos.py

Si se olvida, no se rompe en silencio: `iconos.spec.ts` compara los iconos que
usa `src/` con los que hay en el CSS generado y falla si falta alguno.

Requiere `pip install fonttools brotli`.
"""

import pathlib
import re
import subprocess
import sys

AQUI = pathlib.Path(__file__).resolve().parent.parent
ORIGEN = AQUI / 'node_modules' / 'bootstrap-icons' / 'font'
DESTINO = AQUI / 'src' / 'estilos' / 'iconos'


def iconos_usados() -> set[str]:
    """Los `bi-*` que aparecen en el código fuente.

    Se buscan como literales completos a propósito. Si algún día un icono se
    arma concatenando (`'bi-' + nombre`), esta búsqueda no lo vería y el icono
    saldría en blanco: por eso el test comprueba lo mismo y hay que mantener los
    nombres escritos enteros.
    """
    encontrados = set()
    for f in (AQUI / 'src').rglob('*'):
        # Sin saltarse su propia salida, un icono que se deja de usar seguiría
        # "usándose" en el CSS generado y no se quitaría nunca.
        if DESTINO in f.parents:
            continue
        if f.suffix in {'.html', '.ts', '.css'} and f.is_file():
            encontrados |= set(re.findall(r'\bbi-([a-z0-9-]+)', f.read_text()))
    return encontrados


def main() -> int:
    css_origen = (ORIGEN / 'bootstrap-icons.css').read_text()

    # nombre del icono -> el carácter privado que le toca en la fuente
    codigos = {n: c for n, c in re.findall(r'\.bi-([a-z0-9-]+)::before\s*{\s*content:\s*"\\([0-9a-f]+)"', css_origen)}

    usados = iconos_usados()
    desconocidos = sorted(usados - codigos.keys())
    if desconocidos:
        print(f'Estos no existen en bootstrap-icons: {desconocidos}', file=sys.stderr)
        return 1

    usados = sorted(usados)
    print(f'{len(usados)} iconos usados de {len(codigos)} disponibles')

    DESTINO.mkdir(parents=True, exist_ok=True)

    # 1. La fuente, con sólo esos glifos.
    puntos = ','.join('U+' + codigos[n] for n in usados)
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset',
        str(ORIGEN / 'fonts' / 'bootstrap-icons.woff2'),
        f'--unicodes={puntos}',
        '--flavor=woff2',
        '--output-file=' + str(DESTINO / 'iconos.woff2'),
    ], check=True)

    # 2. El CSS, con sólo esas clases. La declaración de `.bi` se copia del
    #    original para no cambiar el aspecto: mismos ajustes de línea base.
    reglas = '\n'.join(f'.bi-{n}::before {{ content: "\\{codigos[n]}"; }}' for n in usados)
    (DESTINO / 'iconos.css').write_text(f'''/* GENERADO por scripts/generar-iconos.py — no editar a mano.
   {len(usados)} iconos de los {len(codigos)} que trae bootstrap-icons.
   Para añadir uno: úsalo en el código y vuelve a ejecutar el script. */

@font-face {{
  font-family: "bootstrap-icons";
  src: url("./iconos.woff2") format("woff2");
  font-display: block;
}}

.bi::before,
[class^="bi-"]::before,
[class*=" bi-"]::before {{
  display: inline-block;
  font-family: "bootstrap-icons" !important;
  font-style: normal;
  font-weight: normal !important;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  vertical-align: -.125em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}}

{reglas}
''')

    antes_f = (ORIGEN / 'fonts' / 'bootstrap-icons.woff2').stat().st_size
    antes_c = (ORIGEN / 'bootstrap-icons.css').stat().st_size
    ahora_f = (DESTINO / 'iconos.woff2').stat().st_size
    ahora_c = (DESTINO / 'iconos.css').stat().st_size
    print(f'  fuente: {antes_f/1024:6.1f} kB -> {ahora_f/1024:5.1f} kB')
    print(f'  css:    {antes_c/1024:6.1f} kB -> {ahora_c/1024:5.1f} kB')
    print(f'  total:  {(antes_f+antes_c)/1024:6.1f} kB -> {(ahora_f+ahora_c)/1024:5.1f} kB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
