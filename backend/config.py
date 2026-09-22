"""Configuración de la aplicación, ajustable por variables de entorno.

Los valores por defecto son prudentes: están para que la aplicación arranque en
cualquier máquina sin configurar nada, no porque sean los correctos para la tuya.
Si tu servidor da para más, `.env.example` explica cuáles subir y con qué
criterio.

Los límites que dependen de la máquina viven junto al código que los usa —cada
uno lleva al lado el comentario que explica por qué existe— y se leen desde aquí
con `entorno_entero`. La lista completa está en el README.
"""
import os
import sys

# ─── Antes que nada: los hilos de OpenBLAS ──────────────────────────────────
#
# Esto va aquí arriba, y no en el `docker-compose.yml`, porque tiene que estar
# puesto **antes de que nadie importe numpy**, y `config` es lo primero que
# importa cualquier entrada del proyecto (el `gunicorn.trabajos.conf.py`, el
# `app.py` de desarrollo y los tests).
#
# Qué pasa si falta. OpenBLAS reserva de entrada un juego de arenas por hilo, y
# eso son **639 MB de memoria virtual de datos** aunque no se toquen: medido,
# `import numpy` lleva el `VmData` del proceso de 40 MB a 679. Con
# `preload_app`, quien importa numpy es el **maestro**, así que cada hijo nace
# con ese `VmData` heredado, y `post_fork` le pone encima un `RLIMIT_DATA` de
# 192 MB en `ligeros`. El hijo nace, por tanto, con el límite ya superado: a
# partir de ahí **ningún `mmap` nuevo funciona**. Eso no se ve como un error de
# memoria, se ve como cosas que no encajan —una biblioteca nativa que «no se
# puede mapear», MuPDF abortando el proceso al rasterizar— y se tarda en
# relacionarlas.
#
# Con el hilo único el maestro se queda en 126 MB y todo vuelve a caber. No se
# pierde nada por el camino: aquí numpy sólo hace aritmética de arrays elemento
# a elemento (`api/escaneo.py`), que no pasa por BLAS. Y se fija **sólo**
# OPENBLAS y no OMP, que es lo que usa tesseract: los programas externos heredan
# este entorno, y limitarles los hilos sí les costaría tiempo.
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')


def entorno_entero(nombre: str, defecto: int, minimo: int = 1) -> int:
    """Un entero que se puede ajustar por variable de entorno.

    Un valor absurdo no tumba el arranque: se avisa por la salida de error y se
    sigue con el valor por defecto. Que el servidor no levante por una errata en
    una variable es peor que ignorarla diciéndolo.
    """
    crudo = os.environ.get(nombre)
    if crudo is None or crudo.strip() == '':
        return defecto
    try:
        valor = int(crudo)
    except ValueError:
        print(f'Aviso: {nombre}={crudo!r} no es un número; se usa {defecto}.',
              file=sys.stderr)
        return defecto
    if valor < minimo:
        print(f'Aviso: {nombre}={valor} es menor que el mínimo {minimo}; '
              f'se usa {minimo}.', file=sys.stderr)
        return minimo
    return valor


def nucleos() -> int:
    """Núcleos que puede usar este proceso, no los que tenga la máquina.

    Dentro de un contenedor `os.cpu_count()` devuelve los del anfitrión, que con
    un `cpus: 4.0` puesto es mentira. El cgroup sí dice la verdad.
    """
    try:
        cuota, periodo = open('/sys/fs/cgroup/cpu.max').read().split()
        if cuota != 'max':
            return max(1, round(int(cuota) / int(periodo)))
    except (OSError, ValueError):
        pass
    return os.cpu_count() or 1


def memoria_mb() -> int:
    """Memoria que puede usar este proceso, en MB.

    Mismo problema que con los núcleos: `/proc/meminfo` dentro de un contenedor
    enseña la del anfitrión. Se pregunta primero al cgroup, que es quien conoce
    el `mem_limit`, y sólo si no hay tope se mira la de la máquina.
    """
    try:
        crudo = open('/sys/fs/cgroup/memory.max').read().strip()
        if crudo != 'max':
            return int(crudo) // (1024 * 1024)
    except (OSError, ValueError):
        pass
    try:
        for linea in open('/proc/meminfo'):
            if linea.startswith('MemTotal:'):
                return int(linea.split()[1]) // 1024
    except OSError:
        pass
    return 1024  # si no se puede saber, se supone poca


# Cuánta memoria se le supone a cada worker con las bibliotecas ya cargadas.
# Medido: unos 300 MB. Se redondea a 768 para dejar sitio a los procesos que
# lanza (LibreOffice, pdf2docx, ocrmypdf) sin tener que modelar cada caso.
#
# Ese sitio es para **uno** de esos procesos, no para los que quepan: el worker
# atiende con cuatro hilos, y quien impide que arranquen cuatro a la vez es el
# turno de `api/conversion.py`. Si alguna herramienta pesada dejara de pedirlo,
# esta cuenta se queda en nada.
MEMORIA_POR_WORKER_MB = 768

# Techo de workers. No lo pone la memoria, lo pone que esto es una herramienta
# de trabajo, no un servicio con miles de visitas: pasado este punto la
# concurrencia ya la dan los hilos y lo único que se gana es ocupar RAM.
MAXIMO_WORKERS = 4


