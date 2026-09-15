# Ajustar la aplicación a la máquina que tengas

Guía de despliegue: qué tocar cuando esto va a correr en un VPS pequeño, en un
servidor holgado o en algo intermedio. La referencia variable por variable está
en [`.env.example`](../.env.example); aquí están las **recetas** y el porqué.

**Si sólo lees un párrafo:** el backend no mira la máquina, mira **su
contenedor**. Al arrancar le pregunta al cgroup cuántos núcleos y cuánta memoria
tiene y se ajusta a eso. Como el `docker-compose.yml` le pone topes
(`BACKEND_MEM_LIMIT` y `BACKEND_CPUS`), mudarse a un servidor el doble de grande
**no cambia nada** hasta que subes esos dos números. Son la primera palanca.

---

## Cómo decide el proyecto

Al arrancar, `backend/config.py` calcula:

```
workers = min( núcleos , memoria_MB / 768 , 4 )      # mínimo 1
```

y cada worker atiende con **4 hilos**. Lo elegido queda dicho en el log, que es
la primera cosa que mirar después de cualquier cambio:

```bash
docker compose logs backend | grep "Máquina detectada"
# Máquina detectada: 4 núcleos, 1536 MB de memoria -> 2 workers, 4 hilos
```

Los tres números de la fórmula:

- **768 MB por worker.** No es lo que ocupa el worker —unos 300 MB con las
  bibliotecas cargadas— sino eso más el programa pesado que puede estar
  lanzando: un LibreOffice come entre 130 y 350 MB, y un OCR a cuatro núcleos,
  327 MB. El presupuesto cubre **uno** de esos por worker, y quien garantiza que
  no haya dos es el turno de `api/conversion.py`.
- **Los núcleos**, porque más procesos que núcleos sólo añade cambios de
  contexto.
- **El techo de 4**, que no lo pone la memoria: lo pone que esto es una
  herramienta de trabajo y no un servicio con miles de visitas. Pasado ese
  punto la concurrencia ya la dan los hilos. En una máquina grande hay que
  saltárselo **a mano**, y es una decisión consciente.

---

## Receta 1 · Máquina ligera (1–2 núcleos, 1–2 GB)

Un VPS mínimo, o esto compartiendo servidor con otras cosas.

```bash
# .env
BACKEND_MEM_LIMIT=768m      # con 2 GB de máquina: 1536m
BACKEND_CPUS=1.0            # los que tenga de verdad
OCR_JOBS=1
MAX_CONTENT_LENGTH_MB=50
```

Sale **1 worker con 4 hilos**: atiende varias peticiones a la vez y sólo una
pesada, que es justo lo que cabe.

`OCR_JOBS=1` no es opcional aquí. Por defecto son los núcleos que haya, y cuatro
procesos de Tesseract en un núcleo se estorban entre ellos y pasan de 180 a
327 MB para ir *más lento*. Con un núcleo, uno.

`MAX_CONTENT_LENGTH_MB=50` es por el disco, no por la memoria: los archivos
subidos viven dos horas en `backend/uploads/` y nadie impide a un usuario llenar
lo que haya. Acuérdate de bajar también el `client_max_body_size` de
`frontend/nginx.conf`, que manda el más bajo de los dos.

Si además usas «Documento a Markdown», sube la memoria a `1g`: markitdown se
carga la primera vez que se usa y añade unos 125 MB al worker hasta que se
recicla.

**Lo que no hay que hacer:** subir `GUNICORN_WORKERS` «por si acaso». Dos
workers en 768 MB no caben, y el resultado no es lentitud sino que el cgroup
mata el contenedor a mitad de un trabajo.

---

## Receta 2 · Máquina normal (4 núcleos, 4–8 GB)

El caso corriente: un VPS decente dedicado a esto.

```bash
# .env
BACKEND_MEM_LIMIT=3g
BACKEND_CPUS=4.0
```

Y ya está. Salen **4 workers × 4 hilos**, y con ellos 4 trabajos pesados
simultáneos, que es lo que da de sí la máquina. `OCR_JOBS` se calcula solo y
acierta.

Con 8 GB puedes subir `BACKEND_MEM_LIMIT` a `4g` para tener más colchón, pero no
saldrán más workers: el techo de 4 ya está tocando.

---

## Receta 3 · Máquina potente (8+ núcleos, 16+ GB)

Aquí el autodimensionado se queda corto a propósito y hay que decirle que no.

```bash
# .env
BACKEND_MEM_LIMIT=6g
BACKEND_CPUS=8.0
GUNICORN_WORKERS=6
OCR_JOBS=2
```

Seis workers a 768 MB son 4,6 GB; los 6 GB dejan margen para los picos. Con eso
hay **6 trabajos pesados a la vez** sin tocar `MAX_CONCURRENT_CONVERSIONS`.

`OCR_JOBS=2` puede sorprender en una máquina grande, y es el ajuste que más se
malentiende: multiplica. Seis workers, cada uno con un OCR de cuatro trabajos,
son 24 procesos de Tesseract peleándose por 8 núcleos. La cuenta sana:

```
OCR_JOBS ≈ núcleos / (GUNICORN_WORKERS × MAX_CONCURRENT_CONVERSIONS)
```

