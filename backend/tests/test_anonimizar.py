"""Tachar por patrón: que encuentre lo que hay, que no invente y que borre.

Va en dos mitades, que es como está partido el código. La lógica de los patrones
—`api/patrones.py`— se prueba con cadenas escritas a mano, sin PDF ninguno,
porque lo que ahí se equivoque acaba en un documento con un DNI sin tachar. Y la
herramienta se prueba de punta a punta leyendo el PDF resultante con PyMuPDF: que
el recuadro esté puesto no demuestra nada, porque el texto puede seguir debajo.
"""
import fitz
import pytest

from tests.conftest import SESION, subida

TODOS = ['dni', 'nie', 'iban', 'telefono', 'correo', 'tarjeta', 'cif',
         'matricula', 'codigo_postal']


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def documento(renglones, giro=0):
    """Un PDF de una página con un renglón por elemento."""
    archivo = fitz.open()
    pagina = archivo.new_page()
    for indice, texto in enumerate(renglones):
        pagina.insert_text((72, 100 + indice * 30), texto, fontsize=12)
    pagina.set_rotation(giro)
    datos = archivo.tobytes()
    archivo.close()
    return datos


def subir(datos, nombre='contrato.pdf'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def anonimizar(cliente, datos, **opciones):
    opciones.setdefault('tipos', TODOS)
    return cliente.post('/api/tools/anonimizar-pdf', headers={'X-Session-Id': SESION},
                        json={'file_ids': [subir(datos)], **opciones})


def texto_de(respuesta) -> str:
    from storage import storage

    ruta = storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])
    with fitz.open(ruta) as archivo:
        return '\n'.join(pagina.get_text() for pagina in archivo)


# --- los patrones, sin PDF de por medio ----------------------------------

@pytest.mark.parametrize('texto, tipo', [
    ('12345678Z', 'dni'),
    ('12345678 Z', 'dni'),
    ('12345678-Z', 'dni'),
    ('X1234567L', 'nie'),
    ('ES9121000418450200051332', 'iban'),
    ('ES91 2100 0418 4502 0005 1332', 'iban'),
    ('4539 1488 0343 6467', 'tarjeta'),
    ('600123456', 'telefono'),
    ('+34 600 123 456', 'telefono'),
    ('ana.ruiz@ejemplo.es', 'correo'),
])
def test_lo_que_es_un_dato_se_encuentra(texto, tipo):
    from api import patrones

    encontradas = patrones.coincidencias(texto, set(patrones.PATRONES))
    assert [c[2] for c in encontradas] == [tipo]
    assert texto[encontradas[0][0]:encontradas[0][1]] == texto


@pytest.mark.parametrize('texto, tipo', [
    ('A58818501', 'cif'),      # control en cifra
    ('Q2826004J', 'cif'),      # control en letra
    ('G28029643', 'cif'),
    ('1234 BCD', 'matricula'),
    ('1234BCD', 'matricula'),
    ('M-1234-AB', 'matricula'),
    ('28001', 'codigo_postal'),
])
def test_los_patrones_nuevos_encuentran_lo_suyo(texto, tipo):
    from api import patrones

    encontradas = patrones.coincidencias(texto, set(patrones.PATRONES))
    assert [c[2] for c in encontradas] == [tipo]


@pytest.mark.parametrize('texto', [
    'A58818502',   # el control no cuadra
    'Q2826004K',
    '1234 AEI',    # una matrícula no lleva vocales
    '1234 QQQ',    # ni Q
    '99999',       # no hay provincia 99
])
def test_los_patrones_nuevos_tampoco_se_inventan_nada(texto):
    from api import patrones

    assert patrones.coincidencias(texto, set(patrones.PATRONES)) == []


def test_el_codigo_postal_es_el_mas_ruidoso_y_por_eso_va_aparte():
    """Cinco cifras seguidas son muchas cosas. Se admite porque el usuario lo
    marca a propósito, y la pantalla lo deja desmarcado de serie."""
    from api import patrones

    encontradas = patrones.coincidencias('El importe fue 12500', {'codigo_postal'})
    assert [c[2] for c in encontradas] == ['codigo_postal']
    # Sin marcarlo, no molesta.
    assert patrones.coincidencias('El importe fue 12500', {'dni', 'iban'}) == []


@pytest.mark.parametrize('texto', [
    '12345678 A',               # la letra de control no cuadra: es una factura
    'X1234567 X',               # ídem con el NIE
    'ES9121000418450200051333',  # el módulo 97 no da 1
    '1234 5678 9012 3456',      # no pasa Luhn: es un número de pedido
    '123456789',                # nueve cifras, pero un teléfono no empieza por 1
])
def test_lo_que_solo_lo_parece_no_se_tacha(texto):
    """Validar es la diferencia entre anonimizar y estropear el documento."""
    from api import patrones

    assert patrones.coincidencias(texto, set(patrones.PATRONES)) == []


