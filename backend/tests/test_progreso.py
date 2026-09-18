"""El canal de progreso: quien trabaja escribe en el volumen, `web` lee.

Lo que se comprueba aquí es lo que rompería el mecanismo en producción sin que
nada fallara a la vista: que sin cabecera no pase nada, que el registro se borre
al terminar, que no se escriba una vez por página y que la cancelación se note.
"""
import json
import os

import fitz
import pytest

from tests.conftest import SESION

TRABAJO = 'b' * 32


@pytest.fixture
def pesados(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


@pytest.fixture
def web(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('web').test_client()


@pytest.fixture
def contexto(entorno):
    """Un contexto de petición con las dos cabeceras, para usar `progreso` a pelo."""
    entorno()
    import app as modulo
    from api import progreso

    aplicacion = modulo.create_app('pesados')

    def preparar(trabajo=TRABAJO, sesion=SESION):
        cabeceras = {'X-Session-Id': sesion}
        if trabajo:
            cabeceras['X-Trabajo-Id'] = trabajo
        return aplicacion.test_request_context(headers=cabeceras), progreso

    return preparar


def documento(ruta, paginas=6):
    archivo = fitz.open()
    for numero in range(paginas):
        archivo.new_page().insert_text((72, 100), f'Página {numero + 1}', fontsize=12)
    archivo.save(str(ruta), deflate=True)
    archivo.close()
    return str(ruta)


def subir(ruta):
    from storage import storage

    from tests.conftest import subida
    with open(ruta, 'rb') as fichero:
        return storage.save_upload(SESION, subida(fichero.read(), 'documento.pdf')).id


# --- el canal ---------------------------------------------------------------

def test_lo_que_escribe_quien_trabaja_lo_lee_el_otro_servicio(contexto):
    """`pesados` escribe y `web` lee, y entre los dos sólo hay un archivo."""
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Convirtiendo páginas', total=40)
        progreso.paso(7)

        estado = progreso.leer(SESION, TRABAJO)

    assert estado['modo'] == 'pasos'
    assert estado['etapa'] == 'Convirtiendo páginas'
    assert estado['total'] == 40
    assert estado['cancelable'] is True


def test_sin_cabecera_de_trabajo_no_se_escribe_nada(contexto):
    """Un cliente viejo, o el barrido, tienen que funcionar igual."""
    peticion, progreso = contexto(trabajo=None)
    with peticion:
        progreso.iniciar('Convirtiendo páginas', total=40)
        progreso.paso()
        assert progreso.leer(SESION, TRABAJO) is None
        assert progreso.cancelado() is False


def test_no_se_escribe_una_vez_por_paso(contexto):
    """Un documento de 2000 marcas no puede hacer 2000 escrituras."""
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Estampando páginas', total=500)
        for _ in range(500):
            progreso.paso()

        # El freno deja el archivo con lo último que se escribió, no con el paso
        # 500; lo que importa es que el conteo interno sí va al día.
        estado = progreso.leer(SESION, TRABAJO)

    assert estado['hechos'] < 500


def test_el_ultimo_parte_se_escribe_al_cambiar_de_etapa(contexto):
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Comparando páginas', total=10)
        progreso.paso()
        progreso.fase('Maquetando el informe', cancelable=False)

        estado = progreso.leer(SESION, TRABAJO)

    assert estado['etapa'] == 'Maquetando el informe'
    assert estado['cancelable'] is False


def test_lo_estimado_dice_cuanto_cree_que_va_a_durar(contexto):
    """Para lo que no tiene pasos: el porcentaje lo anima el navegador."""
    peticion, progreso = contexto()
    with peticion:
        with progreso.estimando('Reconociendo el texto', 42.0):
            estado = progreso.leer(SESION, TRABAJO)

    assert estado == {'modo': 'estimado', 'etapa': 'Reconociendo el texto',
                      'estimado': 42.0, 'desde': estado['desde'], 'cancelable': True}


def test_el_registro_va_en_su_carpeta_y_no_entre_los_archivos(contexto):
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Trabajando', total=3)
        from storage import storage
        sesion = storage.session_dir(SESION, create=False)

        assert os.path.isfile(os.path.join(sesion, '.trabajos', f'{TRABAJO}.json'))
        # Los archivos del usuario son `<id>.json` en la raíz de la sesión: si el
        # parte cayera ahí, `record_of` intentaría leerlo como un archivo.
        assert not os.path.isfile(os.path.join(sesion, f'{TRABAJO}.json'))

    # Al salir del contexto de petición ya se ha ejecutado el `teardown`, que es
    # quien lo borra: por eso hay que mirarlo dentro.
    assert not os.path.isfile(os.path.join(sesion, '.trabajos', f'{TRABAJO}.json'))


def test_el_parte_es_un_json_entero_o_no_es_nada(contexto):
    """Se escribe en un temporal y se renombra: quien lee está en otro
    contenedor y nunca puede encontrarse medio JSON."""
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Trabajando', total=3)
        from storage import storage
        carpeta = os.path.join(storage.session_dir(SESION, create=False), '.trabajos')

        with open(os.path.join(carpeta, f'{TRABAJO}.json'), encoding='utf-8') as fichero:
            assert json.load(fichero)['etapa'] == 'Trabajando'
        assert not [n for n in os.listdir(carpeta) if n.endswith('.tmp')]


# --- cancelar ---------------------------------------------------------------

def test_la_marca_de_cancelacion_para_el_trabajo_en_el_siguiente_paso(contexto):
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Convirtiendo páginas', total=100)
        progreso.marcar_cancelacion(SESION, TRABAJO)

        assert progreso.cancelado() is True
        with pytest.raises(progreso.Cancelado) as fallo:
            progreso.comprobar_cancelacion()

    assert fallo.value.status == 409


def test_una_etapa_no_cancelable_ignora_la_marca(contexto):
    """Retirar el botón es más honrado que dejar una marca que nadie mira."""
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Guardando el documento', cancelable=False)
        progreso.marcar_cancelacion(SESION, TRABAJO)

        assert progreso.cancelado() is False


# --- los endpoints de `web` -------------------------------------------------

def test_web_contesta_null_mientras_el_trabajo_espera_turno(web):
    """Que no haya nada no es un error: es que aún no ha empezado."""
    respuesta = web.get(f'/api/progreso/{TRABAJO}', headers={'X-Session-Id': SESION})

    assert respuesta.status_code == 200
    assert respuesta.get_json() == {'estado': None}


def test_un_identificador_inventado_no_toca_el_disco(web):
    respuesta = web.get('/api/progreso/..%2f..%2fetc', headers={'X-Session-Id': SESION})
    assert respuesta.status_code in (400, 404)

    respuesta = web.post('/api/progreso/x/cancelar', headers={'X-Session-Id': SESION})
    assert respuesta.status_code == 400


def test_el_progreso_de_otra_sesion_no_se_ve(web, contexto):
    otra = 'c' * 32
    peticion, progreso = contexto()
    with peticion:
        progreso.iniciar('Trabajando', total=3)

    respuesta = web.get(f'/api/progreso/{TRABAJO}', headers={'X-Session-Id': otra})

    assert respuesta.get_json() == {'estado': None}


def test_al_terminar_la_peticion_no_queda_rastro(pesados, web, tmp_path):
    """Lo borra el `teardown_request`, así que da igual cómo acabe la petición.

    Sin esto, el navegador seguiría viendo el último parte de un trabajo que ya
    ha terminado y la barra se quedaría clavada.
    """
    file_id = subir(documento(tmp_path / 'documento.pdf'))

    respuesta = pesados.post('/api/tools/pdf-a-imagen',
                             headers={'X-Session-Id': SESION, 'X-Trabajo-Id': TRABAJO},
                             json={'file_ids': [file_id], 'formato': 'JPEG', 'ppp': 96})
    assert respuesta.status_code == 201

    consulta = web.get(f'/api/progreso/{TRABAJO}', headers={'X-Session-Id': SESION})
    assert consulta.get_json() == {'estado': None}


def test_una_herramienta_cancelada_no_devuelve_archivos(pesados, web, tmp_path):
    """Se cancela antes de empezar: el trabajo se para en el primer paso."""
    file_id = subir(documento(tmp_path / 'documento.pdf', paginas=40))

    web.post(f'/api/progreso/{TRABAJO}/cancelar', headers={'X-Session-Id': SESION})
    respuesta = pesados.post('/api/tools/pdf-a-imagen',
                             headers={'X-Session-Id': SESION, 'X-Trabajo-Id': TRABAJO},
                             json={'file_ids': [file_id], 'formato': 'JPEG', 'ppp': 96})

    assert respuesta.status_code == 409
    assert respuesta.get_json()['error'] == 'Trabajo cancelado.'


def test_web_no_registra_las_herramientas_pero_si_el_progreso(entorno):
    """Es el reparto que hace que esto sirva: la consulta la atiende `web`,
    que está libre, y no `pesados`, que está ocupado justo con lo que se
    pregunta —y además limitado a tres conexiones por IP en nginx—."""
    import app as modulo

    entorno()
    rutas_web = [str(regla) for regla in modulo.create_app('web').url_map.iter_rules()]
    rutas_pesados = [str(regla) for regla in modulo.create_app('pesados').url_map.iter_rules()]

    assert any('/api/progreso/' in ruta for ruta in rutas_web)
    assert not any('/api/progreso/' in ruta for ruta in rutas_pesados)
