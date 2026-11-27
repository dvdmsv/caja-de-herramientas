"""Cuota por sesión, reserva de disco y aislamiento entre sesiones."""
import os
import time

import pytest

from tests.conftest import SESION, subida


def test_cuota_de_sesion(almacen):
    """Al pasarse de cuota se rechaza la subida y no queda a medias en el disco."""
    from errors import ApiError

    s = almacen(SESSION_QUOTA_MB=1)
    s.save_upload(SESION, subida(b'x' * 700_000, 'uno.txt'))

    with pytest.raises(ApiError) as fallo:
        s.save_upload(SESION, subida(b'x' * 700_000, 'dos.txt'))

    assert fallo.value.status == 413
    assert '1 MB' in fallo.value.message
    # El archivo rechazado no se queda ocupando sitio.
    assert s.tamano_sesion(SESION) < 1024 * 1024


def test_la_cuota_es_por_sesion(almacen):
    """Lo que ocupa uno no le quita sitio a otro."""
    s = almacen(SESSION_QUOTA_MB=1)
    s.save_upload(SESION, subida(b'x' * 700_000, 'uno.txt'))
    otra = 'b' * 32
    registro = s.save_upload(otra, subida(b'x' * 700_000, 'uno.txt'))
    assert registro.size == 700_000


def test_resultado_que_no_cabe_no_se_entrega(almacen):
    """Un resultado que pasa la cuota se borra y se avisa."""
    from errors import ApiError

    s = almacen(SESSION_QUOTA_MB=1)
    destino, registro = s.reserve_output(SESION, 'salida.pdf')
    with open(destino, 'wb') as fh:
        fh.write(b'x' * 1_200_000)

    with pytest.raises(ApiError) as fallo:
        s.commit_output(SESION, registro)

    assert fallo.value.status == 413
    assert not os.path.exists(destino)


def test_reserva_global_desaloja_las_sesiones_viejas(almacen, monkeypatch):
    """Sin sitio, se borran las viejas; la activa se queda."""
    s = almacen(SESSION_QUOTA_MB=100, DISK_RESERVE_MB=1, SESSION_PROTECTED_MINUTES=10)

    vieja = 'c' * 32
    s.save_upload(vieja, subida(b'x' * 100_000, 'vieja.txt'))
    os.utime(s.session_dir(vieja, create=False), (time.time() - 3600,) * 2)

    activa = 'd' * 32
    s.save_upload(activa, subida(b'x' * 100_000, 'activa.txt'))

    # El disco parece lleno hasta que se libere algo.
    monkeypatch.setattr(type(s), 'espacio_libre', lambda self: 0)
    liberados = s.liberar_espacio(1)

    assert liberados > 0
    assert not os.path.isdir(s.session_dir(vieja, create=False))
    assert os.path.isdir(s.session_dir(activa, create=False))


def test_sin_sitio_y_sin_nada_que_desalojar_da_507(almacen, monkeypatch):
    from errors import ApiError

    s = almacen(DISK_RESERVE_MB=1)
    monkeypatch.setattr(type(s), 'espacio_libre', lambda self: 0)

    with pytest.raises(ApiError) as fallo:
        s.reserve_output(SESION, 'salida.pdf')

    assert fallo.value.status == 507


@pytest.mark.parametrize('malo', ['', 'corto', '../otra', 'a' * 31, 'A' * 32, None])
def test_identificador_de_sesion_invalido(almacen, malo):
    """El identificador lo manda el cliente: no puede servir para salir de su carpeta."""
    from errors import ApiError

    s = almacen()
    with pytest.raises(ApiError) as fallo:
        s.session_dir(malo)
    assert fallo.value.status == 400


def test_no_se_puede_salir_de_la_sesion_con_el_id_de_archivo(almacen):
    from errors import ApiError

    s = almacen()
    with pytest.raises(ApiError) as fallo:
        s.path_of(SESION, '../../etc/passwd')
    assert fallo.value.status == 400


def test_el_nombre_del_archivo_no_decide_donde_se_escribe(almacen):
    """El binario se guarda como `<id><ext>`, así que el nombre no puede escapar."""
    s = almacen()
    registro = s.save_upload(SESION, subida(b'%PDF-1.4\n', '../../fuera.pdf'))
    assert '/' not in registro.stored_name
    assert os.path.dirname(os.path.realpath(
        os.path.join(s.session_dir(SESION, create=False), registro.stored_name))) \
        == os.path.realpath(s.session_dir(SESION, create=False))


