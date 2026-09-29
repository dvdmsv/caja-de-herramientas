# Aplicación de escritorio para Windows

La misma caja de herramientas, instalable en Windows 10 y 11 y funcionando sin
servidor: los documentos no salen del equipo. Vive en `master`, junto a la web:
comparten el backend y el frontend, y lo propio de la aplicación está en esta
carpeta y en unos pocos añadidos que en la web no hacen nada (ver «Lo que la
aplicación añade a la web»).

## Cómo está hecha

```
Caja de herramientas.exe  (Tauri, Rust, ventana de WebView2)
 ├─ arranque/index.html     pantalla mientras arranca el backend
 ├─ backend/merge-pdf-backend.exe   el backend de Flask empaquetado con PyInstaller,
 │                                  que sirve también el Angular compilado
 └─ vendor/                 Tesseract, Ghostscript, LibreOffice, Pango y letras
```

1. La ventana se abre enseguida con la pantalla de arranque.
2. Tauri lanza el backend con un token aleatorio, dentro de un *job object*
   que lo mata —a él y a lo que lance— si la aplicación se cierra, aunque sea de
   golpe.
3. El backend escribe `LISTO <puerto>` y la ventana navega a
   `http://127.0.0.1:<puerto>/?t=<token>`. El token pasa a una cookie y todo lo
   que no lo traiga, o traiga otro `Host`, recibe un 403.

**Cuánto puede gastar.** En la web, cada trabajo corre en un proceso con
límites de memoria y de CPU (`RLIMIT_*`, `gunicorn.trabajos.conf.py`). En Windows
eso no existe, y lo sustituye el mismo job object (`src-tauri/src/trabajo.rs`):

- **Prioridad por debajo de lo normal** para el backend y todo lo que lanza: el
  OCR usa todos los núcleos, pero cede en cuanto el usuario hace otra cosa.
- **Tope de memoria del conjunto**: el 60 % de la RAM, con un mínimo de 1,5 GB
  (`CAJA_TOPE_MEMORIA_MB` lo cambia; 0 lo quita). Medido en una VM con un tope de
  sólo 250 MB: pasa todo el barrido salvo LibreOffice, y el usuario lee «se ha
  quedado sin memoria… cierra otros programas», no un error genérico. Con 600 MB
  pasa entero.
- Siguen valiendo los topes de la web que dependen del documento (megapíxeles,
  tamaño descomprimido), el turno de un trabajo pesado a la vez y el plazo de los
  programas externos. Lo que **no** hay es plazo para lo que corre dentro del
  backend (en la web va con `SIGALRM`, que Windows no tiene): para eso está
  cancelar.

**Lo que sabe cada parte.** Tauri sólo arranca, enseña y mata. Dónde está cada
programa externo y qué variables necesita lo decide el backend
(`backend/escritorio.py`), porque así se prueba con el barrido de la CI sin
pasar por Rust. El frontend sólo se entera de que va dentro de la aplicación
para dos cosas (`frontend/src/app/core/escritorio.ts`): guardar con el diálogo
de Windows y recibir lo abierto con «Abrir con…».

## El aspecto del instalador

El icono del `setup.exe` (el de la aplicación con una flecha de descarga) y las
imágenes del asistente (`windows/lateral.bmp`, `windows/cabecera.bmp`) los dibuja
`scripts/generar-imagenes-instalador.py` con Pillow, a partir de los colores de
`icons/icon.png`. Se ejecuta a mano si cambia el icono, y lo generado se versiona:

```bash
python3 escritorio/scripts/generar-imagenes-instalador.py
```

Sin ellos, el instalador salía con el icono genérico de NSIS y parecía un
programa cualquiera.

## Compilar

Todo esto lo hace la CI (`.github/workflows/escritorio.yml`) en cada push a
`master` que toque código —también si sólo es de la web: la aplicación lleva el
mismo backend y el mismo frontend—, y es la forma recomendada: en un Windows limpio, sin nada instalado que
se cuele en el resultado. El instalador sale como artefacto de la ejecución.

