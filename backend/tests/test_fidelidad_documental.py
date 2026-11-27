"""Regresiones de exportación verificadas después de reabrir el archivo final."""
import io

import fitz
import pikepdf
import pytest
from PIL import Image

from tests.conftest import SESION, subida


@pytest.fixture
def cliente(entorno):
    entorno()
    import app
    return app.create_app('pesados').test_client()


def subir(datos, nombre='documento.pdf'):
    from storage import storage
    return storage.save_upload(SESION, subida(datos, nombre)).id


def ejecutar(cliente, herramienta, ids, **opciones):
    return cliente.post('/api/tools/' + herramienta, headers={'X-Session-Id': SESION},
                        json={'file_ids': ids, **opciones})


def resultado(respuesta):
    from storage import storage
    assert respuesta.status_code == 201, respuesta.get_json()
    return storage.path_of(SESION, respuesta.get_json()['files'][0]['id'])


def png(imagen):
    datos = io.BytesIO()
    imagen.save(datos, 'PNG')
    return datos.getvalue()


@pytest.mark.parametrize('escaneado', [False, True])
def test_anonimizado_identifica_imagenes_sin_texto(cliente, escaneado):
    with fitz.open() as doc:
        doc.new_page().insert_text((50, 80), 'ana@example.org')
        if escaneado:
            imagen = doc[0].get_pixmap().tobytes('png')
            p = doc.new_page()
            p.insert_image(p.rect, stream=imagen)
        doc.new_page()  # Una página en blanco no necesita OCR.
        ident = subir(doc.tobytes())
    for slug in ['anonimizar-pdf/inspeccionar', 'anonimizar-pdf']:
        r = ejecutar(cliente, slug, [ident], tipos=['correo'])
        assert r.status_code in (200, 201)
        assert r.json['paginas_sin_capa'] == ([2] if escaneado else [])


def test_firma_conserva_posicion_y_orientacion_en_paginas_mixtas(cliente):
    with fitz.open() as doc:
        for i, giro in enumerate([0, 90, 180, 270]):
            doc.new_page(width=200 + i * 20, height=400).set_rotation(giro)
        ident = subir(doc.tobytes())
    firma = Image.new('RGB', (40, 12), 'red')
    firma.paste((0, 0, 255), (20, 0, 40, 12))
    sello = subir(png(firma), 'firma.png')
    r = ejecutar(cliente, 'firmar', [ident], firma_id=sello, todas=True, x=.8, y=.5, ancho=.2)
    with fitz.open(resultado(r)) as doc:
        for p in doc:
            mapa = p.get_pixmap()
            for x, esperado in [(.75, (255, 0, 0)), (.85, (0, 0, 255))]:
                assert mapa.pixel(round(x * mapa.width), round(.5 * mapa.height)) == esperado


def formulario(indirecto):
    with fitz.open() as doc:
        for nombre in ['uno', 'dos']:
            p = doc.new_page()
            w = fitz.Widget()
            w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
            w.field_name = nombre
            w.field_value = 'origen'
            w.rect = fitz.Rect(30, 60, 230, 90)
            p.add_widget(w)
        origen = doc.tobytes()
    with pikepdf.open(io.BytesIO(origen)) as pdf:
        form = pdf.Root.AcroForm
        campos = form.Fields
        padre = pdf.make_indirect(pikepdf.Dictionary(T='grupo', Kids=campos))
        for campo in campos:
            campo.Parent = padre
        form.Fields = pdf.make_indirect(pikepdf.Array([padre]))
        form.DR = pikepdf.Dictionary(Font=pikepdf.Dictionary())
        if indirecto:
            pdf.Root.AcroForm = pdf.make_indirect(form)
        salida = io.BytesIO()
        pdf.save(salida)
        return salida.getvalue()


@pytest.mark.parametrize('indirecto', [False, True])
@pytest.mark.parametrize('slug, opciones', [
    ('dividir-pdf', {'paginas': '2'}),
    ('organizar-pdf', {'paginas': [{'numero': 2}]}),
    ('visor/guardar', {'paginas': [{'numero': 2}]})])