@pytest.mark.parametrize('por_espacio', [False, True])
def test_recolectores_solo_borran_sesiones(almacen, por_espacio):
    from pathlib import Path

    s = almacen()
    ajena = Path(s.root, 'fotos')
    ajena.mkdir()
    original = ajena / 'original'
    original.write_bytes(b'original')
    sesion = Path(s.session_dir(SESION))
    (sesion / 'archivo').write_bytes(b'antiguo')
    enlace = Path(s.root, 'b' * 32)
    try:
        enlace.symlink_to(ajena, target_is_directory=True)
    except OSError:
        # Algunos equipos Windows no conceden permiso para crear enlaces.
        enlace = None
    for carpeta in (ajena, sesion):
        os.utime(carpeta, (0, 0))
    if por_espacio:
        assert s.liberar_espacio(float('inf')) == len(b'antiguo')
    else:
        assert s.purge_expired() == 1
    assert not sesion.exists()
    assert original.read_bytes() == b'original'
    assert enlace is None or enlace.is_symlink()


@pytest.mark.parametrize('operacion', ['subir', 'resultado'])
def test_se_conserva_la_sesion_que_pide_espacio(almacen, monkeypatch, operacion):
    from errors import ApiError

    s = almacen()
    registro = s.save_upload(SESION, subida(b'original'))
    os.utime(s.session_dir(SESION), (0, 0))
    monkeypatch.setattr(s, 'espacio_libre', lambda: 0)
    with pytest.raises(ApiError) as error:
        if operacion == 'subir':
            s.save_upload(SESION, subida(b'nuevo'))
        else:
            s.reserve_output(SESION, 'salida.pdf')
    assert error.value.status == 507
    assert s.path_of(SESION, registro.id)


@pytest.mark.parametrize('sesion_entera', [False, True])
def test_api_reintenta_borrado_con_archivo_ocupado(entorno, monkeypatch, sesion_entera):
    from pathlib import Path
    _, modulo = entorno()
    import app

    cliente = app.create_app('web').test_client()
    s = modulo.storage
    primero = s.save_upload(SESION, subida(b'uno'))
    segundo = s.save_upload(SESION, subida(b'dos'))
    libre = Path(s.path_of(SESION, primero.id))
    ocupado = Path(s.path_of(SESION, segundo.id))
    cabeceras = {'X-Session-Id': SESION}
    ruta = '/api/session' if sesion_entera else f'/api/files/{segundo.id}'
    unlink = os.unlink

    def borrar(path, *args, **kwargs):
        if Path(path) == ocupado:
            raise PermissionError('ocupado')
        return unlink(path, *args, **kwargs)

    with monkeypatch.context() as parche:
        parche.setattr(os, 'unlink', borrar)
        if sesion_entera:
            # Fuerza que la sesión pierda el primer binario antes del fallo.
            entradas = list(ocupado.parent.iterdir())
            parche.setattr(Path, 'iterdir', lambda carpeta: iter(
                sorted(entradas, key=lambda entrada: entrada != libre)))
        assert cliente.delete(ruta, headers=cabeceras).status_code == 500
    assert s.record_of(SESION, segundo.id).size == 3
    if sesion_entera:
        assert not libre.exists()
    assert cliente.delete(ruta, headers=cabeceras).status_code == 204
    assert not ocupado.exists()
    if sesion_entera:
        assert s.tamano_sesion(SESION) == 0
        assert not ocupado.parent.exists()
    else:
        assert s.path_of(SESION, primero.id)


def test_se_reintenta_borrado_si_falla_el_sidecar(almacen, monkeypatch):
    from pathlib import Path
    s = almacen()
    record = s.save_upload(SESION, subida(b'contenido'))
    sidecar = Path(s.root, SESION, record.id + '.json')
    unlink = os.unlink

    def borrar(path):
        if Path(path) == sidecar:
            raise PermissionError
        unlink(path)

    with monkeypatch.context() as parche:
        parche.setattr(os, 'unlink', borrar)
        with pytest.raises(PermissionError):
            s.delete_file(SESION, record.id)
    assert sidecar.exists()
    s.delete_file(SESION, record.id)
    assert s.tamano_sesion(SESION) == 0


@pytest.mark.parametrize('fallar', [False, True])
def test_publicacion_de_metadatos_atomica(almacen, monkeypatch, fallar):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path
    from threading import Event

    s = almacen()
    registro = s.save_upload(SESION, subida(b'original', 'antes.txt'))
    escribiendo, continuar = Event(), Event()
    def escribir(datos, fichero):
        texto = json.dumps(datos)
        fichero.write(texto[:10])
        fichero.flush()
        escribiendo.set()
        assert continuar.wait(5)
        if fallar:
            raise OSError('fallo de escritura')
        fichero.write(texto[10:])

    monkeypatch.setattr(json, 'dump', escribir)
    with ThreadPoolExecutor(max_workers=1) as executor:
        cambio = executor.submit(s.rename, SESION, registro.id, 'despues.txt')
        try:
            assert escribiendo.wait(5)
            assert s.record_of(SESION, registro.id).name == 'antes.txt'
        finally:
            continuar.set()
        if fallar:
            with pytest.raises(OSError):
                cambio.result()
        else:
            cambio.result()
    assert s.record_of(SESION, registro.id).name == ('antes.txt' if fallar else 'despues.txt')
    assert Path(s.path_of(SESION, registro.id)).read_bytes() == b'original'
    assert not list(Path(s.root, SESION).glob('*.tmp'))
