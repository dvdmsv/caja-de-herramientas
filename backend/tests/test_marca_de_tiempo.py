"""Fecha visible y sellos RFC 3161, con una TSA local sin conexión."""
import io
from datetime import datetime, timezone
from pathlib import Path

import fitz
import pytest

from tests.conftest import SESION, subida

CABECERAS = {'X-Session-Id': SESION}
FECHA = '2026-10-08T16:30:45+02:00'


@pytest.fixture
def cliente(entorno):
    entorno()
    from app import create_app
    return create_app('pesados').test_client()


def pdf(giro=0, pequeno=False):
    with fitz.open() as documento:
        for _ in range(2):
            pagina = documento.new_page(width=160 if pequeno else 595, height=842)
            pagina.insert_text((25, 50), 'Contenido original')
            pagina.set_rotation(giro)
        return documento.tobytes()


def subir(datos, nombre='documento.pdf'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def ejecutar(cliente, id, **opciones):
    return cliente.post('/api/tools/marca-de-tiempo', headers=CABECERAS,
                        json={'file_ids': [id], **opciones})


def resultado(respuesta):
    from storage import storage
    return Path(storage.path_of(SESION, respuesta.get_json()['files'][0]['id']))


@pytest.fixture
def claves():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    from asn1crypto import keys, x509 as asn1_x509

    clave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Autoridad de prueba')])
    certificado = (x509.CertificateBuilder().subject_name(nombre).issuer_name(nombre)
                   .public_key(clave.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(datetime(2020, 1, 1, tzinfo=timezone.utc))
                   .not_valid_after(datetime(2030, 1, 1, tzinfo=timezone.utc))
                   .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.TIME_STAMPING]), critical=True)
                   .sign(clave, hashes.SHA256()))
    return (asn1_x509.Certificate.load(certificado.public_bytes(serialization.Encoding.DER)),
            keys.PrivateKeyInfo.load(clave.private_bytes(serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption())))


@pytest.fixture
def tsa(claves, monkeypatch):
    from pyhanko.sign.timestamps import DummyTimeStamper
    from api import firma_digital

    sellador = DummyTimeStamper(*claves, fixed_dt=datetime.fromisoformat(FECHA))
    monkeypatch.setattr(firma_digital, 'sellador', lambda datos: sellador)
    return sellador


def firmado(datos, claves, certificado=False, bloquear=False):
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import signers, fields
    from pyhanko_certvalidator.registry import SimpleCertificateStore

    firmante = signers.SimpleSigner(signing_cert=claves[0], signing_key=claves[1],
                                    cert_registry=SimpleCertificateStore())
    spec = fields.SigFieldSpec('FirmaOriginal', field_mdp_spec=(
        fields.FieldMDPSpec(action=fields.FieldMDPAction.ALL) if bloquear else None))
    metadatos = signers.PdfSignatureMetadata(field_name='FirmaOriginal', certify=certificado,
                                            docmdp_permissions=fields.MDPPerm.FILL_FORMS)
    return signers.sign_pdf(IncrementalPdfFileWriter(io.BytesIO(datos)), metadatos,
                            signer=firmante, new_field_spec=spec).getvalue()


@pytest.mark.parametrize('giro', [0, 90, 180, 270])
def test_fecha_visible_en_todas_las_paginas_y_giros(cliente, giro):
    respuesta = ejecutar(cliente, subir(pdf(giro)), modo='visible', fecha=FECHA)
    assert respuesta.status_code == 201
    with fitz.open(resultado(respuesta)) as documento:
        assert documento.page_count == 2
        for pagina in documento:
            assert 'Contenido original' in pagina.get_text()
            assert '08/10/2026 16:30:45 UTC+02:00' in pagina.get_text()
            assert pagina.rotation == giro


def test_vista_previa_coincide_con_resultado(cliente):
    id = subir(pdf(90))
    opciones = {'file_ids': [id], 'modo': 'visible', 'fecha': FECHA,
                'pagina': 2, 'borde': 'arriba', 'alineacion': 'izquierda'}
    vista = cliente.post('/api/tools/marca-de-tiempo/previsualizar', headers=CABECERAS, json=opciones)
    assert vista.status_code == 200
    respuesta = ejecutar(cliente, id, modo='visible', fecha=FECHA,
                         borde='arriba', alineacion='izquierda')
    from api import vista_previa
    with fitz.open(resultado(respuesta)) as documento:
        assert vista.data == vista_previa.pagina_a_jpeg(documento, 2)