**Dos modos de la CI.** En cada push, el instalador sale **sin comprimir** y el
Rust **sin LTO** (`src-tauri/tauri.rapido.json` y dos variables de Cargo): prueba
exactamente lo mismo, porque el contenido es igual, en unos 10–12 minutos. Sólo
al publicar (botón o etiqueta) se empaqueta como para repartir, con LZMA y LTO,
que es lo que tarda: medido, comprimir 1,25 GB son 8 minutos y compilar 3.
`vendor\` va cacheado ya preparado y sólo se rehace si cambia
`traer-dependencias.ps1`. Los cambios que sólo tocan `*.md` o `docs/` no lanzan
la CI de Windows, y un push nuevo cancela el anterior (una publicación, nunca).

A mano, en Windows (no en WSL), con PowerShell 7, Python 3.12, Node y Rust:

```powershell
./escritorio/scripts/traer-dependencias.ps1     # vendor\, ~500 MB de descargas
cd frontend; npm ci; npm run build; cd ..
cd backend; pip install -r requirements-escritorio.txt; cd ..
cd escritorio
pyinstaller backend.spec --noconfirm
Move-Item vendor dist\vendor
npm ci; npx tauri build                          # src-tauri\target\release\bundle\nsis\
```

Para desarrollar el backend en modo escritorio basta con
`python backend/escritorio.py`: escribe la URL con el token en el registro. Con
`ESCRITORIO_VENDOR` apunta a un vendor\ ya preparado; sin él usa los programas
del sistema.

## Publicar una versión

Con un botón: **Actions → «Publicar versión de escritorio» → Run workflow**,
eligiendo la rama `master` y qué número sube (parche por defecto:
0.1.0 → 0.1.1). O desde la terminal:

```bash
gh workflow run publicar-escritorio.yml            # parche
gh workflow run publicar-escritorio.yml -f tipo=menor
```

El botón sube el número en `tauri.conf.json`, `Cargo.toml` y `Cargo.lock`
(`scripts/subir_version.py`), hace el commit, crea la etiqueta y llama a
`escritorio.yml`, que lo prueba todo en Windows y, **sólo si pasa**, publica en
Releases el instalador (con su versión en el nombre y también como
`CajaDeHerramientas-setup.exe`), el `latest.json` del actualizador y las
novedades: los commits desde la versión anterior. Las instalaciones que ya hay
lo ofrecen al abrirse.

**Lo que ve quien actualiza**: al abrirla, un aviso dentro de la aplicación con
**lo que trae cada versión desde la suya** (también las que se haya saltado),
para que decida si le compensa: «Actualizar ahora», «Ahora no» (vuelve a
preguntar la próxima vez) y «Saltar esta versión» (no vuelve a avisar de ella;
se guarda en `ajustes.json`, `version_saltada`). Las novedades son **las notas de
cada release**, que la página pide a la API de GitHub (`core/novedades.ts`); si
no contesta, las de la última, que van en el `notes` de `latest.json`. O sea: el
tipo de cada commit (`feat`, `fix`) decide lo que lee la gente.

Para probar el aviso sin publicar dos versiones seguidas, `CAJA_ACTUALIZACIONES`
cambia de dónde se lee `latest.json`: basta uno que anuncie un número mayor con
el instalador y la firma de una release de verdad. La firma se sigue
comprobando, así que no abre ninguna puerta.

Al aceptar, una capa sobre la página con la descarga (porcentaje y MB) y la
misma barra en el icono de la barra de tareas, y la aplicación se vuelve a abrir
sola. Si la descarga falla, se dice y se sigue con la versión que hay. La capa
está en `src-tauri/src/actualizacion.js`. **Cuidado al probarlo**: lo que se ve
lo decide la versión que ya está instalada, no la nueva.

### Actualizar sin bajarlo todo: los paquetes

La instalación ocupa 1270 MB y el instalador son ~310 de descarga, pero una
versión normal sólo cambia nuestro backend, el frontend y el ejecutable de
Tauri: unos MB. LibreOffice, Tesseract y las bibliotecas de Python casi nunca.
Así que cada release publica además:

- **`archivos.json`**, el manifiesto: cada archivo que pone el instalador, con
  su SHA-256, más una huella de lo que sólo aplica NSIS (`ganchos.nsh`, iconos,
  imágenes y `tauri.conf.json` sin el número). Se queda para siempre en cada
  release: sin él, la siguiente no podría hacer paquete desde ésta.
- **Un paquete firmado por cada una de las 5 versiones anteriores**
  (`CajaDeHerramientas-cambios-desde-0.2.5.tar.gz`), con los archivos nuevos o
  distintos y `cambios.json`. `latest.json` los lista en `paquetes`, con su
  firma. Si la huella del instalador cambia desde una versión, **desde ésa no
  hay paquete**: las asociaciones de «Abrir con…» o el registro sólo los sabe
  poner NSIS.

Lo hace `scripts/paquetes.py`, con tests en `backend/tests/test_paquetes.py`. La
aplicación (`src-tauri/src/parche.rs`), si hay paquete para su versión exacta:

1. lo baja comprobando la firma con la clave del actualizador mientras llega, y
   lo abre comprobando el SHA-256 de cada archivo;
2. se copia a sí misma a `%LOCALAPPDATA%\merge-pdf\actualizacion\` y se lanza
   desde ahí con `--aplicar-actualizacion` (lo atiende `main()` antes de crear
   Tauri), y sale;
3. esa copia espera a que salga, pone cada archivo guardando el que sustituye,
   **quita todo lo que sobre en `backend\` y `vendor\`** —también los restos de
   las actualizaciones con el instalador, que nunca borraba nada—, cambia la
   versión en «Aplicaciones instaladas» y abre la nueva. **Si algo falla a
   mitad, devuelve lo guardado** y abre la de antes, que ofrece el instalador
   completo diciendo por qué.

Sin paquete para su versión (viene de más de 5 atrás, o el instalador cambió) o
si algo falla antes de tocar la instalación, el instalador completo de siempre.

**Nada se queda ocupando sitio.** Al arrancar se borra la carpeta de la
actualización entera y los instaladores que deja en `%TEMP%` el actualizador de
Tauri. Al publicar, la CI quita los paquetes de las releases anteriores, que ya
no enlaza nadie: en GitHub nunca hay más de 5. Y el desinstalador borra
`backend\` y `vendor\` enteras (`ganchos.nsh`), porque la plantilla de Tauri
sólo borra los archivos que conoce.

La primera versión que lo trae no se puede alcanzar por paquete —las anteriores
no tienen manifiesto—; las siguientes, sí. En cada push, la CI hace el
manifiesto, un paquete contra sí mismo que tiene que salir vacío, y aplica uno
de prueba sobre la aplicación instalada.

Si la prueba falla, el número se queda gastado (commit y etiqueta existen, la
release no): se arregla y se vuelve a pulsar, y sale el siguiente.

Crear la etiqueta a mano (`git tag v0.2.0 && git push origin v0.2.0`, con la
versión ya subida en los tres archivos) sigue funcionando igual.

El commit del número lo hace el bot directamente en `master`: si algún día se
protege la rama para exigir pull requests, hay que dejarle pasar.

El enlace para descargar la última, que es el que va en el README principal,
no cambia nunca:
<https://github.com/dvdmsv/caja-de-herramientas/releases/latest/download/CajaDeHerramientas-setup.exe>

**Las dos firmas, que no son lo mismo:**

- **La del actualizador** (minisign). La clave privada está en el secreto
  `TAURI_SIGNING_PRIVATE_KEY` de la CI y en `~/.tauri/caja-de-herramientas.key`
  del equipo de desarrollo; la pública, en `tauri.conf.json`. **Si se pierde la
  privada, las instalaciones que ya hay no aceptarán ninguna actualización**: hay
  que guardar una copia fuera de este equipo.
- **La de código (Authenticode)**, la que evita el aviso «Windows protegió su
  PC». Con SignPath Foundation, gratis para proyectos de código abierto. Hasta que
  el alta esté aprobada, el instalador sale sin firmar. Para activarla basta con
  el secreto `SIGNPATH_API_TOKEN` y las variables `SIGNPATH_ORGANIZATION_ID`,
  `SIGNPATH_PROJECT_SLUG` y `SIGNPATH_SIGNING_POLICY_SLUG` del repositorio: el
  paso de la CI se enciende solo. Firmar cambia los bytes del instalador, así que
  la CI vuelve a firmarlo para el actualizador después.

## Lo que la aplicación hace y la web no

- **Ajustes** (`pages/ajustes/`, con la disposición de la Configuración de
  Windows 11: menú lateral y una sección por pantalla, en `/ajustes#seccion`).
  Los guarda y los aplica `src-tauri/src/ajustes.rs`, dueño de
  `%LOCALAPPDATA%\merge-pdf\ajustes.json`: recorta cada valor a su rango al
  leerlo y sólo deja a la página tocar lo suyo (`ajustes::mezclar`).
  - **Guardado**: preguntar, junto al original o siempre en una carpeta. Sin
    diálogo nunca se sobrescribe (`escribir_sin_pisar`), y la carpeta fija sólo
    la pone el diálogo de Windows, nunca la página.
  - **Avisos**: la notificación al terminar, sí o no y desde cuántos segundos.
  - **Actualizaciones**: buscar al abrir, «Buscar ahora» y deshacer una versión
    saltada.
  - **Espacio**: cuándo se borran los archivos de trabajo —al cerrar la
    aplicación (de serie), tras 2 horas o tras 1 día sin usarlos; en la web
    son siempre 2 horas—, lo que ocupan y «Liberar», que no toca
    la sesión de la ventana que lo pide ni las usadas en los últimos minutos
    (`/api/escritorio/*` en `backend/escritorio.py`, que sólo existe aquí). El
    plazo se aplica al momento (`/api/escritorio/plazo`) y se guarda para el
    arranque (`ESCRITORIO_PLAZO`); los minutos de cada opción sólo los sabe
    `escritorio.PLAZOS`, y un test cruza sus nombres con Rust y la página. Si
    una actualización ha dejado algo, sale también: se borra solo al volver a
    abrir, pero no ocupa sitio sin que se sepa.
  - **Ayuda**: «Copiar información para soporte» (`soporte.rs`: versión,
    Windows, memoria, ajustes cambiados y el final del registro; sin nombres de
    archivo) y la carpeta de registros.
  - **Avanzado**: memoria máxima, prioridad baja, tamaño máximo de subida,
    espacio por ventana y servidor de sello de tiempo. **Se aplican al volver a
    abrir** (el job y las variables de entorno del backend se fijan al
    arrancar), con «Reiniciar ahora». Guardan `null` cuando están de serie: el
    valor lo sigue decidiendo quien lo aplica (`escritorio.preparar_entorno`,
    `trabajo.rs`). Los rangos están en `ajustes.rs` **y** en
    `core/ajustes-escritorio.ts`: si cambia uno, los dos.
