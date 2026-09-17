"""Ajustes de gunicorn, calculados a partir de la máquina.

Esto es un fichero de configuración de gunicorn, no un módulo de la aplicación:
gunicorn lo ejecuta al arrancar y se queda con las variables de aquí.

Existe para que el proyecto se despliegue bien afinado **sin que nadie tenga que
escribir un `.env`**. Antes los valores venían fijos en el `CMD` del Dockerfile,
y eso obligaba a elegir uno: o prudente —y desaprovechar una máquina holgada— o
generoso, y reventar una pequeña. Preguntándoselo al cgroup no hay que elegir.

Todo se puede seguir fijando a mano con su variable de entorno, que manda sobre
lo calculado.
"""

# Con alias, y no `import config` a secas: gunicorn lee **todos** los nombres de
# este módulo como ajustes suyos, y `config` es uno de ellos (espera la ruta de
# un fichero). Importarlo con su nombre aborta el arranque con
# "Invalid value for config: <module ...>".
import config as ajustes

bind = '0.0.0.0:5000'

# Procesos: los que quepan en la memoria del contenedor, sin pasar de los
# núcleos que haya. El cálculo y su porqué están en `config.py`.
workers = ajustes.entorno_entero('GUNICORN_WORKERS', ajustes.workers_recomendados())

# Hilos por proceso. Aquí casi todo el trabajo es esperar a que termine un
# programa externo o a que el disco escriba, así que los hilos salen baratos:
# no compiten por CPU, sólo ocupan la memoria de la petición que llevan.
threads = ajustes.entorno_entero('GUNICORN_THREADS', 4)

# Plazo de una petición. Generoso a propósito: un OCR o una conversión de
# ofimática tardan minutos, y sus propios plazos (`OCR_TIMEOUT_SECONDS` y
# compañía) son más cortos que este para poder devolver un error entendible
# en vez de que gunicorn corte la respuesta a media frase.
timeout = ajustes.entorno_entero('GUNICORN_TIMEOUT', 300)

graceful_timeout = 30

# Registro de accesos por la salida estándar, que es de donde lo recoge Docker.
# Sin esto no hay forma de saber qué ruta atendió cada servicio ni cuánto tardó,
# que es lo primero que se busca cuando algo va lento.
accesslog = '-'
access_log_format = '%(h)s "%(r)s" %(s)s %(b)sB %(M)sms'

# Reciclar workers: PyMuPDF y pyHanko no devuelven al sistema toda la memoria
# que piden, así que un proceso muy usado se va hinchando. El desfase evita que
# todos se reinicien a la vez y dejen un hueco sin nadie atendiendo.
max_requests = 200
max_requests_jitter = 20


def post_fork(server, worker):
    """Cargar en el worker recién nacido lo que va a usar de todas formas.

    Sin esto, la primera petición que le toca a cada worker paga los imports:
    medido en el contenedor, `api.tipografia` tarda 212 ms en cargarse, y una
    llamada a marca-de-agua pasa de 220 ms la primera vez a 36 ms las
    siguientes. Con `max_requests` reciclando workers, ese peaje vuelve cada
    doscientas peticiones y lo paga siempre un usuario.

    Se precargan sólo las tres baratas y comunes —unos 360 ms entre las tres—
    que además comparten casi todas las herramientas. Las caras se quedan fuera
    a propósito: `markitdown` tarda 1,4 s y `pyhanko` 525 ms, pero sobre todo
    ocupan memoria que no tiene por qué pagar quien no usa esas herramientas.
    Eso es justo lo que buscan sus imports diferidos, y esto no lo deshace.

    No es `--preload`: allí se importaría antes del fork y los hilos de limpieza
    de `storage.py` no sobrevivirían. Aquí se importa **después**, ya en el
    worker, que es la diferencia que importa.
    """
    try:
        import fitz  # noqa: F401
        import PIL.Image  # noqa: F401
        from api import tipografia  # noqa: F401
    except Exception as fallo:  # pragma: no cover
        # Calentar es una optimización, no un requisito: si algo falla aquí, el
        # worker tiene que arrancar igual y pagar los imports cuando toque.
        worker.log.warning('No se pudo precalentar (%s); se cargará al vuelo.', fallo)


def on_starting(server):
    """Dejar dicho en el log con qué ha arrancado y por qué.

    Sin esto, un despliegue que se queda corto de workers no se distingue de uno
    bien ajustado: los dos funcionan, sólo que uno hace cola.
    """
    server.log.info(
        'Máquina detectada: %d núcleos, %d MB de memoria -> %d workers, %d hilos',
        ajustes.nucleos(), ajustes.memoria_mb(), workers, threads,
    )