@pytest.mark.parametrize('fecha', ['', '2026-10-08T16:30:45', '2026-02-30T10:00:00Z',
                                  None, 42, '2026-10-08T10:00:00+15:00'])
def test_rechaza_fecha_sin_zona_o_invalida(cliente, fecha):
    assert ejecutar(cliente, subir(pdf()), modo='visible', fecha=fecha).status_code == 400


def test_fecha_utc_y_negativa(cliente):
    for fecha, texto in [('2026-10-08T10:00:00Z', 'UTC+00:00'),
                          ('2026-10-08T10:00:00-03:30', 'UTC-03:30')]:
        respuesta = ejecutar(cliente, subir(pdf()), modo='visible', fecha=fecha)
        with fitz.open(resultado(respuesta)) as documento:
            assert texto in documento[0].get_text()


def test_no_recorta_fecha_en_pagina_pequena(cliente):
    assert ejecutar(cliente, subir(pdf(pequeno=True)), modo='visible', fecha=FECHA).status_code == 400


def test_rechaza_pdf_protegido(cliente):
    with fitz.open(stream=pdf(), filetype='pdf') as documento:
        protegido = documento.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='clave', user_pw='clave')
    assert ejecutar(cliente, subir(protegido), modo='visible', fecha=FECHA).status_code == 422


def test_rechaza_archivo_que_no_es_pdf_y_varios(cliente):
    assert ejecutar(cliente, subir(b'hola', 'texto.txt')).status_code == 400
    respuesta = cliente.post('/api/tools/marca-de-tiempo', headers=CABECERAS,
                             json={'file_ids': [subir(pdf()), subir(pdf())]})
    assert respuesta.status_code == 400


def test_sello_sha256_incremental_se_comprueba_y_no_cambia_paginas(cliente, tsa):
    from pyhanko.pdf_utils.reader import PdfFileReader

    original = pdf()
    respuesta = ejecutar(cliente, subir(original))
    assert respuesta.status_code == 201, respuesta.get_json()
    salida = resultado(respuesta).read_bytes()
    assert salida.startswith(original)
    with fitz.open(stream=salida, filetype='pdf') as documento:
        assert documento[0].get_text().strip() == 'Contenido original'
    with io.BytesIO(salida) as archivo:
        sello = PdfFileReader(archivo).embedded_signatures[0]
        assert sello.sig_object['/Type'] == '/DocTimeStamp'
        assert sello.md_algorithm == 'sha256'
    informe = cliente.post('/api/tools/comprobar-firmas/inspeccionar', headers=CABECERAS,
                           json={'file_ids': [respuesta.get_json()['files'][0]['id']]}).get_json()
    sello = informe['informes'][0]['firmas'][0]
    assert sello['tipo'] == 'sello_tiempo'
    assert sello['firmante'] == 'Autoridad de prueba'
    assert sello['intacta'] is True and sello['cobertura'] == 'todo'
    assert sello['fecha'] == sello['sello_tiempo']
    assert sello['vigente_al_firmar'] is True and sello['error'] is None


@pytest.mark.parametrize('certificado', [False, True])
def test_sello_conserva_firma_anterior(cliente, tsa, claves, certificado):
    datos = firmado(pdf(), claves, certificado=certificado)
    respuesta = ejecutar(cliente, subir(datos))
    assert respuesta.status_code == 201, respuesta.get_json()
    assert resultado(respuesta).read_bytes().startswith(datos)
    informe = cliente.post('/api/tools/comprobar-firmas/inspeccionar', headers=CABECERAS,
                           json={'file_ids': [respuesta.get_json()['files'][0]['id']]}).get_json()
    firmas = informe['informes'][0]['firmas']
    assert [f['tipo'] for f in firmas] == ['firma', 'sello_tiempo']
    assert firmas[0]['intacta'] is True
    assert firmas[0]['cambios'] == 'datos de validación'


@pytest.mark.parametrize('con_sello', [False, True])
def test_fecha_visible_bloquea_firmas_y_sellos(cliente, tsa, claves, con_sello):
    if con_sello:
        id = ejecutar(cliente, subir(pdf())).get_json()['files'][0]['id']
    else:
        id = subir(firmado(pdf(), claves))
    assert ejecutar(cliente, id, modo='visible', fecha=FECHA).status_code == 422
    vista = cliente.post('/api/tools/marca-de-tiempo/previsualizar', headers=CABECERAS,
                         json={'file_ids': [id], 'modo': 'visible', 'fecha': FECHA})
    assert vista.status_code == 422


