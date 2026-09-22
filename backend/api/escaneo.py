"""Dejar la foto de un papel como si hubiera pasado por un escáner.

Aparte de la herramienta, como `comparacion.py`: aquí entra una imagen de Pillow
y sale otra, sin archivos, sin sesión y sin Flask, para poder medir lo que hace.

**El problema no es el contraste, es que la luz no es plana.** Una foto de un
folio con el móvil tiene una esquina más oscura que la otra —la sombra de la
mano, la lámpara de un lado—, y el fondo no es blanco sino un gris amarillento
que además cambia de sitio a sitio. Subir el contraste a lo bruto no lo arregla:
aclara el lado claro hasta quemarlo y deja el oscuro igual de gris.

Lo que sí lo arregla es **dividir la imagen por su propio fondo**. Se estima cómo
de iluminado está cada trozo del papel, y cada píxel se compara con la
iluminación de *su* zona en vez de con un número global. El resultado es un fondo
plano a 255 en toda la hoja, con la tinta intacta. A partir de ahí, un umbral
global ya funciona, y por eso no hace falta un umbral adaptativo aparte: lo
adaptativo era la división.

Va con numpy y Pillow, y nada más. OpenCV lo haría igual de bien, pero aquí sólo
llega de rebote como dependencia de pdf2docx, y atarse a eso a sabiendas es una
trampa para el día que pdf2docx cambie.
"""
import numpy as np
from PIL import Image, ImageFilter

MODOS = ('blanco-y-negro', 'gris', 'color')

INTENSIDAD_MINIMA, INTENSIDAD_MAXIMA, INTENSIDAD_POR_DEFECTO = 0, 100, 50

# A cuánto se reduce la imagen para estimar el fondo. El fondo es luz, y la luz
# cambia despacio: no hace falta verla a tamaño completo, y en pequeño el
# desenfoque que hay que aplicar cuesta una fracción.
LADO_DEL_FONDO = 400

# Radio del desenfoque sobre esa copia reducida. Tiene que ser bastante mayor que
# el grosor de una letra —si no, el fondo estimado incluiría la tinta y la
# división la borraría— y bastante menor que el ancho de la hoja.
RADIO_FONDO = 12

# Suelo de la división, **en proporción al papel de la propia página**.
#
# Éste es el parámetro que distingue una sombra de un contenido oscuro, y es el
# que hacía falta medir. La estimación del fondo no sabe la diferencia entre «esta
# zona está en penumbra» y «aquí hay una foto pegada»: en las dos ve oscuro, y al
# dividir deja las dos en blanco. Medido sobre un folio con una foto oscura
# encima: sin suelo relativo, el 77 % de la foto se convertía en blanco, o sea se
# destruía.
#
# El suelo dice: por debajo de esta fracción del papel, deja de creerte que sea
# sombra. Con 0,55 la foto queda intacta (0,8 % de blancos) y una sombra dura de
# esquina —lo peor que hace una mano, medido hasta el 75 %— se sigue corrigiendo
# entera. A partir de 0,70 la sombra empieza a quedarse gris, así que 0,55 deja
# margen por los dos lados.
#
# Va en proporción y no en un valor absoluto porque lo que importa es el
# contraste con *esta* página, no un número de la escala de grises: una foto
# subexpuesta entera tiene su papel a 90 y su tinta a 20.
SUELO_DEL_FONDO = 0.55

# Qué se considera «el papel» de la página al medir ese suelo. Alto, pero no el
# máximo: un brillo especular o un píxel quemado no pueden fijar la referencia.
PERCENTIL_PAPEL = 92