- **Guardar con el diálogo de Windows**, proponiendo la carpeta del último
  archivo que llegó por «Abrir con…» o el menú del Explorador.
- **«Abrir con…»** del Explorador para los formatos del catálogo, sin hacerse
  programa predeterminado (lo registra el instalador, `windows/ganchos.nsh`).
- **Menú del Explorador** (clic derecho → «Caja de herramientas» → una acción),
  **desactivado de serie**: se activa y se eligen las acciones en **Ajustes**
  (`pages/ajustes/`). Qué acciones hay y sobre qué extensiones sale cada una lo
  decide `core/menu-contextual.ts` a partir del catálogo; lo escribe
  `src-tauri/src/menu.rs` en `HKCU\Software\Classes\SystemFileAssociations`.
  Con varios archivos seleccionados, el Explorador lanza un proceso por archivo:
  `main.rs` los agrupa si llegan seguidos y avisa a la página cuando paran, así
  «Unir PDF» se abre una vez con todos. En Windows 11 sale en «Mostrar más
  opciones»: el menú corto sólo admite paquetes MSIX.
- **Trabajos largos**: el progreso en el icono de la barra de tareas y, si el
  trabajo pasa de 10 s y la ventana no tiene el foco, una notificación de
  Windows al acabar.
- **Soltar archivos** en la ventana, como en la web (ver trampas).
- **Carpetas**: «Añadir una carpeta» en las colas que admiten varios (los
  archivos de esa carpeta que sirvan ahí, sin subcarpetas, hasta 500) y «Guardar
  todo en una carpeta» en los resultados: un diálogo y cada archivo suelto con su
  nombre, **sin sobrescribir** (`informe (1).pdf`). La página nunca da una ruta:
  `elegir_destino` guarda la carpeta en `main.rs`, por ventana, y
  `guardar_en_destino` sólo escribe ahí, con el nombre reducido a nombre de
  archivo (`nombre_de_archivo`). Junto con los lotes de la web (`unoPorUno`, ver
  `CLAUDE.md`) es «comprime todos los PDF de esta carpeta».
