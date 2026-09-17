"""Configuración de gunicorn para los servicios de trabajo (`ligeros`, `pesados`).

La idea: **un proceso desechable por petición**.

- `preload_app` hace que el maestro cargue la aplicación y sus bibliotecas una
  sola vez. Los hijos nacen por `fork`, así que comparten esa memoria sin
  copiarla mientras no la toquen.
- `workers` de tipo `sync` con `max_requests = 1`: cada hijo atiende una
  petición y muere. Al morir devuelve **toda** su memoria, incluida la que
  PyMuPDF o pyHanko no sueltan. Eso es lo que hace innecesario el reciclado cada
  doscientas peticiones del servicio `web`.
- `post_fork` le pone límites al hijo con `setrlimit`. Los heredan los programas
  externos que lance (LibreOffice, Ghostscript, tesseract), que es justo donde
  se va la memoria.
- Un trabajo que se pasa muere **solo él**: los demás siguen, y el contenedor no
  llega a su tope ni lo reinicia Docker.

El número de workers es el tope de trabajo simultáneo y la cola es el socket:
aquí no hay semáforo. `api/conversion.py` conserva el suyo sólo para
`python app.py`, donde todo corre en un proceso.
"""

import os
import resource
import sys

import config as ajustes

# `web` usa `gunicorn.conf.py`; aquí sólo se admiten los dos de trabajo.
PAPEL = os.environ.get('SERVICIO', 'pesados').strip().lower()
if PAPEL not in ajustes.PERFILES_TRABAJO:
    print(f'Aviso: SERVICIO={PAPEL!r} no es un servicio de trabajo; se usa "pesados".',
          file=sys.stderr)
    PAPEL = 'pesados'

_PERFIL = ajustes.PERFILES_TRABAJO[PAPEL]

bind = '0.0.0.0:5000'
worker_class = 'sync'
preload_app = True

# Una petición por proceso. `jitter` no aporta nada aquí: el reciclado no es una
# precaución periódica, es el funcionamiento normal.
max_requests = 1

workers = ajustes.entorno_entero('TRABAJOS_A_LA_VEZ', ajustes.workers_de_trabajo(PAPEL))

# Plazo del worker: la última red, por debajo de la cual cada herramienta tiene
# el suyo para poder contestar un error entendible. Aquí no hay `graceful`: un
# trabajo colgado hay que matarlo.
timeout = ajustes.entorno_entero('GUNICORN_TIMEOUT', _PERFIL['plazo'] or 300)
graceful_timeout = 5

# Registro de accesos por la salida estándar, que es de donde lo recoge Docker.
# Sin esto no hay forma de saber qué ruta atendió cada servicio ni cuánto tardó,
# que es lo primero que se busca cuando algo va lento.
accesslog = '-'
access_log_format = '%(h)s "%(r)s" %(s)s %(b)sB %(M)sms'

# --- límites del proceso hijo ---------------------------------------------

# Memoria. Se limita `RLIMIT_DATA` y **no** `RLIMIT_AS` a propósito: LibreOffice
# reserva muchísima memoria virtual que no llega a tocar, y con `RLIMIT_AS` no
# arranca. `DATA` limita lo que de verdad se pide al sistema.
MEMORIA_MB = ajustes.entorno_entero('JOB_MEMORY_MB', _PERFIL['memoria_mb'])

# CPU. Protege del bucle infinito que no pide memoria y que el plazo de gunicorn
# sí cortaría, pero más tarde y sin dejar rastro claro.
CPU_SEGUNDOS = ajustes.entorno_entero('JOB_CPU_SECONDS', _PERFIL['cpu_segundos'] or timeout)

# Tamaño máximo de un archivo escrito. Un resultado puede pesar más que su
# entrada —un PDF a 300 ppp son muchas imágenes—, de ahí el doble.
SALIDA_MB = ajustes.entorno_entero(
    'JOB_OUTPUT_MB', max(512, 2 * (ajustes.MAX_CONTENT_LENGTH // (1024 * 1024))))


def post_fork(server, worker):
    """Poner los límites en el hijo, ya separado del maestro.

    Tiene que ser aquí: en el maestro los heredarían todos y además lo matarían a
    él, que es quien tiene que seguir vivo para forkear el siguiente.
    """
    for recurso, valor, unidad in (
        (resource.RLIMIT_DATA, MEMORIA_MB * 1024 * 1024, 'memoria'),
        (resource.RLIMIT_FSIZE, SALIDA_MB * 1024 * 1024, 'tamaño de salida'),
        (resource.RLIMIT_CPU, CPU_SEGUNDOS, 'CPU'),
    ):
        try:
            blando, duro = resource.getrlimit(recurso)
            tope = valor if duro == resource.RLIM_INFINITY else min(valor, duro)
            resource.setrlimit(recurso, (tope, duro))
        except (ValueError, OSError) as fallo:
            # Sin límites se trabaja igual, sólo sin red: mejor decirlo que
            # dejar el worker sin arrancar.
            worker.log.warning('No se pudo limitar la %s (%s).', unidad, fallo)


def on_starting(server):
    server.log.info(
        'Servicio "%s": %d núcleos, %d MB de tope -> %d %s a la vez, '
        '%d MB y %d s de CPU por trabajo, salida máxima %d MB.',
        PAPEL, ajustes.nucleos(), ajustes.memoria_mb(), workers,
        'trabajo' if workers == 1 else 'trabajos', MEMORIA_MB, CPU_SEGUNDOS, SALIDA_MB,
    )