def workers_recomendados() -> int:
    """Cuántos procesos caben en esta máquina.

    La idea es que el proyecto se despliegue bien afinado sin que nadie tenga que
    tocar un `.env`: en una máquina holgada saca varios workers, y en una
    pequeña se queda en uno.
    """
    return max(1, min(nucleos(), memoria_mb() // MEMORIA_POR_WORKER_MB, MAXIMO_WORKERS))


# --- servicios de trabajo (`ligeros` y `pesados`) --------------------------
#
# Los dos arrancan con `gunicorn.trabajos.conf.py`: el maestro carga las
# bibliotecas una vez y cada petición la atiende un proceso hijo que muere al
# acabar. El reparto de memoria del contenedor es, por tanto:
#
#     tope del contenedor  ≈  maestro  +  workers × memoria por trabajo
#
# Lo que se le reserva al maestro. Medido: unos 185 MB con PyMuPDF, Pillow y
# WeasyPrint cargados; 256 deja aire para el crecimiento de la propia imagen.
MEMORIA_MAESTRO_MB = 256

# Perfil de cada servicio de trabajo. Los números son topes por **petición**, y
# se aplican con `setrlimit` en el hijo, así que también los heredan LibreOffice,
# Ghostscript y tesseract.
#
# `maximo_workers` es un tope de sensatez, no la palanca: quien decide cuántos
# trabajos caben es la memoria del contenedor, y por eso está holgado. Existe
# para que un `mem_limit` puesto con el dedo gordo no levante veinte procesos
# pesados en una máquina de cuatro núcleos.
PERFILES_TRABAJO = {
    # Vistas previas, inspecciones y QR: cuestan poco y llegan seguidas (el
    # deslizador de la marca de agua manda una cada 350 ms).
    'ligeros': {'memoria_mb': 192, 'cpu_segundos': 30, 'maximo_workers': 3, 'plazo': 60},
    # OCR, ofimática, rasterizado. El tope lo marca el más tragón, y **no** es
    # el que parece: medido en el contenedor con `ulimit -d`, LibreOffice
    # convierte con 384 MB, pero pdf2docx (que arrastra OpenCV y numpy) se cae
    # con violación de segmento a 512 y necesita 768. Los programas externos
    # heredan este límite del worker que los lanza, así que quedarse corto no da
    # un error de memoria: da un proceso muerto a mitad.
    'pesados': {'memoria_mb': 768, 'cpu_segundos': None, 'maximo_workers': 4, 'plazo': None},
}


def workers_de_trabajo(papel: str) -> int:
    """Cuántas peticiones a la vez aguanta este servicio.

    Es el tope global de trabajo simultáneo: no hay cola dentro del proceso,
    la cola es el socket. Sale de la memoria del contenedor, que `memoria_mb()`
    lee del cgroup, así que basta cambiar el `mem_limit` para que se ajuste.
    """
    perfil = PERFILES_TRABAJO[papel]
    caben = (memoria_mb() - MEMORIA_MAESTRO_MB) // perfil['memoria_mb']
    return max(1, min(nucleos(), perfil['maximo_workers'], caben))


def nucleos_por_trabajo() -> int:
    """Núcleos que le tocan a **un** trabajo, no los del contenedor.

    Importa para el OCR, que paraleliza por páginas: con dos trabajos a la vez
    pidiendo los cuatro núcleos cada uno, los dos van más lentos que si se
    reparten. Fuera de un servicio de trabajo (desarrollo) se usan todos.
    """
    papel = os.environ.get('SERVICIO', '').strip().lower()
    if papel in PERFILES_TRABAJO:
        return max(1, nucleos() // workers_de_trabajo(papel))
    return nucleos()


# Carpeta raíz donde vive el almacenamiento temporal de todas las sesiones.
UPLOAD_ROOT = os.environ.get('UPLOAD_ROOT', 'uploads')

# Tamaño máximo de una petición completa (suma de todos los archivos).
# Ojo: nginx tiene su propio `client_max_body_size` y manda el más bajo de los dos.
MAX_CONTENT_LENGTH = entorno_entero('MAX_CONTENT_LENGTH_MB', 200) * 1024 * 1024

# Tiempo que sobreviven los archivos de una sesión sin actividad.
SESSION_TTL_SECONDS = entorno_entero('SESSION_TTL_MINUTES', 120) * 60

# Cuánto puede acumular una sola sesión. Con el tope de subida en 200 MB, esto
# es lo que evita que alguien repita la subida veinte veces y se lleve el disco
# por delante. Los resultados cuentan: un PDF a 300 ppp pesa mucho más que su
# original.
SESSION_QUOTA_MB = entorno_entero('SESSION_QUOTA_MB', 1024)

# Espacio que nunca se toca. El volumen vive en el disco de la máquina, donde
# hay más cosas: quedarse sin sitio no rompe sólo esta aplicación, rompe todo lo
# que haya al lado. Al acercarse, se desalojan las sesiones más viejas.
DISK_RESERVE_MB = entorno_entero('DISK_RESERVE_MB', 1024)

# Una sesión con actividad reciente no se desaloja nunca, aunque haga falta
# sitio: alguien está trabajando con ella.
SESION_PROTEGIDA_SEGUNDOS = entorno_entero('SESSION_PROTECTED_MINUTES', 10) * 60

# Cada cuánto se pasa el recolector de sesiones caducadas.
CLEANUP_INTERVAL_SECONDS = entorno_entero('CLEANUP_INTERVAL_MINUTES', 15) * 60

# Autoridad de sellado de tiempo para "Firmar con certificado".
#
# Sólo se usa cuando el usuario marca la casilla: sella la firma con la hora de
# un tercero, de modo que siga verificándose cuando su certificado caduque. Lo
# único que viaja hasta aquí es un resumen (hash) de la firma; el documento no
# sale de esta máquina. Es la única llamada saliente de todo el backend.
TSA_URL = os.environ.get('TSA_URL', 'https://freetsa.org/tsr')
TSA_TIMEOUT = entorno_entero('TSA_TIMEOUT_SECONDS', 15)