- **Varias ventanas**, como Word: cada «Abrir con…», cada acción del menú del
  Explorador y cada vez que se abre desde el menú Inicio sale una ventana nueva,
  y dentro hay Ctrl+N y el botón «Nueva ventana» de la barra. Son ventanas **de un mismo
  proceso y un mismo backend** (`src-tauri/src/ventanas.rs`), no copias de la
  aplicación: cada copia arrancaría su backend, y el segundo borraría al
  arrancar las sesiones del primero. Cada ventana lleva **su propia sesión**
  (`SessionService` usa `sessionStorage` en la aplicación), así que «Empezar de
  cero» en una no toca los archivos de otra. Los archivos que llegan se dejan
  para una ventana concreta (`Abiertos`, por etiqueta), y los de una misma
  selección van a la ventana del primero.

Al añadir un formato que el menú pueda ofrecer: a `EXTENSIONES` de
`core/menu-contextual.ts` **y** a `CAJA_MENU_EXTENSIONES` de `ganchos.nsh`, o el
desinstalador no lo limpiará.

## Lo que la aplicación añade a la web

Hasta la 0.1.4 la aplicación vivía en una rama aparte, `escritorio`, que traía
`master` con un merge. Se juntaron porque lo que la aplicación añade a la web es
poco y no hace nada allí, medido: la carpeta `escritorio/` no entra en ninguna
imagen de Docker (los contextos son `./backend` y `./frontend`),
`backend/escritorio.py` sólo se importa si hay `ESCRITORIO_TOKEN`, y el frontend
de la web carga 0,67 kB más con gzip. A cambio, un cambio de la web que rompa la
aplicación se ve en el mismo push, y no semanas después al traerlo.

