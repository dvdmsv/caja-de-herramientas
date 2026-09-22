"""Que la extensión y el contenido se correspondan, y que el aviso llegue pronto."""
import io
import zipfile

import pytest

from tests.conftest import SESION, subida

PDF = b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'
JPEG = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00'
PNG = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'


def heif(marca=b'heic'):
    """Cabecera de un archivo de la familia HEIF con la marca principal dada."""
    return b'\x00\x00\x00\x1cftyp' + marca + b'\x00\x00\x00\x00mif1' + marca


def paquete(*rutas):
    datos = io.BytesIO()
    with zipfile.ZipFile(datos, 'w') as z:
        for ruta in rutas:
            z.writestr(ruta, '<x/>')
    return datos.getvalue()


@pytest.mark.parametrize('datos, nombre', [
    (PDF, 'informe.pdf'),
    (JPEG, 'foto.jpg'),
    (PNG, 'captura.png'),
    (paquete('word/document.xml'), 'carta.docx'),
    (paquete('xl/workbook.xml'), 'cuentas.xlsx'),
    (paquete('ppt/presentation.xml'), 'charla.pptx'),
    (paquete('META-INF/container.xml'), 'libro.epub'),
    (b'{\\rtf1\\ansi', 'nota.rtf'),
])
def test_lo_que_es_lo_que_dice_ser_pasa(almacen, datos, nombre):
    assert almacen().save_upload(SESION, subida(datos, nombre)).name == nombre


@pytest.mark.parametrize('datos, nombre, parece', [
    (JPEG, 'mentira.pdf', 'una imagen JPEG'),
    (b'<!DOCTYPE html><html>error 404</html>', 'descarga.pdf', 'texto'),
    (PDF, 'informe.docx', 'un PDF'),
    (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1', 'antiguo.pdf', 'un documento antiguo de Office'),
    (PNG, 'foto.jpg', 'una imagen PNG'),
])
def test_lo_que_no_lo_es_se_rechaza_diciendo_que_parece(almacen, datos, nombre, parece):
    """El mensaje tiene que decir qué parece: si no, no se sabe qué hacer."""
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        almacen().save_upload(SESION, subida(datos, nombre))

    assert fallo.value.status == 400
    assert parece in fallo.value.message
    assert nombre in fallo.value.message


def test_un_docx_que_por_dentro_es_una_hoja_de_calculo(almacen):
    """Los dos son ZIP, así que la firma no basta: hay que mirar qué llevan."""
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        almacen().save_upload(SESION, subida(paquete('xl/workbook.xml'), 'carta.docx'))

    assert 'hoja de cálculo' in fallo.value.message


@pytest.mark.parametrize('marca', [b'heic', b'heix', b'hevc', b'hevx', b'heim',
                                  b'heis', b'hevm', b'hevs', b'mif1', b'msf1', b'avic'])
def test_el_heic_vale_con_cualquiera_de_sus_marcas(almacen, marca):
    """La marca principal la elige el codificador, no hay una sola.

    Quedarse con `heic` rechazaba al subirlo un archivo perfectamente válido.
    """
    assert almacen().save_upload(SESION, subida(heif(marca), 'foto.heic')).name == 'foto.heic'


def test_un_heic_que_es_un_jpeg_se_sigue_rechazando(almacen):
    """Ampliar las marcas no puede convertir la comprobación en un colador."""
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        almacen().save_upload(SESION, subida(JPEG, 'foto.heic'))
    assert 'una imagen JPEG' in fallo.value.message


def test_el_heic_entra_por_la_puerta(entorno):
    """La extensión se admite de verdad, no sólo se reconoce su firma.

    `ALLOWED_EXTS` sale de lo que Pillow sepa abrir, así que esto es lo que
    comprueba que `pillow-heif` está instalado y registrado.
    """
    entorno()
    from api import files

    assert {'.heic', '.heif'} <= files.ALLOWED_EXTS


def test_el_archivo_rechazado_no_se_queda_en_el_disco(almacen):
    """Rechazar y dejar el archivo sería cobrar cuota por algo que no vale."""
    from errors import ApiError

    s = almacen()
    with pytest.raises(ApiError):
        s.save_upload(SESION, subida(JPEG, 'mentira.pdf'))
    assert s.tamano_sesion(SESION) == 0


@pytest.mark.parametrize('nombre', ['notas.txt', 'datos.csv', 'notas.md', 'datos.json'])
def test_lo_que_no_tiene_firma_no_se_rechaza(almacen, nombre):
    """El texto plano no tiene nada que mirar: rechazarlo por no reconocerlo
    sería peor que no mirar."""
    assert almacen().save_upload(SESION, subida(b'una linea de texto\n', nombre)).name == nombre


def test_un_zip_dañado_lo_dice(almacen):
    from errors import ApiError

    with pytest.raises(ApiError) as fallo:
        almacen().save_upload(SESION, subida(b'PK\x03\x04' + b'basura', 'roto.docx'))
    assert fallo.value.status == 400
    assert 'dañado' in fallo.value.message


def test_un_archivo_malo_no_se_lleva_por_delante_a_los_buenos(entorno):
    """Antes, el quinto de diez mintiendo perdía la subida entera."""
    entorno()
    import app as modulo

    cliente = modulo.create_app('web').test_client()
    datos = {'files': [
        (io.BytesIO(PDF), 'bueno.pdf'),
        (io.BytesIO(JPEG), 'mentira.pdf'),
        (io.BytesIO(b'texto\n'), 'notas.txt'),
    ]}
    respuesta = cliente.post('/api/files', headers={'X-Session-Id': SESION},
                             data=datos, content_type='multipart/form-data')

    assert respuesta.status_code == 201
    cuerpo = respuesta.get_json()
    assert [f['name'] for f in cuerpo['files']] == ['bueno.pdf', 'notas.txt']
    assert len(cuerpo['rechazados']) == 1
    assert cuerpo['rechazados'][0]['indice'] == 1
    assert 'JPEG' in cuerpo['rechazados'][0]['error']


def test_si_no_se_salva_ninguno_es_un_error_de_la_peticion(entorno):
    entorno()
    import app as modulo

    cliente = modulo.create_app('web').test_client()
    respuesta = cliente.post('/api/files', headers={'X-Session-Id': SESION},
                             data={'files': [(io.BytesIO(JPEG), 'mentira.pdf')]},
                             content_type='multipart/form-data')

    assert respuesta.status_code == 400
    assert 'JPEG' in respuesta.get_json()['error']
