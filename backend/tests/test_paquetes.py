"""Los paquetes de actualización de la aplicación de Windows
(`escritorio/scripts/paquetes.py`): qué entra, qué se borra y cuándo no hay.

Viven aquí y no junto al script porque es la batería que corre la CI en los
dos sistemas.
"""
import importlib.util
import json
import tarfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
_espec = importlib.util.spec_from_file_location('paquetes', RAIZ / 'escritorio' / 'scripts' / 'paquetes.py')
paquetes = importlib.util.module_from_spec(_espec)
_espec.loader.exec_module(paquetes)


def instalacion(tmp_path: Path, nombre: str, contenidos: dict[str, bytes]) -> dict[str, Path]:
    """Una instalación de mentira con sus archivos."""
    raiz = tmp_path / nombre
    for ruta, datos in contenidos.items():
        destino = raiz / ruta
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(datos)
    return paquetes.recorrer({'caja-de-herramientas.exe': raiz / 'caja-de-herramientas.exe',
                              'backend': raiz / 'backend', 'vendor': raiz / 'vendor'})


BASE = {
    'caja-de-herramientas.exe': b'tauri 1',
    'backend/merge-pdf-backend.exe': b'backend 1',
    'backend/_internal/frontend/main-AAAA.js': b'frontend viejo',
    'vendor/libreoffice/soffice.exe': b'libreoffice',
}


def test_entra_lo_cambiado_y_lo_nuevo_y_se_borra_lo_que_sobra(tmp_path):
    viejo = paquetes.manifiesto('0.2.2', instalacion(tmp_path, 'v1', BASE), 'h')
    nuevos = {**BASE, 'backend/merge-pdf-backend.exe': b'backend 2', 'backend/_internal/frontend/main-BBBB.js': b'nuevo'}
    del nuevos['backend/_internal/frontend/main-AAAA.js']
    archivos = instalacion(tmp_path, 'v2', nuevos)
    nuevo = paquetes.manifiesto('0.2.3', archivos, 'h')

    plan = paquetes.cambios(viejo, nuevo)

    assert sorted(plan['archivos']) == ['backend/_internal/frontend/main-BBBB.js', 'backend/merge-pdf-backend.exe']
    assert plan['borrar'] == ['backend/_internal/frontend/main-AAAA.js']
    assert plan['todos'] == sorted(nuevos)
    assert (plan['desde'], plan['hasta']) == ('0.2.2', '0.2.3')

    ruta = paquetes.escribir_paquete(plan, archivos, tmp_path / 'salida' / paquetes.nombre_del_paquete('0.2.2'))
    with tarfile.open(ruta) as paquete:
        # `cambios.json` el primero: la aplicación lo lee antes que los archivos.
        assert paquete.getnames() == ['cambios.json', 'archivos/backend/_internal/frontend/main-BBBB.js',
                                      'archivos/backend/merge-pdf-backend.exe']
        assert json.loads(paquete.extractfile('cambios.json').read()) == plan
        assert paquete.extractfile('archivos/backend/merge-pdf-backend.exe').read() == b'backend 2'
    assert ruta.name == 'CajaDeHerramientas-cambios-desde-0.2.2.tar.gz'


def test_el_resumen_de_cada_archivo_es_el_de_su_contenido(tmp_path):
    import hashlib
    nuevo = paquetes.manifiesto('1', instalacion(tmp_path, 'v', BASE), 'h')
    datos = nuevo['archivos']['backend/merge-pdf-backend.exe']
    assert datos == {'sha256': hashlib.sha256(b'backend 1').hexdigest(), 'tamano': 9}


def test_contra_si_mismo_no_hay_nada_que_hacer(tmp_path):
    """Es lo que comprueba la CI en cada push, sin publicar."""
    igual = paquetes.manifiesto('0.2.2', instalacion(tmp_path, 'v', BASE), 'h')
    plan = paquetes.cambios(igual, igual)
    assert plan['archivos'] == {} and plan['borrar'] == []


@pytest.mark.parametrize('cambio', [{'instalador': 'otra'}, {'formato': 99}])
def test_sin_paquete_si_cambia_el_instalador_o_el_formato(tmp_path, cambio):
    """Las asociaciones de «Abrir con…» o los iconos sólo los aplica NSIS."""
    viejo = paquetes.manifiesto('0.2.2', instalacion(tmp_path, 'v', BASE), 'h')
    assert paquetes.cambios(viejo, {**viejo, 'version': '0.2.3', **cambio}) is None