Esto es lo que hay de la aplicación en los archivos de la web. **Al tocarlos,
que siga sin hacer nada fuera de ella**: en el backend, detrás de
`config.ESCRITORIO_TOKEN`; en el frontend, detrás de `puente()` /
`EscritorioService.activo`.

| Archivo | Lo que añade la aplicación |
|---|---|
| `backend/api/conversion.py` | `resolver()`, `entorno_de_programas()`, `murio_por_fallo()`, UTF-8, `CREATE_NO_WINDOW` y `taskkill` al cancelar |
| `backend/api/progreso.py` | `_insistiendo()` alrededor de `os.replace` y `os.unlink` |
| `backend/api/limites.py` | el `hasattr(signal, 'SIGALRM')` de `PlazoMaximo` |
| `backend/api/ocrmypdf.py` | el registro guarda el final de la salida, no el principio |
| `backend/api/tools/documento_a_pdf.py` | el perfil de LibreOffice como `Path.as_uri()` |
| `backend/app.py`, `backend/config.py` | el modo escritorio cuando hay `ESCRITORIO_TOKEN`, y `config.DONDE` |
| `backend/errors.py` | los mensajes de memoria dicen `config.DONDE` («este equipo» / «este servidor») |
| `frontend/src/app/core/api.service.ts` | `descargar()` pasa por `EscritorioService.guardar()` |
| `frontend/src/app/app.component.ts`, `pages/home/home.component.ts` | recoger lo abierto con «Abrir con…» |
| `frontend/src/app/app.component.html` | el aviso del pie cambia en la aplicación: allí no hay servidor ni caducidad de 2 h |
| `frontend/src/app/pages/acerca-de/` | la versión instalada, que sólo sabe la aplicación |
| `frontend/src/app/app.routes.ts` | la ruta `ajustes` (la página sólo sirve en la aplicación) |
| `frontend/src/app/app.component.html` | además, el enlace a Ajustes en el pie |
| `frontend/src/app/core/session.service.ts` | `sessionStorage` en vez de `localStorage` cuando hay puente: una sesión por ventana |
| `frontend/src/app/app.component.html` | además, el botón «Nueva ventana» de la barra, sólo en la aplicación |
| `frontend/src/app/shared/pagina-herramienta.ts` | `escritorio.progreso()` en `refrescarAvance()` y `avisarAlTerminar()` al acabar |
| `backend/tests/test_limites.py`, `test_arranque.py` | los `skipif` de Windows y el fallo nativo con `faulthandler` |
| `scripts/barrido.py` | la variable `TOKEN` |