def test_un_iban_no_se_cuenta_ademas_como_telefono():
    """Sus grupos de cifras también casan con el teléfono; gana el más largo."""
    from api import patrones

    encontradas = patrones.coincidencias('ES91 2100 0418 4502 0005 1332',
                                         set(patrones.PATRONES))
    assert [c[2] for c in encontradas] == ['iban']


def test_un_dato_partido_en_dos_palabras_se_encuentra_entero():
    """«12345678 Z» son dos palabras para PyMuPDF, y la caja tiene que cubrir las dos."""
    from api import patrones

    palabras = [(10, 20, 30, 32, 'DNI', 0, 0, 0),
                (35, 20, 90, 32, '12345678', 0, 0, 1),
                (93, 20, 100, 32, 'Z', 0, 0, 2)]
    zonas = patrones.zonas_de_palabras(palabras, {'dni'})

    assert len(zonas) == 1
    assert zonas[0] == (35, 20, 100, 32, 'dni')


def test_no_se_junta_el_final_de_un_renglon_con_el_principio_del_siguiente():
    """Buscar de corrido inventaría datos donde sólo hay un salto de línea."""
    from api import patrones

    palabras = [(10, 20, 60, 32, '12345678', 0, 0, 0),
                (10, 40, 20, 52, 'Z', 0, 1, 0)]
    assert patrones.zonas_de_palabras(palabras, {'dni'}) == []


def test_una_expresion_que_no_compila_se_dice_y_no_revienta():
    from api import patrones

    with pytest.raises(ValueError) as fallo:
        patrones.compilar('(sin cerrar')
    assert 'no es válida' in str(fallo.value)


def test_una_expresion_demasiado_larga_no_se_acepta():
    from api import patrones

    with pytest.raises(ValueError):
        patrones.compilar('a' * (patrones.MAXIMO_PATRON + 1))


# --- la herramienta, leyendo el PDF que sale -----------------------------

def test_el_texto_desaparece_del_archivo(cliente):
    """Lo que importa no es que no se vea: es que no se pueda copiar."""
    respuesta = anonimizar(cliente, documento([
        'Contrato con Ana Ruiz',
        'DNI 12345678 Z y correo ana@ejemplo.es',
        'IBAN ES91 2100 0418 4502 0005 1332',
    ]))

    assert respuesta.status_code == 201
    assert respuesta.get_json()['tachadas'] == 3
    salida = texto_de(respuesta)
    assert '12345678' not in salida
    assert 'ana@ejemplo.es' not in salida
    assert 'ES91' not in salida


def test_un_documento_largo_no_se_rechaza_por_tener_muchos_datos(cliente):
    """Un contrato de trescientas páginas con un DNI en cada una es uso normal.

    El tope existe contra una expresión desbocada, no contra un documento
    grande. Medido: un PDF así da 24 coincidencias por página, así que con el
    tope en 2000 fallaba a partir de unas 84 páginas —y el mensaje culpaba a una
    expresión propia que nadie había escrito—.
    """
    renglones = [
        'Don Juan Ejemplo, DNI 12345678 Z, telefono 600 123 456,',
        'correo juan@ejemplo.es, cuenta ES91 2100 0418 4502 0005 1332.',
    ]
    archivo = fitz.open()
    for _ in range(120):
        pagina = archivo.new_page()
        for indice, texto in enumerate(renglones * 5):
            pagina.insert_text((50, 80 + indice * 20), texto, fontsize=9)
    datos = archivo.tobytes()
    archivo.close()

    respuesta = anonimizar(cliente, datos)

    assert respuesta.status_code == 201
    # 2000 era el tope viejo: el documento tiene que pasarlo holgadamente para
    # que este test siga significando algo.
    assert respuesta.get_json()['tachadas'] > 2000
    assert '12345678' not in texto_de(respuesta)


def test_el_aviso_de_demasiadas_no_culpa_a_una_expresion_que_no_existe(cliente):
    """Decir «tu expresión casa con demasiadas cosas» a quien sólo marcó DNI
    manda a buscar el problema donde no está."""
    from api.tools import anonimizar_pdf
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        anonimizar_pdf._pasarse(5, propio=None)
    assert 'expresión' not in fallo.value.message

    with pytest.raises(ApiError) as fallo:
        anonimizar_pdf._pasarse(5, propio=object())
    assert 'expresión' in fallo.value.message