def test_sello_conserva_campos_bloqueados(cliente, tsa, claves):
    # FieldMDP bloquea cambios a campos existentes; un DocTimeStamp nuevo es
    # una actualización de validación que no cambia esos campos.
    respuesta = ejecutar(cliente, subir(firmado(pdf(), claves, bloquear=True)))
    assert respuesta.status_code == 201, respuesta.get_json()


def test_rechaza_documento_que_incumple_sus_restricciones(cliente, tsa, claves):
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils import generic

    datos = firmado(pdf(), claves, certificado=True, bloquear=True)
    escritor = IncrementalPdfFileWriter(io.BytesIO(datos))
    pagina_ref, _ = escritor.find_page_for_modification(0)
    pagina = pagina_ref.get_object()
    contenido = escritor.add_object(generic.StreamObject(
        stream_data=b'BT /helv 12 Tf 50 200 Td (Contenido alterado) Tj ET'))
    anteriores = pagina['/Contents']
    anteriores = list(anteriores) if isinstance(anteriores, generic.ArrayObject) else [pagina.raw_get('/Contents')]
    pagina[generic.pdf_name('/Contents')] = generic.ArrayObject([*anteriores, contenido])
    escritor.mark_update(pagina_ref)
    salida = io.BytesIO()
    escritor.write(salida)
    respuesta = ejecutar(cliente, subir(salida.getvalue()))
    assert respuesta.status_code == 422, respuesta.get_json()


@pytest.mark.parametrize('error', ['sin conexión', 'timeout', 'rechazo TSA'])
def test_fallo_tsa_no_deja_pdf_parcial(cliente, monkeypatch, tsa, error):
    from pyhanko.sign.timestamps import TimestampRequestError
    from storage import storage

    async def fallar(*args, **kwargs):
        raise TimestampRequestError(error)
    monkeypatch.setattr(tsa, 'async_timestamp', fallar)
    id = subir(pdf())
    respuesta = ejecutar(cliente, id)
    assert respuesta.status_code == 504
    archivos = list(Path(storage.session_dir(SESION)).glob('*.pdf'))
    assert len(archivos) == 1


def test_cancelacion_no_entrega_sello(cliente, tsa, monkeypatch):
    from api import progreso
    from storage import storage

    original = tsa.async_timestamp
    async def cancelar(*args, **kwargs):
        respuesta = await original(*args, **kwargs)
        monkeypatch.setattr(progreso, 'cancelado', lambda: True)
        return respuesta
    monkeypatch.setattr(tsa, 'async_timestamp', cancelar)
    assert ejecutar(cliente, subir(pdf())).status_code == 409
    assert len(list(Path(storage.session_dir(SESION)).glob('*.pdf'))) == 1