Si una feature nueva lanza un programa externo con `subprocess` por su cuenta,
en vez de con `conversion.ejecutar`, en Windows abrirá una consola y no
encontrará el programa: hay que pasarla por `conversion.ejecutar`.

## Al añadir una herramienta

Si trae un **programa externo**, además de lo que dice `CLAUDE.md`:

- va en `scripts/traer-dependencias.ps1`, fijado y con su SHA-256;
- `escritorio.usar_vendor` le dice al backend dónde está (`RUTA_<PROGRAMA>` o
  `PATH_PROGRAMAS`), **nunca en el PATH del backend** (ver trampas);
- si trae un paquete de Python que carga plugins o datos por nombre, va en la
  lista de `backend.spec`. Si no, funcionará en desarrollo y fallará sólo
  instalado; el barrido contra el `.exe` de la CI es lo que lo detecta.

Si abre **formatos nuevos**, van también en la lista de `src-tauri/windows/ganchos.nsh`
para que aparezcan en «Abrir con…».

## Trampas, todas vistas en la CI

- **Cada comando propio de `main.rs` necesita su permiso en la capacidad.** La
  página la sirve el backend en 127.0.0.1, que para Tauri es un origen remoto, y
  ahí los comandos de la aplicación no se permiten solos: `build.rs` los declara
  (`AppManifest::commands`) y `capabilities/escritorio.json` concede cada
  `allow-<comando>` (con guiones). Sin eso Tauri contesta «not allowed by ACL» y,
  durante tres versiones, «Guardar» cayó en silencio a Descargas y «Abrir con…»
  no llegó nunca. Al añadir un comando: a las dos listas. `tauri-build` falla si
  la capacidad nombra un permiso que no existe, y la CI arranca la aplicación
  instalada con `CAJA_AUTOPRUEBA`: la propia página (`src/autoprueba.js`) llama a
  los comandos y deja lo que ha visto en un archivo. Desde fuera no se puede,
  porque el WebView2 de la CI ignora el puerto de depuración; en una VM sí, y
  `scripts/comprobar-puente.js` lo mira por ahí.
- **`disable_drag_drop_handler()` en la ventana.** Sin él, en Windows Tauri se
  queda con los archivos soltados y la página no recibe el `drop` de HTML. Por
  eso todas las ventanas salen de `ventanas::crear`, también las de un
  `target="_blank"` a la propia aplicación: dejar que WebView2 cree la suya
  daría una ventana sin eso ni las reglas de navegación.
- **Crear una ventana desde un manejador síncrono puede colgar la aplicación en
  Windows** (lo avisa Tauri: los comandos síncronos y el callback de
  `single-instance` corren en el hilo principal). Fuera de `setup`, siempre con
  `ventanas::crear_aparte`, que la crea desde otro hilo.

- **LibreOffice no puede ir en el PATH**: su carpeta `program` trae un
  `python.exe` propio que tapa a cualquier otro. Va por `RUTA_SOFFICE`.
