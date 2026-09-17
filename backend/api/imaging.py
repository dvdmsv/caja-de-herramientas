"""Operaciones de imagen compartidas por las herramientas.

Concentra las tres decisiones que se repiten al guardar: respetar la orientación
de la cámara, adaptar el modo de color al formato de destino y elegir las
opciones de guardado de cada formato.
"""
from PIL import Image, ImageChops, ImageOps

from api import limites
from api.formatos import CON_CALIDAD, SIN_TRANSPARENCIA
from errors import ApiError

# Pillow trae su propio tope contra las "bombas de descompresión", pero por
# defecto sólo **avisa** al pasar de 89 megapíxeles y no falla hasta el doble.
# Aquí se fija el mismo tope que para el rasterizado, y se falla.
Image.MAX_IMAGE_PIXELS = limites.MEGAPIXELES_MAXIMOS * 1_000_000

# Fondo para las imágenes con transparencia que van a un formato sin alfa.
FONDO = (255, 255, 255)

# Por debajo de esta calidad, en PNG compensa reducir la paleta de colores.
UMBRAL_PALETA = 60

# Ancho de la transición al recortar un fondo claro. Sin ella el borde del trazo
# quedaría dentado, como recortado con tijeras.
RAMPA_FONDO = 30


def abrir(ruta: str, nombre: str) -> Image.Image:
    """Abre una imagen aplicando la rotación que indique su EXIF."""
    try:
        imagen = Image.open(ruta)
        limites.comprobar_lienzo(imagen.width, imagen.height, f'«{nombre}»')
        imagen.load()
        # Sin esto, las fotos de móvil salen giradas al recomprimirlas. Se hace
        # sobre la misma imagen para no dejar abierto el archivo original y para
        # conservar su `.format`, que indica en qué formato venía.
        ImageOps.exif_transpose(imagen, in_place=True)
    except (ApiError, MemoryError):
        # El tope de tamaño y el quedarse sin memoria ya tienen su respuesta
        # (413): disfrazarlos de "no parece una imagen válida" mandaría a quien
        # lo lee a buscar el problema donde no está.
        raise
    except Exception as err:
        raise ApiError(f'No se ha podido leer "{nombre}": no parece una imagen válida.', 422) from err
    return imagen


def redimensionar(imagen: Image.Image, lado_maximo: int) -> Image.Image:
    """Reduce la imagen para que su lado mayor no pase de `lado_maximo`."""
    if lado_maximo > 0 and max(imagen.size) > lado_maximo:
        imagen.thumbnail((lado_maximo, lado_maximo), Image.LANCZOS)
    return imagen


def quitar_fondo_claro(imagen: Image.Image, umbral: int) -> Image.Image:
    """Vuelve transparente lo que sea más claro que `umbral`.

    Pensado para fotos de una firma sobre papel: el papel desaparece y queda el
    trazo. La transición es suave para que el borde no salga dentado, y la
    máscara se multiplica por el alfa que la imagen ya tuviera, así un PNG
    recortado a mano no se estropea.
    """
    rgba = imagen.convert('RGBA')
    claro = max(0, umbral - RAMPA_FONDO)
    tabla = [255 if v <= claro else 0 if v >= umbral else round(255 * (umbral - v) / RAMPA_FONDO)
             for v in range(256)]
    mascara = rgba.convert('L').point(tabla)
    rgba.putalpha(ImageChops.multiply(rgba.getchannel('A'), mascara))
    return rgba


def recortar_transparente(imagen: Image.Image) -> Image.Image:
    """Quita el aire transparente de alrededor.

    Hace que el recuadro que se arrastra por la pantalla sea la firma y no el
    papel que la rodeaba.
    """
    rgba = imagen if imagen.mode == 'RGBA' else imagen.convert('RGBA')
    caja = rgba.getchannel('A').getbbox()
    return rgba.crop(caja) if caja else rgba


def guardar(imagen: Image.Image, destino: str, formato: str, calidad: int) -> None:
    """Escribe la imagen en el formato pedido con opciones sensatas."""
    preparada = adaptar_modo(imagen, formato)
    opciones: dict = {}

    if formato in CON_CALIDAD:
        opciones['quality'] = calidad
        opciones['optimize'] = True
        if formato == 'JPEG':
            opciones['progressive'] = True
        if formato == 'WEBP':
            opciones.pop('optimize', None)
            opciones['method'] = 4
    elif formato == 'PNG':
        opciones['optimize'] = True
        opciones['compress_level'] = 9
        if calidad < UMBRAL_PALETA and preparada.mode == 'RGB':
            # Reducir la paleta baja mucho el peso sin tocar el formato.
            colores = max(16, int(256 * calidad / UMBRAL_PALETA))
            preparada = preparada.quantize(colors=colores, method=Image.MEDIANCUT)
    elif formato == 'TIFF':
        opciones['compression'] = 'tiff_deflate'

    try:
        preparada.save(destino, formato, **opciones)
    except OSError as err:
        raise ApiError(f'No se ha podido guardar la imagen: {err}', 422) from err


def adaptar_modo(imagen: Image.Image, formato: str) -> Image.Image:
    """Ajusta el modo de color a lo que el formato de destino admite.

    Con formato ``PDF`` devuelve siempre RGB sin transparencia, que es lo que
    necesita quien componga páginas a mano.
    """
    tiene_alfa = imagen.mode in ('RGBA', 'LA', 'PA') or 'transparency' in imagen.info

    if formato in SIN_TRANSPARENCIA:
        if tiene_alfa:
            # Sin esto, las zonas transparentes se volverían negras.
            fondo = Image.new('RGB', imagen.size, FONDO)
            conversion = imagen.convert('RGBA')
            fondo.paste(conversion, mask=conversion.split()[-1])
            return fondo
        return imagen.convert('RGB') if imagen.mode != 'RGB' else imagen

    if imagen.mode in ('P', 'CMYK', 'LA', 'PA'):
        return imagen.convert('RGBA' if tiene_alfa else 'RGB')
    return imagen
