#!/usr/bin/env python3
"""Dibuja las imágenes del instalador de Windows a partir del icono de la aplicación.

Sin ellas el `setup.exe` salía con el icono de serie de NSIS y el asistente con
sus imágenes grises: parecía un programa cualquiera descargado de cualquier
sitio. Lo que sale de aquí:

- `src-tauri/icons/instalador.ico`: el icono de la aplicación —los tres puntos de
  las categorías sobre fondo oscuro— con una flecha de descarga en la esquina.
  Se reconoce la aplicación y a la vez se distingue el instalador de la
  aplicación ya instalada, que lleva el icono sin flecha.
- `src-tauri/windows/lateral.bmp` (164 × 314): la franja de las páginas de
  bienvenida y final del asistente.
- `src-tauri/windows/cabecera.bmp` (150 × 57): la cabecera de las demás páginas.

**No corre en la compilación**: se ejecuta a mano cuando cambia el icono y lo que
genera se versiona, como `frontend/scripts/generar-iconos.py`. Así la CI no
necesita Pillow para esto.

    python3 escritorio/scripts/generar-imagenes-instalador.py

Se dibuja desde cero y con cuatro veces más resolución, reduciendo al final: es
lo que da bordes suaves. Los colores y las proporciones son los de `icon.png`.
"""
import pathlib

from PIL import Image, ImageDraw

AQUI = pathlib.Path(__file__).resolve().parent.parent / 'src-tauri'

FONDO = (0x1f, 0x22, 0x30)
PUNTOS = [(0xd0, 0x34, 0x1f), (0x7c, 0x3a, 0xed), (0x0f, 0x7a, 0x6b)]
BLANCO = (0xff, 0xff, 0xff)

# Proporciones del icono, sobre un lienzo de 1: esquina redondeada, radio de los
# puntos y distancia entre sus centros (se solapan, como en `icon.png`).
REDONDEO = 0.22
RADIO = 72 / 512
PASO = 112 / 512

ESCALA = 4


def puntos(dibujo, cx, cy, radio, paso):
    for indice, color in enumerate(PUNTOS):
        x = cx + (indice - 1) * paso
        dibujo.ellipse((x - radio, cy - radio, x + radio, cy + radio), fill=color)


def icono(lado: int, con_flecha: bool) -> Image.Image:
    """El icono a `lado` píxeles, con la flecha de instalar o sin ella."""
    grande = lado * ESCALA
    imagen = Image.new('RGBA', (grande, grande), (0, 0, 0, 0))
    dibujo = ImageDraw.Draw(imagen)
    dibujo.rounded_rectangle((0, 0, grande - 1, grande - 1), radius=REDONDEO * grande, fill=FONDO)

    # Con flecha, los puntos suben para dejarle sitio abajo; a 16 y 24 px, más,
    # o el círculo de la flecha se los come.
    pequeno = lado <= 24
    alto = 0.5 if not con_flecha else (0.33 if pequeno else 0.44)
    puntos(dibujo, grande / 2, alto * grande, RADIO * grande, PASO * grande)

    if con_flecha:
        # Un círculo blanco en la esquina, con un borde del color del fondo que
        # lo separa del punto verde. A tamaños pequeños el círculo crece: si no,
        # a 16 px la flecha es una mancha de dos píxeles.
        radio = (0.27 if pequeno else 0.21) * grande
        cx = cy = grande - radio - (0.02 if pequeno else 0.04) * grande
        borde = 0.035 * grande
        dibujo.ellipse((cx - radio - borde, cy - radio - borde, cx + radio + borde, cy + radio + borde), fill=FONDO)
        dibujo.ellipse((cx - radio, cy - radio, cx + radio, cy + radio), fill=BLANCO)

        # La flecha hacia abajo: un palo y una punta, y en los tamaños grandes
        # la bandeja donde cae.
        grosor = radio * (0.30 if pequeno else 0.22)
        arriba = cy - radio * 0.55
        punta = cy + radio * (0.45 if pequeno else 0.30)
        ancho_punta = radio * (0.62 if pequeno else 0.5)
        alto_punta = radio * (0.55 if pequeno else 0.42)
        dibujo.rectangle((cx - grosor / 2, arriba, cx + grosor / 2, punta - alto_punta + 1), fill=FONDO)
        dibujo.polygon([(cx - ancho_punta, punta - alto_punta), (cx + ancho_punta, punta - alto_punta),
                        (cx, punta)], fill=FONDO)
        if not pequeno:
            bandeja = cy + radio * 0.52
            dibujo.rectangle((cx - radio * 0.5, bandeja, cx + radio * 0.5, bandeja + grosor * 0.8), fill=FONDO)

    return imagen.resize((lado, lado), Image.LANCZOS)


def lateral() -> Image.Image:
    """La franja de bienvenida: fondo oscuro y los tres puntos en grande."""
    ancho, alto = 164 * ESCALA, 314 * ESCALA
    imagen = Image.new('RGB', (ancho, alto), FONDO)
    dibujo = ImageDraw.Draw(imagen)
    radio = 22 * ESCALA
    puntos(dibujo, ancho / 2, alto * 0.40, radio, radio * PASO / RADIO)
    return imagen.resize((164, 314), Image.LANCZOS)


def cabecera() -> Image.Image:
    """La cabecera: los puntos pequeños a la derecha, sobre el blanco de NSIS."""
    ancho, alto = 150 * ESCALA, 57 * ESCALA
    imagen = Image.new('RGB', (ancho, alto), BLANCO)
    dibujo = ImageDraw.Draw(imagen)
    radio = 11 * ESCALA
    paso = radio * PASO / RADIO
    puntos(dibujo, ancho - radio - paso - 14 * ESCALA, alto / 2, radio, paso)
    return imagen.resize((150, 57), Image.LANCZOS)


def main() -> None:
    tamanos = [16, 24, 32, 48, 64, 256]
    iconos = [icono(lado, con_flecha=True) for lado in tamanos]
    # Cada tamaño dibujado aparte, no reducido del grande: el de 16 lleva su
    # propia flecha simplificada.
    iconos[-1].save(AQUI / 'icons' / 'instalador.ico', sizes=[(t, t) for t in tamanos],
                    append_images=iconos[:-1])
    # BMP de 24 bits, que es lo que admite NSIS.
    lateral().save(AQUI / 'windows' / 'lateral.bmp')
    cabecera().save(AQUI / 'windows' / 'cabecera.bmp')
    for nombre in ('icons/instalador.ico', 'windows/lateral.bmp', 'windows/cabecera.bmp'):
        print(f'{nombre}: {(AQUI / nombre).stat().st_size / 1024:.1f} kB')


if __name__ == '__main__':
    main()
