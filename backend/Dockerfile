# Python 3.12 porque ocrmypdf exige 3.11 o superior.
FROM python:3.12-slim

# Establece el directorio de trabajo
WORKDIR /app

# Lo que esta aplicación necesita de fuera de Python, y lo necesitan sólo dos
# herramientas:
#
#   - El reconocimiento de texto: Tesseract hace el OCR y Ghostscript el trabajo
#     con el PDF. `tesseract-ocr-spa` añade el español; el inglés viene con el
#     paquete base.
#   - "Documento a PDF": LibreOffice, y sólo `libreoffice-writer`, que arrastra
#     `libreoffice-core` y nada más. El metapaquete `libreoffice` traería Calc,
#     Impress y Base, que aquí no se usan, y multiplicaría el tamaño de la
#     imagen. `--no-install-recommends` es lo que además evita `default-jre`:
#     Writer no necesita Java para exportar a PDF y son ~180 MB de menos.
#     `fonts-liberation` da las métricas de Arial, Times New Roman y Courier
#     New, para que un .docx hecho en Windows pagine donde tiene que paginar.
#   - "Markdown a PDF": WeasyPrint compone con Pango (`libpango-1.0-0`,
#     `libpangoft2-1.0-0`), y sus letras —Inter, Charis SIL y DejaVu Sans Mono—
#     van instaladas para que el resultado no dependa de lo que haya. De Inter
#     sólo se usan seis caras (normal, seminegrita y negrita, con sus
#     cursivas): el paquete trae 36 y el resto, unos 18 MB, se borra aquí mismo.
#
# La limpieza va en este mismo RUN a propósito: borrar en una capa posterior no
# quita nada de peso, porque los archivos siguen dentro de la capa que los creó.
# De LibreOffice sobra lo que sólo sirve para usarlo a mano —la galería de
# imágenes prediseñadas, las plantillas y los asistentes—: aquí sólo se le pide
# convertir a PDF sin interfaz. Son unos 39 MB entre eso y la documentación.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ghostscript tesseract-ocr tesseract-ocr-spa \
       libreoffice-writer fonts-liberation \
       libpango-1.0-0 libpangoft2-1.0-0 fonts-inter fonts-sil-charis fonts-dejavu-mono \
    && rm -rf /var/lib/apt/lists/* \
    && find /usr/share/fonts/opentype/inter -type f \
         ! -name 'Inter-Regular.otf' ! -name 'Inter-Italic.otf' \
         ! -name 'Inter-SemiBold.otf' ! -name 'Inter-SemiBoldItalic.otf' \
         ! -name 'Inter-Bold.otf' ! -name 'Inter-BoldItalic.otf' -delete \
    && rm -rf /usr/lib/libreoffice/share/gallery \
              /usr/lib/libreoffice/share/template \
              /usr/lib/libreoffice/share/wizards \
              /usr/share/doc/*

# Las dependencias van antes que el código a propósito: así un cambio de código
# no obliga a reinstalar los ~300 MB de paquetes, que en la VM de despliegue es
# la diferencia entre un build de minutos y uno de bastante más.
COPY requirements.txt /app/
#
# Y lo mismo aquí: la limpieza tiene que ir pegada a la instalación. Se van las
# baterías de pruebas de las bibliotecas y las cabeceras de C, que sólo hacen
# falta para compilar contra ellas, no para ejecutarlas. Unos 58 MB.
#
# Los .pyc se quedan, aunque sean 99 MB: sin ellos Python los regeneraría en la
# capa de escritura del contenedor y cada arranque en frío costaría más, que es
# justo lo que evita el `post_fork` de gunicorn.conf.py.
RUN pip install --no-cache-dir -r requirements.txt \
    && find /usr/local/lib/python3.12/site-packages \
         -type d \( -name tests -o -name test \) -prune -exec rm -rf {} + \
    && find /usr/local/lib/python3.12/site-packages \
         \( -name '*.h' -o -name '*.pxd' \) -delete

# Copia los archivos de la aplicación
COPY . /app

# Exponer el puerto
EXPOSE 5000

# Los ajustes viven en gunicorn.conf.py, que los calcula mirando los núcleos y
# la memoria que tenga el contenedor. Ahí está explicado cada uno, incluido por
# qué no se usa --preload y qué precalienta el post_fork.
#
# En forma de lista, no de shell: no hay variables que expandir, así que
# gunicorn es el proceso 1 y recibe el SIGTERM al parar el contenedor sin
# necesidad de un `exec` que lo arregle.
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]