Si eres el único usuario y lo que quieres es que **tu** OCR acabe cuanto antes,
haz lo contrario: `GUNICORN_WORKERS=2` y `OCR_JOBS=8`. Menos trabajos a la vez,
cada uno más rápido. Es latencia contra rendimiento total, y no hay una
respuesta correcta sin saber cuál te importa.

**Lo que no hay que hacer:** subir `MAX_CONCURRENT_CONVERSIONS`. El semáforo
vive en cada proceso, así que ya se multiplica por los workers: ponerlo en 2 con
6 workers son 12 LibreOffice simultáneos, unos 4 GB sólo en eso.

---

## Ajustar por uso, no sólo por hierro

Dos servidores iguales quieren ajustes distintos según qué se use:

| Si lo que más usas es… | Sube | Baja |
|---|---|---|
| OCR de escaneados largos | `OCR_JOBS`, `OCR_TIMEOUT_SECONDS` | workers, si hace falta memoria |
| Word → PDF en lotes | `GUNICORN_WORKERS`, `DOC_TO_PDF_TIMEOUT_SECONDS` | — |
| El visor, unir, comprimir, firmar | `GUNICORN_THREADS` | `BACKEND_MEM_LIMIT`: sin ofimática ni OCR, 300 MB por worker sobran |
| Varias personas a la vez | `GUNICORN_WORKERS` | `OCR_JOBS` |

El cuarto caso es el que más gente confunde con «necesito más máquina». Si nadie
usa OCR ni ofimática, el consumo real es el del worker y los 768 MB de
presupuesto son pura reserva.

---

## Las dos cuentas que hay que hacer a mano

**Memoria.**

```
memoria ≈ workers × ( 300 MB + MAX_CONCURRENT_CONVERSIONS × 350 MB )
```

Con los valores por defecto: 1 worker son 650 MB, 2 son 1,3 GB, 6 son 3,9 GB.
Deja por encima un margen del 20–30 % para los picos y para markitdown.

**Trabajos pesados a la vez.**

```
simultáneos = GUNICORN_WORKERS × MAX_CONCURRENT_CONVERSIONS
```

Son los tres que arrancan un programa aparte: «Documento a PDF» (LibreOffice),
«PDF a Word» (pdf2docx) y «PDF con OCR» (ocrmypdf). Comparten un único turno
porque lo que se reparte es la memoria, y a la memoria le da igual quién se la
coma. A quien llega y lo encuentra ocupado se le dice que vuelva en un momento
en vez de dejarle esperando.

---

## La cadena de plazos

Un trabajo largo pasa por cuatro relojes, y **el más corto es el que manda**:

```
plazo de la herramienta  (OCR 240 s, PDF a Word 240 s, Documento a PDF 180 s)
          + espera del turno  (CONVERSION_QUEUE_TIMEOUT_SECONDS, 45 s)
          <  GUNICORN_TIMEOUT  (300 s)
          <  proxy_read_timeout / proxy_send_timeout de nginx  (300 s)
          <  el proxy inverso que pongas delante para el TLS
```

Hoy el más apurado es el OCR: 45 + 240 = 285 contra 300. **Si subes
`OCR_TIMEOUT_SECONDS` tienes que subir también `GUNICORN_TIMEOUT` y los dos
tiempos de `frontend/nginx.conf`**, o nginx cortará la respuesta antes y el
usuario verá un error feo en lugar de uno explicado.

---

## Trampas conocidas

- **El autodimensionado sólo entiende cgroup v2** (`/sys/fs/cgroup/cpu.max` y
  `memory.max`). En un anfitrión con cgroup v1 —Docker antiguo, algún VPS— no
  encuentra esos archivos y cae a los núcleos y la memoria del anfitrión, que
  con un `mem_limit` puesto es mentira y sobredimensiona. Compruébalo con la
  línea «Máquina detectada» del log: si dice más de lo que le has puesto al
  contenedor, fija `GUNICORN_WORKERS` y `OCR_JOBS` a mano.
- **El tamaño de subida vive en tres sitios** y manda el más bajo:
  `MAX_CONTENT_LENGTH_MB`, el `client_max_body_size` de `frontend/nginx.conf`
  (200M) y el del proxy inverso, si lo hay.
- **Una variable mal escrita no avisa.** Un valor que no sea un número sí (lo
  dice por el log y sigue con el de por defecto), pero un nombre mal tecleado
  simplemente no se aplica. Para comprobarlo:
  `docker compose config | grep NOMBRE_DE_LA_VARIABLE`.
- **Los cambios del `.env` no necesitan reconstruir la imagen**, sólo
  `docker compose up -d`. El `--build` es sólo cuando cambia el código o las
  dependencias.

---

## Cómo saber si has acertado

**Te has quedado corto** si aparece cola: peticiones que tardan y algún 503
«El servidor está ocupado procesando otro documento». Faltan workers, y para eso
memoria.

**Te has pasado** si el contenedor muere y Docker lo reinicia. Se ve así:

```bash
docker compose logs backend | grep -iE "killed|restart"
docker stats --no-stream        # el consumo acercándose al mem_limit
```

La prueba honesta antes de dar un despliegue por bueno es un **OCR de unas 60
páginas mientras miras `docker stats`**: es la operación más lenta y más golosa
de toda la aplicación, así que si eso cabe, cabe todo. Y si tienes varios
usuarios, lánzalo dos veces a la vez, que es cuando se ve si las cuentas de
arriba salen.