def test_la_huella_del_instalador_no_depende_del_numero_de_version(tmp_path):
    escritorio = tmp_path / 'escritorio'
    (escritorio / 'src-tauri' / 'windows').mkdir(parents=True)
    conf = escritorio / 'src-tauri' / 'tauri.conf.json'
    conf.write_text(json.dumps({'version': '0.2.2', 'bundle': {'icon': ['a.ico']}}))
    (escritorio / 'src-tauri' / 'windows' / 'ganchos.nsh').write_text('uno')
    antes = paquetes.huella_del_instalador(escritorio)

    conf.write_text(json.dumps({'version': '0.2.3', 'bundle': {'icon': ['a.ico']}}))
    assert paquetes.huella_del_instalador(escritorio) == antes

    (escritorio / 'src-tauri' / 'windows' / 'ganchos.nsh').write_text('dos')
    assert paquetes.huella_del_instalador(escritorio) != antes


def test_la_huella_real_se_puede_calcular():
    assert len(paquetes.huella_del_instalador()) == 64


def test_la_poda_quita_los_paquetes_de_las_releases_anteriores_y_nada_mas():
    releases = [
        {'tag_name': 'v0.2.4', 'assets': [{'name': 'CajaDeHerramientas-cambios-desde-0.2.3.tar.gz'},
                                          {'name': 'latest.json'}]},
        {'tag_name': 'v0.2.3', 'assets': [{'name': 'CajaDeHerramientas-cambios-desde-0.2.2.tar.gz'},
                                          {'name': 'CajaDeHerramientas-cambios-desde-0.2.2.tar.gz.sig'},
                                          {'name': 'CajaDeHerramientas_0.2.3_x64-setup.exe'},
                                          {'name': 'archivos.json'}]},
        {'tag_name': 'v0.2.2', 'assets': [{'name': 'CajaDeHerramientas-setup.exe'}]},
    ]
    assert paquetes.a_podar(releases, 'v0.2.4') == [
        ('v0.2.3', 'CajaDeHerramientas-cambios-desde-0.2.2.tar.gz'),
        ('v0.2.3', 'CajaDeHerramientas-cambios-desde-0.2.2.tar.gz.sig'),
    ]


def test_paquetes_desde_las_ultimas_cinco_con_manifiesto():
    """Sin la actual, sin borradores ni previas, y sin las que no tienen manifiesto
    (las anteriores a esto, o una que se publicó a mano)."""
    con = [{'name': 'archivos.json'}]
    releases = ([{'tag_name': 'v0.3.0', 'assets': con},
                 {'tag_name': 'v0.2.9', 'assets': con, 'draft': True},
                 {'tag_name': 'v0.2.8', 'assets': con, 'prerelease': True},
                 {'tag_name': 'v0.2.7', 'assets': []}]
                + [{'tag_name': f'v0.2.{n}', 'assets': con} for n in range(6, 0, -1)])
    assert paquetes.anteriores(releases, 'v0.3.0') == ['v0.2.6', 'v0.2.5', 'v0.2.4', 'v0.2.3', 'v0.2.2']


def test_sin_versiones_anteriores_no_imprime_nada(monkeypatch, capsys):
    """La primera publicación con paquetes: ninguna anterior tiene manifiesto.
    Una línea en blanco hizo que la CI buscara el manifiesto de la versión «»."""
    import io
    releases = [{'tag_name': 'v0.2.4', 'assets': [{'name': 'CajaDeHerramientas-setup.exe'}]}]
    monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(releases)))
    assert paquetes._principal(['anteriores', '--actual', 'v0.2.5']) == 0
    assert capsys.readouterr().out == ''

    con = [{'tag_name': t, 'assets': [{'name': 'archivos.json'}]} for t in ('v0.2.6', 'v0.2.5')]
    monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(con)))
    paquetes._principal(['anteriores', '--actual', 'v0.2.7'])
    assert capsys.readouterr().out == 'v0.2.6\nv0.2.5\n'


def test_los_origenes_son_los_recursos_de_tauri_conf():
    """Si tauri.conf.json cambia dónde pone las cosas, el manifiesto tiene que cambiar con él."""
    conf = json.loads((RAIZ / 'escritorio' / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))
    recursos = {destino.strip('/'): origen for origen, destino in conf['bundle']['resources'].items()}
    origenes = paquetes.origenes()
    for destino in ('backend', 'vendor'):
        assert destino in recursos
        assert origenes[destino] == (RAIZ / 'escritorio' / 'src-tauri' / recursos[destino]).resolve()
