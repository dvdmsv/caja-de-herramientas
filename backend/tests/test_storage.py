"""Cuota por sesión, reserva de disco y aislamiento entre sesiones."""
import os
import time

import pytest

from tests.conftest import SESION, subida


def test_cuota_de_sesion(almacen):
    """Al pasarse de cuota se rechaza la subida y no queda a medias en el disco."""
    from errors import ApiError

    s = almacen(SESSION_QUOTA_MB=1)
    s.save_upload(SESION, subida(b'x' * 700_000, 'uno.pdf'))

    with pytest.raises(ApiError) as fallo:
        s.save_upload(SESION, subida(b'x' * 700_000, 'dos.pdf'))

    assert fallo.value.status == 413
    assert '1 MB' in fallo.value.message
    # El archivo rechazado no se queda ocupando sitio.
    assert s.tamano_sesion(SESION) < 1024 * 1024


def test_la_cuota_es_por_sesion(almacen):
    """Lo que ocupa uno no le quita sitio a otro."""
    s = almacen(SESSION_QUOTA_MB=1)
    s.save_upload(SESION, subida(b'x' * 700_000, 'uno.pdf'))
    otra = 'b' * 32
    registro = s.save_upload(otra, subida(b'x' * 700_000, 'uno.pdf'))
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
    s.save_upload(vieja, subida(b'x' * 100_000, 'vieja.pdf'))
    os.utime(s.session_dir(vieja, create=False), (time.time() - 3600,) * 2)

    activa = 'd' * 32
    s.save_upload(activa, subida(b'x' * 100_000, 'activa.pdf'))

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
    registro = s.save_upload(SESION, subida(b'%PDF-1.4', '../../fuera.pdf'))
    assert '/' not in registro.stored_name
    assert os.path.dirname(os.path.realpath(
        os.path.join(s.session_dir(SESION, create=False), registro.stored_name))) \
        == os.path.realpath(s.session_dir(SESION, create=False))