def test_los_dos_topes_de_marcas_van_juntos():
    """Si el visor admite menos marcas de las que la inspección devuelve, marcar
    en el visor funciona y **guardar** falla con otro 413. Son la misma red."""
    from api.tools import anonimizar_pdf, visor

    assert visor.MAXIMO_MARCAS >= anonimizar_pdf.MAXIMO_ZONAS


def test_lo_que_no_es_un_dato_se_queda(cliente):
    """Tachar de más estropea el documento tan bien como tachar de menos."""
    respuesta = anonimizar(cliente, documento([
        'Factura 12345678 A de Ana Ruiz',
        'Referencia 1234 5678 9012 3456',
    ]), tipos=['dni', 'tarjeta'])

    assert respuesta.status_code == 422
    assert 'No se ha encontrado' in respuesta.get_json()['error']


def test_un_escaneado_sin_texto_manda_al_ocr(cliente):
    """Devolverlo intacto haría creer que el documento está limpio."""
    archivo = fitz.open()
    archivo.new_page().draw_rect(fitz.Rect(72, 72, 300, 300), fill=(0.5, 0.5, 0.5))
    datos = archivo.tobytes()
    archivo.close()

    respuesta = anonimizar(cliente, datos)

    assert respuesta.status_code == 422
    assert 'OCR' in respuesta.get_json()['error']


def test_hay_que_marcar_algo(cliente):
    respuesta = anonimizar(cliente, documento(['nada']), tipos=[], patron='')

    assert respuesta.status_code == 400
    assert 'al menos un tipo' in respuesta.get_json()['error']


def test_una_expresion_rota_se_contesta_con_400(cliente):
    respuesta = anonimizar(cliente, documento(['nada']), tipos=[], patron='(sin cerrar')

    assert respuesta.status_code == 400
    assert 'no es válida' in respuesta.get_json()['error']


def test_un_tipo_inventado_se_contesta_con_400(cliente):
    respuesta = anonimizar(cliente, documento(['nada']), tipos=['huella-dactilar'])

    assert respuesta.status_code == 400
    assert 'huella-dactilar' in respuesta.get_json()['error']


def test_la_expresion_propia_tacha_lo_suyo(cliente):
    respuesta = anonimizar(cliente, documento(['Expediente AB-2026-0042 de Ana']),
                           tipos=[], patron=r'[A-Z]{2}-\d{4}-\d{4}')

    assert respuesta.status_code == 201
    salida = texto_de(respuesta)
    assert 'AB-2026-0042' not in salida
    assert 'Ana' in salida


def test_la_inspeccion_cuenta_sin_tocar_el_archivo(cliente):
    """Es lo que se enseña antes de un borrado que no tiene vuelta atrás."""
    ident = subir(documento(['DNI 12345678 Z', 'DNI 12345678Z otra vez', 'Tel 600123456']))

    respuesta = cliente.post('/api/tools/anonimizar-pdf/inspeccionar',
                             headers={'X-Session-Id': SESION},
                             json={'file_ids': [ident], 'tipos': TODOS})

    cuerpo = respuesta.get_json()
    assert respuesta.status_code == 200
    assert cuerpo['total'] == 3
    assert {r['tipo']: r['cuantas'] for r in cuerpo['recuento']} == {'dni': 2, 'telefono': 1}

    assert [m['tipo'] for m in cuerpo['paginas'][0]['marcas']] == ['dni', 'dni', 'telefono']

    from storage import storage
    with fitz.open(storage.path_of(SESION, ident)) as archivo:
        assert '12345678' in archivo[0].get_text()


@pytest.mark.parametrize('giro', [0, 90, 180, 270])
def test_las_zonas_que_lee_el_visor_vuelven_a_su_sitio(giro):
    """`_proporciones` tiene que ser el inverso exacto del `_rectangulos` del visor.

    El visor pinta lo que devuelve la inspección como una marca más suya. Si los
    dos no coinciden, no falla nada: salen recuadros en el sitio equivocado.
    """
    from api.tools.anonimizar_pdf import _proporciones
    from api.tools.visor import _rectangulos

    archivo = fitz.open()
    pagina = archivo.new_page(width=595, height=842)
    pagina.set_rotation(giro)
    original = (72.0, 100.0, 180.0, 115.0)

    vuelta = _rectangulos(pagina, [_proporciones(pagina, original)])[0]

    assert vuelta.x0 == pytest.approx(original[0], abs=1e-6)
    assert vuelta.y0 == pytest.approx(original[1], abs=1e-6)
    assert vuelta.x1 == pytest.approx(original[2], abs=1e-6)
    assert vuelta.y1 == pytest.approx(original[3], abs=1e-6)
    archivo.close()
