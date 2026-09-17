# Ajustar la aplicación a la máquina que tengas

Guía de despliegue: qué tocar cuando esto va a correr en un VPS pequeño, en un
servidor holgado o en algo intermedio. La referencia variable por variable está
en [`.env.example`](../.env.example); aquí están las **recetas** y el porqué.

**Si sólo lees un párrafo:** son tres servicios, y cada uno mira **su propio
contenedor**, no la máquina. Al arrancar le pregunta al cgroup cuántos núcleos y
cuánta memoria tiene y se ajusta a eso. Como el `docker-compose.yml` le pone
topes, mudarse a un servidor el doble de grande **no cambia nada** hasta que
subes esos topes. Son la primera palanca.

---

## Los tres servicios

| Servicio | Qué atiende | Tope de serie | En reposo |
|---|---|---|---|
| `web` | subidas, descargas, ZIP, sesión | 256m | 58 MB |
| `ligeros` | vistas previas, inspecciones, formatos, QR | 640m | 85 MB |
| `pesados` | OCR, ofimática, rasterizado, firma, compresión | 2048m | 82 MB |

`web` usa hilos, porque su trabajo es esperar al disco. Los otros dos atienden
**cada petición en un proceso que muere al terminar**, con sus propios límites de
memoria y de CPU: así un trabajo desbocado no se lleva por delante al de al
lado, y la memoria vuelve entera aunque PyMuPDF no la suelte.

## Cómo decide el proyecto

```
trabajos a la vez = min( núcleos , (tope_MB − 256 de maestro) / memoria_por_trabajo , tope del perfil )
```

Con los valores de serie: `pesados` saca **2 trabajos de 768 MB** y `ligeros`,
**2 de 192 MB**. Lo elegido queda dicho en el log, que es la primera cosa que
mirar tras cualquier cambio:

```bash
docker compose logs pesados | grep "trabajos a la vez"
# Servicio "pesados": 4 núcleos, 2048 MB de tope -> 2 trabajos a la vez,
# 768 MB y 300 s de CPU por trabajo, salida máxima 512 MB.
```

Los 768 MB por trabajo no son un número redondo. Medido con `ulimit -d` dentro
del contenedor: LibreOffice convierte con 384 MB, pero **pdf2docx necesita 768**
—arrastra OpenCV y numpy— y por debajo se cae con violación de segmento. Los
programas externos heredan el límite del proceso que los lanza, así que quedarse
corto no da un error de memoria: da un proceso muerto a mitad.

---

## Receta 1 · Máquina ligera (1–2 núcleos, 1–2 GB)

Un VPS mínimo, o esto compartiendo servidor con otras cosas.

```bash
# .env
WEB_MEM_LIMIT=192m
LIGEROS_MEM_LIMIT=448m        # 1 vista previa a la vez
PESADOS_MEM_LIMIT=1024m       # 1 trabajo pesado a la vez
WEB_CPUS=0.5
LIGEROS_CPUS=0.5
PESADOS_CPUS=1.0
OCR_JOBS=1
MAX_CONTENT_LENGTH_MB=50
SESSION_QUOTA_MB=256
```

Sale **un trabajo pesado a la vez**, que es justo lo que cabe. El resto de la
web sigue respondiendo mientras ese trabajo ocupa su proceso.

## Receta 2 · Máquina normal (4 núcleos, 4–8 GB)

Lo que trae el proyecto de serie. No hace falta `.env`.

Si además la máquina es sólo para esto, la palanca es `PESADOS_MEM_LIMIT`: con
`2816m` salen tres trabajos pesados a la vez en lugar de dos.

## Receta 3 · Máquina potente (8+ núcleos, 16+ GB)

```bash
# .env
WEB_MEM_LIMIT=512m
WEB_THREADS=8
LIGEROS_MEM_LIMIT=1536m       # 3 vistas previas (tope del perfil)
PESADOS_MEM_LIMIT=4096m       # 4 trabajos pesados
LIGEROS_CPUS=4.0
PESADOS_CPUS=8.0
MAX_CONTENT_LENGTH_MB=500     # sube también client_max_body_size en nginx.conf
SESSION_QUOTA_MB=4096
DISK_RESERVE_MB=4096
```

`ligeros` no pasa de 3 trabajos y `pesados` de 4 por perfil: si quieres más,
están en `PERFILES_TRABAJO`, en `backend/config.py`, con el porqué al lado.

---

## Ajustar por uso, no sólo por hierro

Dos máquinas iguales quieren ajustes distintos según lo que se use.

| Si lo que más usas es… | Sube | Baja |
|---|---|---|
| OCR de escaneados largos | `OCR_JOBS`, `OCR_TIMEOUT_SECONDS`, `PESADOS_TIMEOUT` | — |
| Word → PDF en lotes | `PESADOS_MEM_LIMIT` (más trabajos a la vez) | `OCR_JOBS` |
| El visor, unir, comprimir, firmar | `WEB_THREADS`, `LIGEROS_MEM_LIMIT` | `PESADOS_MEM_LIMIT`: sin ofimática, 512 MB por trabajo sobran |
| Vistas previas (deslizadores) | `LIGEROS_MEM_LIMIT`, `LIGEROS_CPUS` | — |
| Varias personas a la vez | `PESADOS_MEM_LIMIT`, `WEB_THREADS` | `OCR_JOBS`, para que un OCR no se coma todos los núcleos |

