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


# Carpeta raíz donde vive el almacenamiento temporal de todas las sesiones.
UPLOAD_ROOT = os.environ.get('UPLOAD_ROOT', 'uploads')

# Tamaño máximo de una petición completa (suma de todos los archivos).
# Ojo: nginx tiene su propio `client_max_body_size` y manda el más bajo de los dos.
MAX_CONTENT_LENGTH = entorno_entero('MAX_CONTENT_LENGTH_MB', 200) * 1024 * 1024

# Tiempo que sobreviven los archivos de una sesión sin actividad.
SESSION_TTL_SECONDS = entorno_entero('SESSION_TTL_MINUTES', 120) * 60

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
