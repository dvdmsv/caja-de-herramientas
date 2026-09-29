"""El visor de Markdown: lo que se ve y, sobre todo, lo que no se deja hacer.

Dos cosas importan más que el aspecto. Que **no quede nada guardado** —es un
visor, no una conversión— y que el Markdown con HTML dentro no pueda sacar nada
del documento: el PDF lee con `html=True` y aquí el resultado llega a un
navegador.

Ninguno carga WeasyPrint: el render vive en `api/markdown_html.py`.
"""
import os

import pytest

from tests.conftest import SESION, subida

RUTA = '/api/tools/visor-markdown/previsualizar'

MUESTRA = """# Informe

## Cuentas

| Concepto | Importe |
|---|---:|
| Base | 100,00 € |
| **Total** | **121,00 €** |

| Nombre | Cantidad |
|---|---|
| Uno | 3 |
| Dos | 40 |

- [x] hecha
- [ ] pendiente

```python
def f(x):
    return x
```
"""


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('ligeros').test_client()


def subir(datos: bytes, nombre='nota.md'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def post(cliente, **cuerpo):
    return cliente.post(RUTA, headers={'X-Session-Id': SESION}, json=cuerpo)


def html_de(cliente, **cuerpo) -> str:
    respuesta = post(cliente, **cuerpo)
    assert respuesta.status_code == 200, respuesta.get_json()
    return respuesta.get_json()['html']


def test_pegado_se_maqueta_con_las_mismas_marcas_que_el_pdf(cliente):
    html = html_de(cliente, texto=MUESTRA)
    assert '<h1>Informe</h1>' in html
    assert 'class="cuadro"' in html          # dos columnas cortas con importes
    assert 'class="numero"' in html          # columna numérica alineada
    assert 'class="total"' in html           # última fila en negrita
    assert 'class="tarea"' in html and 'casilla marcada' in html
    assert '<pre class="resaltado">' in html  # código con lenguaje, coloreado


def test_un_archivo_subido_se_lee_igual_que_un_texto(cliente):
    pegado = post(cliente, texto=MUESTRA).get_json()
    subido = post(cliente, file_ids=[subir(MUESTRA.encode())]).get_json()
    assert subido == pegado
    assert subido['palabras'] > 10


def test_no_deja_nada_guardado_mas_que_lo_subido(cliente):
    from storage import storage
    id_ = subir(MUESTRA.encode())
    antes = sorted(os.listdir(storage.session_dir(SESION, create=False)))
    assert post(cliente, file_ids=[id_]).status_code == 200
    assert post(cliente, texto=MUESTRA).status_code == 200
    assert sorted(os.listdir(storage.session_dir(SESION, create=False))) == antes


def test_un_archivo_de_windows_se_lee_en_cp1252(cliente):
    html = html_de(cliente, file_ids=[subir('# Año nuevo\n\nCafé con leche'.encode('cp1252'))])
    assert 'Año nuevo' in html and 'Café' in html


def test_en_pantalla_no_hay_portada(cliente):
    texto = '# Título\n\nSubtítulo\n<div style="page-break-after: always"></div>\n\n## Cuerpo\n'
    assert 'portada' not in html_de(cliente, texto=texto)
    from api.markdown_html import cuerpo_html
    assert 'class="portada"' in cuerpo_html(texto)  # en el PDF, sí


def test_saltos_de_linea_se_respetan_salvo_que_se_pida_lo_contrario(cliente):
    assert '<br' in html_de(cliente, texto='uno\ndos')
    assert '<br' not in html_de(cliente, texto='uno\ndos', saltos=False)


def test_el_tema_y_el_acento_cambian_la_hoja(cliente):
    claro = html_de(cliente, texto='# a', acento='rojo')
    oscuro = html_de(cliente, texto='# a', acento='rojo', tema='oscuro')
    assert '--acento:#b3122c' in claro and 'color-scheme:light' in claro
    assert '--acento:#b3122c' not in oscuro and 'color-scheme:dark' in oscuro
    assert '--fondo:#16191d' in oscuro


@pytest.mark.parametrize('cuerpo', [
    {'texto': '# a', 'tema': 'sepia'},
    {'texto': '# a', 'acento': 'fucsia'},
    {'texto': '# a', 'familia': 'comic'},
    {'texto': '# a', 'saltos': 'si'},
])
def test_una_opcion_que_no_existe_se_rechaza(cliente, cuerpo):
    assert post(cliente, **cuerpo).status_code == 400


def test_hace_falta_el_texto_o_el_archivo_pero_no_los_dos(cliente):
    assert post(cliente).status_code == 400
    assert post(cliente, texto=5).status_code == 400
    assert post(cliente, texto='# a', file_ids=[subir(b'# b')]).status_code == 400
    assert post(cliente, file_ids=[subir(b'# a'), subir(b'# b')]).status_code == 400


def test_solo_abre_markdown_y_no_admite_vacios(cliente):
    assert post(cliente, file_ids=[subir(b'hola', 'nota.txt')]).status_code == 400
    assert post(cliente, texto='   \n').status_code == 422
    assert post(cliente, file_ids=[subir(b'  \n', 'vacio.md')]).status_code == 422


def test_un_texto_gigante_se_rechaza(cliente):
    from api.tools import visor_markdown
    assert post(cliente, texto='a' * (visor_markdown.MAXIMO_CARACTERES + 1)).status_code == 413


def test_el_html_crudo_no_puede_salirse_del_documento(cliente):
    peligro = (
        '# Hola\n\n'
        '<script>alert(1)</script>\n\n'
        '<meta http-equiv="refresh" content="0;url=http://malo.example/">\n\n'
        '<base href="http://malo.example/">\n\n'
        '<link rel="stylesheet" href="http://malo.example/x.css">\n\n'
        'texto <META/http-equiv=refresh content="0;url=http://malo.example/"> más\n\n'
        '<img src="http://malo.example/rastreo.png">\n'
    )
    html = html_de(cliente, texto=peligro)
    cabecera, _, cuerpo = html.partition('<body>')

    # La red y los scripts los corta la CSP; lo que ella no cubre, se quita.
    assert "default-src 'none'" in cabecera
    assert 'img-src data:' in cabecera
    assert 'http-equiv="Content-Security-Policy"' in cabecera
    assert cabecera.count('<base') == 1 and 'href' not in cabecera.split('<base')[1].split('>')[0]
    # La `<META/http-equiv…>` mal formada no es una etiqueta para markdown-it y
    # sale escapada como texto, que es inofensivo: lo que no puede haber es una
    # etiqueta de verdad.
    for etiqueta in ('<meta', '<base', '<link', 'malo.example/x.css', 'href="http://malo'):
        assert etiqueta not in cuerpo.lower(), etiqueta
    assert 'http-equiv=refresh' not in cuerpo.replace('&quot;', '"').replace('&lt;', '<') \
        .split('<META')[0]


def test_el_codigo_que_parece_html_se_enseña_escapado(cliente):
    html = html_de(cliente, texto='```html\n<script>alert(1)</script>\n```\n')
    assert '<script>alert' not in html.partition('<body>')[2]


def test_las_imagenes_incrustadas_se_conservan(cliente):
    pixel = 'data:image/png;base64,iVBORw0KGgo='
    assert f'src="{pixel}"' in html_de(cliente, texto=f'![x]({pixel})')