---

## Las dos cuentas que hay que hacer a mano

**Memoria de un servicio de trabajo.**

```
memoria ≈ 256 MB de maestro + trabajos_a_la_vez × memoria_por_trabajo
```

Con los valores de serie, `pesados` en su peor momento son 256 + 2 × 768 ≈
1,8 GB, y su tope está en 2 GB. Es un tope, no una reserva: en reposo son 82 MB.

**Suma de los tres, más el frontend.** Los topes de serie suman 256 + 640 + 2048
+ 256 = 3,2 GB. Si la máquina tiene menos, o hay vecinos, baja `PESADOS_MEM_LIMIT`
primero: es el único que puede crecer de verdad.

---

## La cadena de plazos

Un trabajo largo pasa por cuatro relojes, y **el más corto es el que manda**:

```
plazo de la herramienta  (OCR 240 s, PDF a Word 240 s, rasterizar 180 s, Markdown 120 s)
          <  plazo del servicio  (PESADOS_TIMEOUT, 300 s)
          <  proxy_read_timeout / proxy_send_timeout de nginx  (300 s)
          <  el proxy inverso que pongas delante para el TLS
```

Hoy el más apurado es el OCR: 240 contra 300. **Si subes `OCR_TIMEOUT_SECONDS`
tienes que subir también `PESADOS_TIMEOUT` y los dos tiempos de
`frontend/nginx.conf`**, o nginx cortará la respuesta antes y el usuario verá un
error feo en lugar de uno explicado.

Hay un quinto reloj que no es un plazo sino un descarte: `REQUEST_MAX_AGE_SECONDS`
(60 s). Una petición que ha esperado más que eso en la cola se responde con un
503 sin empezar a trabajar, porque quien la mandó casi seguro que ya no está.

---

## Trampas conocidas

- **Los límites los heredan los programas externos.** `PESADOS_JOB_MEMORY_MB`
  acota también a LibreOffice, Ghostscript, tesseract y pdf2docx. Si bajas ese
  número, lo primero que se rompe es «PDF a Word», y se rompe con un proceso
  muerto, no con un error de memoria.
- **El autodimensionado sólo entiende cgroup v2** (`/sys/fs/cgroup/cpu.max` y
  `memory.max`). En un anfitrión con cgroup v1 —Docker antiguo, algún VPS— no
  encuentra esos archivos y cae a los núcleos y la memoria del anfitrión, que con
  un tope puesto es mentira y sobredimensiona. Compruébalo con la línea del log:
  si dice más de lo que le has puesto al contenedor, fija `PESADOS_TRABAJOS`,
  `LIGEROS_TRABAJOS` y `OCR_JOBS` a mano.
- **El tamaño de subida vive en tres sitios** y manda el más bajo:
  `MAX_CONTENT_LENGTH_MB`, el `client_max_body_size` de `frontend/nginx.conf`
  (200M) y el del proxy inverso, si lo hay.
- **Al añadir una ruta auxiliar barata hay que añadirla al reparto de nginx**, o
  la atenderá `pesados` y hará cola detrás de un OCR. Y ojo con el orden: un
  prefijo con `^~` gana a las expresiones regulares aunque éstas se declaren
  antes, y por eso `/api/tools/` es un prefijo normal.
- **Una variable mal escrita no avisa.** Un valor que no sea un número sí (lo
  dice por el log y sigue con el de por defecto), pero un nombre mal tecleado
  simplemente no se aplica. Para comprobarlo:
  `docker compose config | grep NOMBRE_DE_LA_VARIABLE`.
- **Los cambios del `.env` no necesitan reconstruir la imagen**, sólo
  `docker compose up -d`. El `--build` es sólo cuando cambia el código o las
  dependencias.
- **`python app.py` no representa esto.** Registra los tres papeles en un solo
  proceso para poder desarrollar: ahí no hay aislamiento, y el semáforo de
  `api/conversion.py` —que en producción no reparte nada— es lo único que evita
  que cuatro hilos arranquen cuatro LibreOffice.

---

## Cómo saber si has acertado

```bash
# Con qué ha arrancado cada servicio
docker compose logs web ligeros pesados | grep -E "trabajos a la vez|Máquina detectada"

# Qué está consumiendo de verdad
docker stats --no-stream

# Quién atiende cada ruta
docker compose logs pesados | grep "POST /api/tools"
```

Señales de que te has quedado corto:

- **429 al usar dos pestañas**: `limit_conn` de nginx, tres trabajos por IP.
- **503 «el servidor está saturado»**: la cola tarda más de
  `REQUEST_MAX_AGE_SECONDS`. Sube `PESADOS_MEM_LIMIT` para tener más trabajos.
- **413 «se ha quedado sin memoria»** en «PDF a Word»: sube
  `PESADOS_JOB_MEMORY_MB` (y el tope del contenedor, o cabrán menos trabajos).
- **413 con medidas** («la página mide 10416×10416 píxeles»): eso no es la
  máquina, es el documento. Si de verdad quieres rasterizar carteles, sube
  `MAX_IMAGE_MEGAPIXELS` **y** la memoria por trabajo.
