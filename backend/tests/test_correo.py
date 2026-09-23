"""Correos `.eml`: que salga el correo que se ve en el buzón, no el MIME en crudo.

Lo que se comprueba es lo que markitdown hacía mal —asunto codificado, cuerpo en
quoted-printable, adjuntos en base64— y lo que un correo real trae a menudo:
HTML con su versión en texto, juegos de caracteres antiguos, adjuntos sin nombre
o con el mismo nombre, y correos reenviados como adjunto.

"Correo a PDF" no se prueba aquí porque maqueta con WeasyPrint (ver
`conftest.py`); su lectura es esta misma.
"""
from email.message import EmailMessage

import pytest

from tests.conftest import SESION


@pytest.fixture
def cliente(entorno):
    entorno()
    import app as modulo
    return modulo.create_app('pesados').test_client()


def correo_completo() -> EmailMessage:
    mensaje = EmailMessage()
    mensaje['From'] = 'Ana Pérez <ana@ejemplo.es>'
    mensaje['To'] = 'luis@ejemplo.es'
    mensaje['Cc'] = 'equipo@ejemplo.es'
    mensaje['Subject'] = 'Presupuesto del año 2026'
    mensaje['Date'] = 'Wed, 23 Sep 2026 10:00:00 +0200'
    mensaje.set_content('Hola,\nadjunto el presupuesto.\n')
    mensaje.add_alternative(
        '<p>Hola,</p><p>adjunto el <b>presupuesto</b>.</p>'
        '<table><tr><th>Concepto</th><th>Importe</th></tr>'
        '<tr><td>Total</td><td>100 €</td></tr></table>', subtype='html')
    mensaje.add_attachment(b'%PDF-1.4 falso', maintype='application', subtype='pdf',
                           filename='presupuesto.pdf')
    return mensaje


def guardar(tmp_path, mensaje, nombre='correo.eml') -> str:
    ruta = tmp_path / nombre
    ruta.write_bytes(bytes(mensaje))
    return str(ruta)


def test_decodifica_cabeceras_y_prefiere_el_html(entorno, tmp_path):
    entorno()
    from api import correo

    leido = correo.leer(guardar(tmp_path, correo_completo()), 'correo.eml')

    assert leido.asunto == 'Presupuesto del año 2026'
    assert leido.de == 'Ana Pérez <ana@ejemplo.es>'
    assert leido.fecha == '23/09/2026 10:00 (+0200)'
    # El HTML gana al texto: la negrita y la tabla sólo están ahí.
    assert '**presupuesto**' in leido.cuerpo
    assert '| Total | 100 € |' in leido.cuerpo
    assert [a.nombre for a in leido.adjuntos] == ['presupuesto.pdf']
    assert leido.adjuntos[0].datos == b'%PDF-1.4 falso'


def test_el_markdown_lleva_cabeceras_cuerpo_y_adjuntos(entorno, tmp_path):
    entorno()
    from api import correo

    texto = correo.a_markdown(correo.leer(guardar(tmp_path, correo_completo()), 'c.eml'))

    assert texto.startswith('# Presupuesto del año 2026')
    # Los ángulos van escapados: sin eso, el PDF los tomaría por una etiqueta HTML.
    assert r'- **De:** Ana Pérez \<ana@ejemplo.es\>' in texto
    assert '- **CC:** equipo@ejemplo.es' in texto
    assert '## Adjuntos' in texto
    assert '- presupuesto.pdf (14 B)' in texto
    assert '=?utf-8?' not in texto and 'Content-Type' not in texto


def test_texto_plano_en_latin1(entorno, tmp_path):
    entorno()
    from api import correo

    crudo = ('From: pepe@ejemplo.es\r\nSubject: Reunión\r\n'
             'Content-Type: text/plain; charset="iso-8859-1"\r\n'
             'Content-Transfer-Encoding: 8bit\r\n\r\n'
             'Mañana a las diez.\r\n').encode('iso-8859-1')
    ruta = tmp_path / 'latin1.eml'
    ruta.write_bytes(crudo)

    leido = correo.leer(str(ruta), 'latin1.eml')

    assert leido.asunto == 'Reunión'
    assert leido.cuerpo == 'Mañana a las diez.'
    assert leido.adjuntos == []


def test_adjuntos_sin_nombre_repetidos_y_reenviados(entorno, tmp_path):
    entorno()
    from api import correo

    reenviado = EmailMessage()
    reenviado['From'] = 'otro@ejemplo.es'
    reenviado['Subject'] = 'Original'
    reenviado.set_content('El primero.')

    mensaje = EmailMessage()
    mensaje['From'] = 'ana@ejemplo.es'
    mensaje['Subject'] = 'Varios'
    mensaje.set_content('Van tres cosas.')
    mensaje.add_attachment(b'uno', maintype='text', subtype='csv', filename='datos.csv')
    mensaje.add_attachment(b'dos', maintype='text', subtype='csv', filename='datos.csv')
    mensaje.add_attachment(b'\x89PNG', maintype='image', subtype='png')
    mensaje.add_attachment(reenviado)

    leido = correo.leer(guardar(tmp_path, mensaje), 'varios.eml')

    nombres = [a.nombre for a in leido.adjuntos]
    assert nombres == ['datos.csv', 'datos-2.csv', 'adjunto-3.png', 'Original.eml']
    assert b'El primero.' in leido.adjuntos[3].datos


def test_lo_que_no_es_un_correo_se_rechaza(entorno, tmp_path):
    entorno()
    from api import correo
    from errors import ApiError

    ruta = tmp_path / 'nota.eml'
    ruta.write_text('Esto es una nota cualquiera.\n')

    with pytest.raises(ApiError) as error:
        correo.leer(str(ruta), 'nota.eml')
    assert error.value.status == 422
    assert 'no parece un correo' in str(error.value)


def test_documento_a_markdown_acepta_eml_y_entrega_los_adjuntos(cliente):
    from storage import storage
    from tests.conftest import subida

    file_id = storage.save_upload(SESION, subida(bytes(correo_completo()), 'correo.eml')).id
    respuesta = cliente.post('/api/tools/a-markdown', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id]})

    assert respuesta.status_code == 201, respuesta.get_json()
    datos = respuesta.get_json()
    assert [f['name'] for f in datos['files']] == ['correo.md', 'presupuesto.pdf']
    assert datos['vista_previa']['texto'].startswith('# Presupuesto del año 2026')
    with open(storage.path_of(SESION, datos['files'][1]['id']), 'rb') as fh:
        assert fh.read() == b'%PDF-1.4 falso'


def test_correo_a_pdf_rechaza_lo_que_no_es_eml(cliente):
    from storage import storage
    from tests.conftest import subida

    file_id = storage.save_upload(SESION, subida(b'hola', 'nota.txt')).id
    respuesta = cliente.post('/api/tools/correo-a-pdf', headers={'X-Session-Id': SESION},
                             json={'file_ids': [file_id]})

    assert respuesta.status_code == 400
