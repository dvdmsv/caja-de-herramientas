# Aplicación de escritorio para Windows

La misma caja de herramientas, instalable en Windows 10 y 11 y funcionando sin
servidor: los documentos no salen del equipo. **Vive sólo en la rama
`escritorio`**; `master` es la web y no sabe nada de esto.

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

**Lo que sabe cada parte.** Tauri sólo arranca, enseña y mata. Dónde está cada
programa externo y qué variables necesita lo decide el backend
(`backend/escritorio.py`), porque así se prueba con el barrido de la CI sin
pasar por Rust. El frontend sólo se entera de que va dentro de la aplicación
para dos cosas (`frontend/src/app/core/escritorio.ts`): guardar con el diálogo
de Windows y recibir lo abierto con «Abrir con…».

## Compilar

Todo esto lo hace la CI (`.github/workflows/escritorio.yml`) en cada push a la
rama, y es la forma recomendada: en un Windows limpio, sin nada instalado que
se cuele en el resultado. El instalador sale como artefacto de la ejecución.

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

1. Subir la versión en `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
2. `git tag v0.2.0 && git push origin v0.2.0` (desde la rama `escritorio`).

La CI hace lo de siempre y, si todo pasa, publica en Releases el instalador y el
`latest.json` que leen las instalaciones existentes. Si la etiqueta no coincide
con la versión, se para. La aplicación pregunta al arrancar si hay una nueva y,
si se acepta, se reinstala sola.

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

## Traer lo nuevo de la web

Las dos ramas van separadas a propósito. Lo que se hace en `master` se replica
aquí con un merge, **siempre en este sentido**:

```bash
git switch escritorio
git merge master
git push            # la CI de Windows lo prueba todo, instalador incluido
```

Casi siempre entra solo. Los conflictos, si los hay, salen en los archivos de la
web que esta rama también toca, y la regla para resolverlos es la misma en
todos: **quedarse con lo de `master` y volver a poner encima lo de escritorio**,
que son añadidos pequeños y sin efecto en la web.

| Archivo | Lo que añade esta rama |
|---|---|
| `backend/api/conversion.py` | `resolver()`, `entorno_de_programas()`, `murio_por_fallo()`, UTF-8, `CREATE_NO_WINDOW` y `taskkill` al cancelar |
| `backend/api/progreso.py` | `_insistiendo()` alrededor de `os.replace` y `os.unlink` |
| `backend/api/limites.py` | el `hasattr(signal, 'SIGALRM')` de `PlazoMaximo` |
| `backend/api/ocrmypdf.py` | el registro guarda el final de la salida, no el principio |
| `backend/api/tools/documento_a_pdf.py` | el perfil de LibreOffice como `Path.as_uri()` |
| `backend/app.py`, `backend/config.py` | el modo escritorio cuando hay `ESCRITORIO_TOKEN` |
| `frontend/src/app/core/api.service.ts` | `descargar()` pasa por `EscritorioService.guardar()` |
| `frontend/src/app/app.component.ts`, `pages/home/home.component.ts` | recoger lo abierto con «Abrir con…» |
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

## Lo que falta por comprobar a mano

La CI instala, arranca, mata la aplicación y desinstala, pero no puede tocar la
interfaz. En un Windows limpio (Windows Sandbox vale, y es justo donde se vería
si falta el runtime de Visual C++):

- guardar un resultado con el diálogo «Guardar como»;
- abrir un PDF con «Abrir con…», con la aplicación cerrada y con ella abierta;
- firmar con AutoFirma: el protocolo `afirma://` tiene que salir de la ventana y
  lanzar AutoFirma;
- una actualización de una versión a la siguiente.
