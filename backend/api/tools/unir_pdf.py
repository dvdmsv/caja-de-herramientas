"""Herramienta: combinar varios PDF en uno solo, en el orden recibido."""
import pikepdf
from flask import Blueprint, jsonify

from api import current_session, params, progreso
from errors import ApiError
from storage import storage

bp = Blueprint('unir_pdf', __name__, url_prefix='/api/tools')

SALIDA = 'documento-combinado.pdf'


@bp.post('/unir-pdf')
def unir_pdf():
    session_id = current_session()
    file_ids = params.ids(params.cuerpo(), minimo=2,
                          mensaje='Selecciona al menos dos PDF para combinar.')

    # Se resuelven todas las rutas antes de escribir nada, para fallar pronto.
    rutas = []
    for file_id in file_ids:
        record = storage.record_of(session_id, file_id)
        if record.ext != '.pdf':
            raise ApiError(f'"{record.name}" no es un PDF.', 400)
        rutas.append((record.name, storage.path_of(session_id, file_id)))

    destino, record = storage.reserve_output(session_id, SALIDA)
    with pikepdf.Pdf.new() as salida:
        with salida.open_outline(max_depth=256) as indice:
            for nombre, ruta in progreso.contando(rutas, len(rutas), 'Uniendo documentos'):
                with _abrir(nombre, ruta) as origen:
                    inicio = len(salida.pages)
                    salida.add_pages_from(origen, forms='preserve')
                    if '/Outlines' in origen.Root:
                        paginas = {p.objgen: salida.pages[inicio + n].obj
                                   for n, p in enumerate(origen.pages)}
                        for nodo in origen.open_outline(max_depth=256).root:
                            indice.root.append(_copiar_marcador(nodo, origen, salida, paginas))
        salida.save(destino)

    return jsonify({'files': [storage.commit_output(session_id, record).to_json()]}), 201


def _copiar_marcador(nodo, origen, salida, paginas):
    copia = pikepdf.OutlineItem(nodo.title, color=nodo.color, flags=nodo.flags)
    copia.is_closed = nodo.is_closed
    accion = nodo.action
    tipo = accion.get('/S') if accion is not None else None
    if tipo == pikepdf.Name.GoTo:
        # PDF admite el mismo destino como /Dest y como acción /GoTo.
        destino = pikepdf.OutlineItem(nodo.title, accion.get('/D')).resolved_destination(origen)
    else:
        destino = nodo.resolved_destination(origen)
    if destino is not None and getattr(destino.page, 'objgen', None) in paginas:
        destino.page = paginas[destino.page.objgen]
        copia.destination = destino.to_array()
    elif tipo in (pikepdf.Name.URI, pikepdf.Name.GoToR, pikepdf.Name.Named):
        # Copiar los atributos de navegación. Una referencia remota conserva
        # intactos el archivo, el destino y su sistema de coordenadas.
        navegacion = pikepdf.Dictionary({k: v for k, v in accion.items() if k != '/Next'})
        copia.action = navegacion.with_same_owner_as(salida.Root)
    copia.children = [_copiar_marcador(hijo, origen, salida, paginas) for hijo in nodo.children]
    return copia


def _abrir(nombre: str, ruta: str) -> pikepdf.Pdf:
    try:
        return pikepdf.open(ruta)
    except pikepdf.PasswordError as err:
        raise ApiError(f'"{nombre}" está protegido con contraseña. Quítasela primero.', 422) from err
    except pikepdf.PdfError as err:
        raise ApiError(f'No se ha podido abrir "{nombre}": puede estar dañado.', 422) from err