def test_formulario_conserva_jerarquia_recursos_y_edicion(cliente, tmp_path, slug, opciones, indirecto):
    ident = subir(formulario(indirecto))
    salida = resultado(ejecutar(cliente, slug, [ident], **opciones))
    ruta_editada = tmp_path / 'editado.pdf'
    with pikepdf.open(salida) as pdf:
        form = pdf.Root.AcroForm
        assert '/Font' in form.DR
        [raiz] = form.Fields
        [campo] = raiz.Kids
        assert str(raiz.T) == 'grupo'
        assert str(campo.T) == 'dos'
        assert campo.Parent.objgen == raiz.objgen
        assert pdf.pages[0].Annots[0].objgen == campo.objgen
        campo.V = 'nuevo valor'
        pdf.save(ruta_editada)
    with fitz.open(ruta_editada) as doc:
        assert next(doc[0].widgets()).field_value == 'nuevo valor'


def test_unir_conserva_uri_posicion_y_zoom(cliente):
    with fitz.open() as doc:
        doc.new_page()
        doc.set_toc([[1, 'Inicio', 1]])
        uno = subir(doc.tobytes())
    with fitz.open() as doc:
        doc.new_page()
        doc.set_toc([[1, 'Sitio', -1, {'kind': fitz.LINK_URI, 'uri': 'https://example.org'}],
                     [1, 'Detalle', 1, {'kind': fitz.LINK_GOTO, 'to': fitz.Point(38, 222), 'zoom': 2}]])
        dos = subir(doc.tobytes())
    with fitz.open(resultado(ejecutar(cliente, 'unir-pdf', [uno, dos]))) as doc:
        _, externo, interno = doc.get_toc(simple=False)
        assert externo[3]['uri'] == 'https://example.org'
        assert interno[2] == 2
        assert interno[3]['to'] == fitz.Point(38, 222)
        assert interno[3]['zoom'] == 2


def test_quitar_y_cambiar_claves_antiguas_cortas(cliente):
    with fitz.open() as doc:
        doc.new_page()
        ident = subir(doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw='a', owner_pw='a'))
    def cambiar(actual, **opciones):
        return ejecutar(cliente, 'proteger-pdf', [ident], password_actual=actual, **opciones)
    assert cambiar('b', accion='quitar').status_code == 403
    assert cambiar('a', accion='proteger', password='b').status_code == 400
    with fitz.open(resultado(cambiar('a', accion='quitar'))) as doc:
        assert not doc.needs_pass
    with fitz.open(resultado(cambiar('a', accion='proteger', password='nueva'))) as doc:
        assert doc.authenticate('nueva')


def test_unir_respeta_destino_remoto_y_destino_con_nombre(cliente):
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        primero = io.BytesIO()
        pdf.save(primero)
        pdf.Root.Dests = pikepdf.Dictionary(Seccion=pikepdf.Array([pdf.pages[0].obj, pikepdf.Name.Fit]))
        remoto = pikepdf.Dictionary(S=pikepdf.Name.GoToR, F='manual.pdf',
                                    D=pikepdf.Array([8, pikepdf.Name.XYZ, 10, 50, 2]))
        with pdf.open_outline() as indice:
            indice.root.extend([pikepdf.OutlineItem('Manual', action=remoto),
                                pikepdf.OutlineItem('Sección', pikepdf.Name.Seccion)])
        segundo = io.BytesIO()
        pdf.save(segundo)
    r = ejecutar(cliente, 'unir-pdf', [subir(primero.getvalue()), subir(segundo.getvalue())])
    with pikepdf.open(resultado(r)) as pdf:
        manual, seccion = pdf.open_outline().root
        assert str(manual.action.F) == 'manual.pdf'
        assert list(manual.action.D) == [8, pikepdf.Name.XYZ, 10, 50, 2]
        assert seccion.destination[0].objgen == pdf.pages[1].objgen
        assert seccion.destination[1] == pikepdf.Name.Fit