- **Tesseract tampoco, ni Ghostscript**: Tesseract trae sus propias copias de
  las DLL de GTK (libgobject, libharfbuzz…) y WeasyPrint busca las suyas por
  nombre en el PATH; con Tesseract delante cargaba las suyas y el backend no
  arrancaba. Van en `PATH_PROGRAMAS`, que `conversion.ejecutar` sólo pone en el
  entorno de los programas que lanza.
- **Dentro del paquete de PyInstaller, WeasyPrint no encuentra Pango por su
  nombre**: el arranque del paquete cambia el orden de búsqueda de DLL y
  `add_dll_directory` no cuenta para la carga de cffi. `escritorio.precargar_gtk`
  las carga antes por su ruta.
- **El runtime de Visual C++**: Ghostscript y LibreOffice lo necesitan y en un
  Windows limpio puede no estar. Sus tres DLL van junto a cada programa (así lo
  permite redistribuir Microsoft). La CI no lo detectaría —el runner lo trae—:
  eso sólo se ve en un Windows recién instalado.
- **Nada se instala para preparar vendor\, todo se extrae**: el instalador de
  Ghostscript lanza dentro el del runtime y se quedó colgado una hora; el de
  Tesseract descarga los idiomas al instalar, así que extraído no trae ninguno y
  van fijados aparte. 7-Zip abre los instaladores NSIS; `msiexec /a` desempaqueta
  el MSI de LibreOffice, pero **con una ruta absoluta** (con `..` sale con 1619).
- **La extracción del MSI de LibreOffice saca todo**: traducciones a un centenar
  de idiomas, diccionarios, extensiones. 1,5 GB que se quedan en ~700 quitando lo
  que convertir a PDF no usa.
- **Charis SIL en la 6.200**: en la 7 la familia se llama «Charis» y la hoja de
  estilo de «Markdown a PDF» la pide como `'Charis SIL'`.
- **El runner de Windows mata al acabar cada paso lo que ese paso lanzó**: el
  backend y el barrido tienen que ir en el mismo paso.
- **`traer-dependencias.ps1` va con BOM**: sin él, Windows PowerShell 5.1 lo lee
  como cp1252, y el último byte de una raya en UTF-8 son unas comillas de cierre
  que cortan el texto. Se exige PowerShell 7 igualmente.
- **«Abrir con…» no usa `fileAssociations` de Tauri**, que escribe el valor por
  defecto de la extensión y podría hacerse programa predeterminado. Los ganchos
  del instalador sólo añaden una entrada a `OpenWithProgids`.
- **El actualizador usa el TLS de Windows**, no rustls: respeta los certificados
  y el proxy del sistema y no arrastra `ring`, que necesita compilar C.
- **Un ejecutable en marcha no se puede sobrescribir** (sí renombrar), y el
  backend tiene abiertas sus DLL. Por eso un paquete no lo aplica la aplicación
  sino una copia suya lanzada desde fuera de la carpeta de instalación, que
  espera a que salga. Y aun así, el backend muere con el job un momento después
  que la aplicación: `parche.rs` reintenta unos segundos los archivos que siguen
  abiertos antes de darlo por fallido.
- **Las carpetas `backend\` y `vendor\` quedan exactamente como dice el
  manifiesto** al aplicar un paquete: lo que no esté en él, se borra. Si algún
  día algo escribe dentro mientras funciona (una caché, un perfil), se lo
  llevaría cada actualización. La prueba de aplicar de la CI lista lo que sobra
  antes de aplicar, y ahí se vería.

## Lo que falta por comprobar a mano

La CI instala, arranca, mata la aplicación y desinstala, pero no puede tocar la
interfaz. En un Windows limpio (Windows Sandbox vale, y es justo donde se vería
si falta el runtime de Visual C++):

- guardar un resultado con el diálogo «Guardar como»;
- abrir un PDF con «Abrir con…», con la aplicación cerrada y con ella abierta;
- firmar con AutoFirma: el protocolo `afirma://` tiene que salir de la ventana y
  lanzar AutoFirma;
- una actualización de una versión a la siguiente, por paquete: la primera que
  se publique después de la que trae los paquetes.