def test_transporte_rfc3161_usa_configuracion_y_solo_resumen(cliente, claves, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from asn1crypto import tsp
    from pyhanko.sign.timestamps import DummyTimeStamper
    from pyhanko.sign.timestamps import requests_client
    import config

    reloj = DummyTimeStamper(*claves, fixed_dt=datetime.fromisoformat(FECHA))
    peticiones = []
    monkeypatch.setattr(config, 'TSA_URL', 'https://autoridad.example/tsr')
    monkeypatch.setattr(config, 'TSA_TIMEOUT', 7)

    def responder(url, cuerpo, **opciones):
        peticion = tsp.TimeStampReq.load(cuerpo)
        peticiones.append((url, peticion, opciones))
        respuesta = asyncio.run(reloj.async_request_tsa_response(peticion))
        return SimpleNamespace(headers={'Content-Type': 'application/timestamp-reply'},
                               content=respuesta.dump())
    monkeypatch.setattr(requests_client.requests, 'post', responder)
    respuesta = ejecutar(cliente, subir(pdf()))
    assert respuesta.status_code == 201, respuesta.get_json()
    assert len(peticiones) == 2  # estimación de tamaño y sello del documento
    for url, peticion, opciones in peticiones:
        assert url == config.TSA_URL
        assert opciones['timeout'] == 7
        assert opciones['headers']['Content-Type'] == 'application/timestamp-query'
        huella = peticion['message_imprint']
        assert huella['hash_algorithm']['algorithm'].native == 'sha256'
        assert len(huella['hashed_message'].native) == 32


@pytest.mark.parametrize('fallo', ['timeout', 'conexion', 'respuesta-malformada', 'rechazo'])
def test_errores_del_cliente_http_se_explican(cliente, monkeypatch, fallo):
    from types import SimpleNamespace
    from asn1crypto import tsp, cms
    from pyhanko.sign.timestamps import requests_client
    from storage import storage
    import requests

    def fallar(*args, **kwargs):
        if fallo == 'timeout':
            raise requests.Timeout('Tiempo agotado')
        if fallo == 'conexion':
            raise requests.ConnectionError('Sin conexión')
        contenido = b'no es ASN.1' if fallo == 'respuesta-malformada' else tsp.TimeStampResp(
            {'status': {'status': 'rejection'},
             'time_stamp_token': cms.ContentInfo({'content_type': 'data', 'content': b''})}).dump()
        return SimpleNamespace(headers={'Content-Type': 'application/timestamp-reply'}, content=contenido)
    monkeypatch.setattr(requests_client.requests, 'post', fallar)
    respuesta = ejecutar(cliente, subir(pdf()))
    assert respuesta.status_code == (502 if fallo == 'respuesta-malformada' else 504), respuesta.get_json()
    assert 'sellado' in respuesta.get_json()['error'] or 'sello' in respuesta.get_json()['error']
    assert len(list(Path(storage.session_dir(SESION)).glob('*.pdf'))) == 1


def test_sello_detecta_alteracion_del_documento(cliente, tsa):
    respuesta = ejecutar(cliente, subir(pdf()))
    datos = resultado(respuesta).read_bytes()
    assert b'595 842' in datos
    id = subir(datos.replace(b'595 842', b'596 842', 1))
    informe = cliente.post('/api/tools/comprobar-firmas/inspeccionar', headers=CABECERAS,
                           json={'file_ids': [id]}).get_json()['informes'][0]['firmas'][0]
    assert informe['tipo'] == 'sello_tiempo'
    assert informe['intacta'] is False


def test_backend_de_escritorio_comparte_las_herramientas(entorno, tmp_path, tsa):
    from app import create_app
    from tests.test_tablas import factura

    pagina = tmp_path / 'frontend'
    pagina.mkdir()
    (pagina / 'index.html').write_text('<app-root></app-root>')
    entorno(ESCRITORIO_TOKEN='ci', ESCRITORIO_FRONTEND=str(pagina))
    cliente = create_app().test_client()
    id = subir(pdf())
    assert ejecutar(cliente, id).status_code == 403
    cliente.set_cookie('escritorio', 'ci')
    assert ejecutar(cliente, id).status_code == 201
    assert ejecutar(cliente, id, modo='visible', fecha=FECHA).status_code == 201
    for formato in ['json', 'markdown']:
        respuesta = cliente.post('/api/tools/extraer-tablas', headers=CABECERAS,
                                 json={'file_ids': [subir(factura())], 'formato': formato})
        assert respuesta.status_code == 201
    assert b'app-root' in cliente.get('/herramientas/marca-de-tiempo').data


def test_rechaza_sello_para_otra_huella(cliente, tsa, monkeypatch):
    original = tsa.async_timestamp
    async def otra_huella(message_digest, md_algorithm):
        return await original(b'x' * 32, md_algorithm)
    monkeypatch.setattr(tsa, 'async_timestamp', otra_huella)
    respuesta = ejecutar(cliente, subir(pdf()))
    assert respuesta.status_code == 422, respuesta.get_json()


def test_admite_sellado_sucesivo(cliente, tsa):
    primero = ejecutar(cliente, subir(pdf())).get_json()['files'][0]['id']
    segundo = ejecutar(cliente, primero)
    assert segundo.status_code == 201, segundo.get_json()
    informe = cliente.post('/api/tools/comprobar-firmas/inspeccionar', headers=CABECERAS,
                           json={'file_ids': [segundo.get_json()['files'][0]['id']]}).get_json()
    sellos = informe['informes'][0]['firmas']
    assert len(sellos) == 2
    assert all(s['tipo'] == 'sello_tiempo' and s['intacta'] for s in sellos)
    assert [s['cobertura'] for s in sellos] == ['revision', 'todo']


def test_rechaza_pdf_vacio_o_danado(cliente):
    from pyhanko.pdf_utils.writer import PdfFileWriter
    from storage import storage

    vacio = io.BytesIO()
    PdfFileWriter().write(vacio)
    assert ejecutar(cliente, subir(vacio.getvalue())).status_code == 422
    id = subir(pdf())
    Path(storage.path_of(SESION, id)).write_bytes(b'%PDF-1.7\narchivo truncado')
    assert ejecutar(cliente, id).status_code == 422