def limpiar(imagen: Image.Image, modo: str, intensidad: int) -> Image.Image:
    """La imagen con el fondo blanqueado y la tinta realzada.

    `intensidad` va de 0 a 100 y dice cuánto se aprieta: con 0 apenas se corrige
    la iluminación y con 100 se lleva a blanco y negro casi puros. El valor por
    defecto (50) está pensado para lo que de verdad llega: una foto de un folio
    impreso, hecha a mano y con luz de interior.
    """
    if modo not in MODOS:
        raise ValueError(f'modo desconocido: {modo}')

    rgb = imagen if imagen.mode == 'RGB' else imagen.convert('RGB')
    datos = np.asarray(rgb, dtype=np.float32)
    gris = datos.mean(axis=2)

    plano = gris / _fondo(gris)
    plano = _estirar(plano, intensidad)

    if modo == 'blanco-y-negro':
        # El umbral va fijo en la mitad, y puede: lo adaptativo ya lo hizo la
        # división, y el estirado deja el papel en 1 y la tinta cerca de 0. Quien
        # decide qué cuenta como papel es `intensidad`, una sola vez y en
        # `_punto_blanco`. Dos mandos sobre lo mismo sólo se pelean.
        return Image.fromarray(np.where(plano >= 0.5, 255, 0).astype(np.uint8), mode='L')
    if modo == 'gris':
        return Image.fromarray(_a_byte(plano * 255), mode='L')

    # En color cada canal se divide por **su propio** fondo, no por el del gris.
    #
    # Ésta es la diferencia entre aclarar el papel y blanquearlo. Una bombilla de
    # interior deja el papel crema: mucho rojo, poco azul. Corrigiendo los tres
    # canales con el mismo factor, la proporción entre ellos no cambia y el papel
    # sigue siendo crema, sólo que más claro —medido: el azul se quedaba en 218
    # contra 254 de los otros dos—. Dividiendo cada canal por el suyo se corrige
    # de paso el balance de blancos, que es de lo que iba el problema.
    #
    # La tinta y los colores de verdad no se van con ello: el fondo de cada canal
    # sigue siendo la luz, y una firma azul tiene su azul muy por debajo de él.
    canales = [_estirar(datos[:, :, indice] / _fondo(datos[:, :, indice]), intensidad)
               for indice in range(3)]
    return Image.fromarray(_a_byte(np.stack(canales, axis=2) * 255), mode='RGB')


def _fondo(gris: np.ndarray) -> np.ndarray:
    """Cómo de iluminado está cada trozo del papel, sin la tinta.

    Se estima en pequeño y con un desenfoque ancho: las letras desaparecen —son
    finas y oscuras, y el desenfoque las diluye entre el papel que las rodea— y
    queda la forma de la luz. Luego se devuelve al tamaño original, donde ya sólo
    hace falta que sea suave.

    Y por último se le pone un suelo relativo al papel de la página, que es lo que
    separa una sombra de una foto pegada. Ver `SUELO_DEL_FONDO`.
    """
    alto, ancho = gris.shape
    escala = max(alto, ancho) / LADO_DEL_FONDO
    pequena = Image.fromarray(_a_byte(gris), mode='L')
    if escala > 1:
        pequena = pequena.resize((max(1, int(ancho / escala)), max(1, int(alto / escala))),
                                 Image.BILINEAR)

    # El filtro de máximo se come la tinta antes de desenfocar: sin él, un
    # párrafo denso baja la media de su zona y el fondo estimado allí sale más
    # oscuro de lo que es, con lo que ese párrafo acabaría lavado.
    pequena = pequena.filter(ImageFilter.MaxFilter(5))
    pequena = pequena.filter(ImageFilter.GaussianBlur(RADIO_FONDO))

    devuelta = np.asarray(pequena.resize((ancho, alto), Image.BILINEAR), dtype=np.float32)

    # El suelo, que es lo que impide que una foto pegada se trate como sombra.
    # El 1.0 es sólo para no dividir por cero en una imagen completamente negra.
    papel = float(np.percentile(gris, PERCENTIL_PAPEL))
    return np.maximum(devuelta, max(papel * SUELO_DEL_FONDO, 1.0))


def _punto_blanco(intensidad: int) -> float:
    """Qué proporción del fondo local basta para contar como papel.

    Con 0,88 sólo se blanquea lo que ya era casi papel y los grises se respetan;
    con 0,60 se blanquea todo lo que se le parezca, y el fondo queda impecable a
    costa de poder llevarse un lápiz flojo o un sello desvaído. Ésa es toda la
    escala de `intensidad`, y es el **único** mando: el umbral del blanco y negro
    va fijo, porque dos mandos sobre lo mismo se pelean.
    """
    return 0.88 - 0.28 * intensidad / 100


def _estirar(plano: np.ndarray, intensidad: int) -> np.ndarray:
    """Papel a blanco puro, y todo lo demás estirado en proporción.

    Es un estirado **sólo por arriba**: lo que llega al punto de blanco se va a 1
    y el resto sube proporcionalmente. No se recorta por abajo a propósito, y esa
    es la diferencia entre limpiar y estropear: hundir los tonos medios volvería
    negro un sello azul o una foto pegada, que es justo lo que el modo en color
    existe para conservar.
    """
    return np.clip(plano / _punto_blanco(intensidad), 0.0, 1.0)


def _a_byte(valores: np.ndarray) -> np.ndarray:
    return np.clip(valores, 0, 255).astype(np.uint8)
