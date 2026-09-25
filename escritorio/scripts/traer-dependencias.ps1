<#
.SYNOPSIS
  Prepara escritorio\vendor\ con los programas externos que van dentro del
  instalador: Tesseract, Ghostscript, LibreOffice, Pango (para WeasyPrint) y las
  letras de "Markdown a PDF".

.DESCRIPTION
  Es lo que en la imagen de Docker hace el `apt-get install` del Dockerfile, y
  por eso las versiones y los recortes son los mismos siempre que se puede.

  Todo lo que se descarga va **fijado y con su suma SHA-256**: si alguien cambia
  un archivo en origen, el script se para en vez de meter otra cosa en el
  instalador sin que nadie se entere.

  Se ejecuta en la máquina que compila (la CI de Windows), no en la del usuario.
  **Nada se instala: todo se extrae.** Tesseract y Ghostscript son instaladores
  NSIS y 7-Zip los abre como un archivo cualquiera; LibreOffice es un MSI y
  `msiexec /a` lo desempaqueta. Instalarlos en silencio parecía más fiable y no
  lo es: el de Ghostscript lanza dentro el instalador del runtime de Visual C++
  y se quedó colgado una hora en la CI. Y el de Tesseract descarga los idiomas
  durante la instalación, así que los idiomas van aquí, fijados como lo demás.

  Pango no tiene un paquete fijado como los demás: sale de MSYS2 (el runner de
  GitHub ya lo trae en C:\msys64) y se copian sólo las DLL que WeasyPrint abre y
  las que éstas necesitan, calculadas con `ntldd`. Es lo único de aquí cuya
  versión la decide MSYS2 el día que se compila; `vendor\VERSIONES.txt` la deja
  escrita.

.PARAMETER Destino
  Carpeta vendor\. Por defecto, la de al lado de este script.

.PARAMETER Descargas
  Dónde se guardan las descargas, para no repetirlas (la CI la cachea).
#>
# PowerShell 7: usa `-Encoding utf8NoBOM` y `Kill($true)`, que la 5.1 de
# Windows no tiene. Y el archivo va con BOM para que la 5.1 al menos lo lea
# como UTF-8 y avise de esto, en vez de tropezar con una raya o una tilde.
#Requires -Version 7

param(
  [string]$Destino = (Join-Path $PSScriptRoot '..\vendor'),
  [string]$Descargas = (Join-Path $PSScriptRoot '..\descargas'),
  [string]$Msys = 'C:\msys64'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # sin esto Invoke-WebRequest va diez veces más lento

# --- Qué se descarga ---------------------------------------------------------
#
# Al subir una versión: cambiar la URL, descargarla, `Get-FileHash` y pegar la
# suma. Y comprobar en la CI que el barrido sigue en verde.
$Paquetes = @{
  tesseract = @{
    url = 'https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe'
    sha = 'bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4'
  }
  # Los idiomas, de tessdata_fast como los paquetes tesseract-ocr-eng y -spa de
  # Debian. El instalador no los trae dentro: los descarga al instalar.
  ingles = @{
    url = 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata'
    sha = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'
  }
  espanol = @{
    url = 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/spa.traineddata'
    sha = '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464'
  }
  ghostscript = @{
    url = 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/gs10080w64.exe'
    sha = '52a91b8bf09298788d7a57b9206127026c23eacd75405f0a131e26dc381dce50'
  }
  # El archivo permanente y no /stable/: ahí sólo están las dos últimas
  # versiones y la URL dejaría de existir en unos meses.
  libreoffice = @{
    url = 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.6.3/win/x86_64/LibreOffice_26.2.6.3_Win_x86-64.msi'
    sha = 'f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660'
  }
  inter = @{
    url = 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip'
    sha = '9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e'
  }
  # La 6.200 y no la 7: en la 7 la familia pasó a llamarse "Charis", y la hoja
  # de estilo de markdown_a_pdf.py la pide como 'Charis SIL'. Es también la
  # versión de fonts-sil-charis en Debian.
  charis = @{
    url = 'https://github.com/silnrsi/font-charis/releases/download/v6.200/CharisSIL-6.200.zip'
    sha = '4b09aa75760b8aa697b762c34afb995dde0754c8f09256cb912dbfc478c97ade'
  }
  dejavu = @{
    url = 'https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip'
    sha = '7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a'
  }
}

# Las DLL que abre WeasyPrint (weasyprint/text/ffi.py). Con ellas se calcula el
# resto de lo que hay que copiar.
$DllsDeWeasyPrint = @(
  'libgobject-2.0-0.dll', 'libpango-1.0-0.dll', 'libpangoft2-1.0-0.dll',
  'libharfbuzz-0.dll', 'libharfbuzz-subset-0.dll', 'libfontconfig-1.dll'
)

function Traer([string]$nombre) {
  $paquete = $Paquetes[$nombre]
  $archivo = Join-Path $Descargas ([IO.Path]::GetFileName($paquete.url))
  if (-not (Test-Path $archivo)) {
    Write-Host "Descargando $nombre..."
    Invoke-WebRequest $paquete.url -OutFile "$archivo.parcial"
    Move-Item "$archivo.parcial" $archivo
  }
  $suma = (Get-FileHash $archivo -Algorithm SHA256).Hash.ToLower()
  if ($suma -ne $paquete.sha) {
    Remove-Item $archivo
    throw "La suma de $nombre no coincide: esperaba $($paquete.sha) y es $suma. " +
          'Si la versión ha cambiado a propósito, actualiza la suma en este script.'
  }
  return $archivo
}

function Esperar([string]$programa, [string[]]$argumentos, [int]$minutos = 15) {
  # Con plazo: un programa que se cuelga no puede dejar la CI una hora parada
  # sin decir nada, que es lo que pasó con el instalador de Ghostscript.
  $proceso = Start-Process $programa -ArgumentList $argumentos -PassThru -NoNewWindow
  if (-not $proceso.WaitForExit($minutos * 60 * 1000)) {
    $proceso.Kill($true)
    throw "$programa no ha terminado en $minutos minutos."
  }
  if ($proceso.ExitCode -ne 0) { throw "$programa salió con $($proceso.ExitCode)" }
}

$SieteZip = 'C:\Program Files\7-Zip\7z.exe'
function Extraer([string]$instalador, [string]$carpeta) {
  Esperar $SieteZip @('x', '-y', "-o$carpeta", "`"$instalador`"") | Out-Null
  # Lo que es del instalador y no del programa.
  Remove-Item (Join-Path $carpeta '$PLUGINSDIR') -Recurse -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force $Descargas | Out-Null
# Rutas absolutas y sin `..`: msiexec no abre un paquete con una ruta relativa
# o con saltos atrás (sale con 1619, "no se puede abrir el paquete").
$Descargas = [IO.Path]::GetFullPath($Descargas)
$Destino = [IO.Path]::GetFullPath($Destino)
if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
New-Item -ItemType Directory -Force $Destino | Out-Null
$licencias = New-Item -ItemType Directory -Force (Join-Path $Destino 'licencias')

# --- Tesseract -----------------------------------------------------------------
$tesseract = Join-Path $Destino 'tesseract'
Extraer (Traer 'tesseract') $tesseract
Copy-Item (Traer 'ingles') (Join-Path $tesseract 'tessdata\eng.traineddata')
Copy-Item (Traer 'espanol') (Join-Path $tesseract 'tessdata\spa.traineddata')
# Sólo hace falta tesseract.exe y sus DLL. Sobran las herramientas de
# entrenamiento (son otros .exe), sus manuales en HTML, el visor en Java y la
# documentación.
Get-ChildItem $tesseract -File | Where-Object {
  ($_.Extension -eq '.exe' -and $_.Name -ne 'tesseract.exe') -or $_.Extension -eq '.html'
} | Remove-Item
Get-ChildItem (Join-Path $tesseract 'tessdata') -Filter '*.jar' | Remove-Item
Remove-Item (Join-Path $tesseract 'doc') -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $tesseract -Filter '*.nsis' | Remove-Item
# La licencia se escribe a mano: el instalador no la trae como archivo.
"Tesseract OCR 5.5.3 — Apache License 2.0`nhttps://github.com/tesseract-ocr/tesseract/blob/main/LICENSE" |
  Set-Content (Join-Path $licencias 'tesseract.txt') -Encoding utf8NoBOM

# --- Ghostscript -----------------------------------------------------------------
$gs = Join-Path $Destino 'gs'
Extraer (Traer 'ghostscript') $gs
Remove-Item (Join-Path $gs 'doc'), (Join-Path $gs 'examples'), (Join-Path $gs 'vcredist_x64.exe') `
  -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $gs -Filter '*.nsis' | Remove-Item
# Ghostscript está compilado con Visual C++ y necesita su runtime, que en un
# equipo limpio puede no estar: su instalador lo instalaba con vcredist_x64.exe.
# Aquí va junto al programa, que es como Microsoft permite redistribuirlo (lo
# que sí trae Windows 10 y 11 es la parte universal, las api-ms-win-crt-*).
foreach ($dll in 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll') {
  Copy-Item (Join-Path $env:SystemRoot "System32\$dll") (Join-Path $gs 'bin')
}
# Es AGPL, igual que este proyecto.
"Ghostscript 10.08 — GNU AGPL 3.0`nhttps://www.ghostscript.com/licensing/" |
  Set-Content (Join-Path $licencias 'ghostscript.txt') -Encoding utf8NoBOM

# --- LibreOffice -----------------------------------------------------------------
$extraido = Join-Path $env:TEMP 'libreoffice-extraido'
if (Test-Path $extraido) { Remove-Item $extraido -Recurse -Force }
Esperar 'msiexec.exe' -minutos 20 -argumentos @('/a', "`"$(Traer 'libreoffice')`"", '/qn', "TARGETDIR=`"$extraido`"")
# La instalación administrativa deja el árbol dentro de una o dos carpetas según
# la versión: se busca soffice.exe en vez de suponer dónde está.
$soffice = Get-ChildItem $extraido -Recurse -Filter 'soffice.exe' | Select-Object -First 1
if (-not $soffice) { throw 'No aparece soffice.exe en el MSI de LibreOffice.' }
$raizLibreOffice = $soffice.Directory.Parent.FullName
Move-Item $raizLibreOffice (Join-Path $Destino 'libreoffice')
$libreoffice = Join-Path $Destino 'libreoffice'
# Los mismos recortes que el Dockerfile: aquí sólo se le pide convertir a PDF
# sin interfaz. Y la ayuda, que en Windows va dentro.
foreach ($sobra in 'share\gallery', 'share\template', 'share\wizards', 'help', 'readmes') {
  Remove-Item (Join-Path $libreoffice $sobra) -Recurse -Force -ErrorAction SilentlyContinue
}
# La extracción administrativa saca **todas** las partes del MSI, no las que se
# instalan de serie: las traducciones de la interfaz a un centenar de idiomas,
# los diccionarios y las extensiones. Convertir a PDF sin interfaz no usa
# ninguna (en Debian cada una es un paquete aparte que no se instala). Se queda
# el español de la interfaz, por si algún mensaje llegara al registro.
Get-ChildItem (Join-Path $libreoffice 'program\resource') -Directory -ErrorAction SilentlyContinue |
  Where-Object Name -ne 'es' | Remove-Item -Recurse -Force
Remove-Item (Join-Path $libreoffice 'share\extensions') -Recurse -Force -ErrorAction SilentlyContinue
# De los juegos de iconos, sólo el de serie: sin interfaz no se pinta ninguno,
# pero LibreOffice espera encontrar el suyo al arrancar.
Get-ChildItem (Join-Path $libreoffice 'share\config') -Filter 'images_*.zip' |
  Where-Object Name -ne 'images_colibre.zip' | Remove-Item
# Qué ocupa lo que queda, para saber qué más recortar.
foreach ($nivel in (Get-ChildItem $libreoffice -Directory), (Get-ChildItem (Join-Path $libreoffice 'share'), (Join-Path $libreoffice 'program') -Directory)) {
  $nivel | ForEach-Object {
    [pscustomobject]@{ MB = [math]::Round((Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB); Carpeta = $_.FullName.Substring($libreoffice.Length) }
  } | Sort-Object MB -Descending | Select-Object -First 12 | Format-Table -AutoSize | Out-String | Write-Host
}
Copy-Item (Join-Path $libreoffice 'LICENSE*') $licencias -ErrorAction SilentlyContinue
# El mismo runtime de Visual C++ que Ghostscript. Instalado de verdad, el MSI lo
# pone en System32; extraído con `/a`, no, y en un equipo limpio no arrancaría.
foreach ($dll in 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll') {
  $destinoDll = Join-Path $libreoffice "program\$dll"
  if (-not (Test-Path $destinoDll)) {
    Copy-Item (Join-Path $env:SystemRoot "System32\$dll") $destinoDll
    Write-Host "LibreOffice no traía ${dll}: copiada."
  }
}
Remove-Item $extraido -Recurse -Force -ErrorAction SilentlyContinue

# --- Pango, de MSYS2 -------------------------------------------------------------
$bash = Join-Path $Msys 'usr\bin\bash.exe'
# En modo MINGW64: con el MSYS de serie, /mingw64/bin no está en el PATH de
# bash y no se encontraría ntldd.
$env:MSYSTEM = 'MINGW64'
$env:CHERE_INVOKING = '1'
& $bash -lc 'pacman -S --noconfirm --needed mingw-w64-x86_64-pango mingw-w64-x86_64-ntldd' | Out-Host
$binMsys = Join-Path $Msys 'mingw64\bin'
$gtk = New-Item -ItemType Directory -Force (Join-Path $Destino 'gtk\bin')
$lista = & $bash -lc "cd /mingw64/bin && ntldd -R $($DllsDeWeasyPrint -join ' ') 2>&1"
$lista | Select-Object -First 5 | Write-Host
# De la salida de ntldd se queda todo nombre de DLL que exista en la carpeta de
# MSYS2, sin fiarse de cómo escriba las rutas (con barras de un lado o del otro,
# en forma de Windows o de MSYS). Las de Windows —kernel32, ucrtbase…— no están
# ahí, y ésas ya las tiene cualquier equipo.
$dlls = @($DllsDeWeasyPrint) + @($lista | Select-String '[\w.+-]+\.dll' -AllMatches |
  ForEach-Object { $_.Matches.Value } |
  Where-Object { Test-Path (Join-Path $binMsys $_) }) | Sort-Object -Unique
if ($dlls.Count -le $DllsDeWeasyPrint.Count) {
  throw "ntldd no ha dado ninguna dependencia de Pango; su salida está arriba."
}
foreach ($dll in $dlls) { Copy-Item (Join-Path $binMsys $dll) $gtk }
$versionPango = (& $bash -lc 'pacman -Q mingw-w64-x86_64-pango').Trim()

# --- Letras y fontconfig ---------------------------------------------------------
$letras = New-Item -ItemType Directory -Force (Join-Path $Destino 'letras')
function Sacar([string]$zip, [hashtable]$quePonerDonde) {
  # Cada clave es un patrón de ruta dentro del zip; su valor, la carpeta o el
  # archivo de destino.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archivo = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($entrada in $archivo.Entries) {
      foreach ($patron in $quePonerDonde.Keys) {
        if ($entrada.FullName -like $patron) {
          $destino = $quePonerDonde[$patron]
          if (Test-Path $destino -PathType Container) { $destino = Join-Path $destino $entrada.Name }
          [IO.Compression.ZipFileExtensions]::ExtractToFile($entrada, $destino, $true)
        }
      }
    }
  } finally { $archivo.Dispose() }
}
# De Inter, las mismas seis caras que deja el Dockerfile.
Sacar (Traer 'inter') @{
  'extras/otf/Inter-Regular.otf' = $letras; 'extras/otf/Inter-Italic.otf' = $letras
  'extras/otf/Inter-SemiBold.otf' = $letras; 'extras/otf/Inter-SemiBoldItalic.otf' = $letras
  'extras/otf/Inter-Bold.otf' = $letras; 'extras/otf/Inter-BoldItalic.otf' = $letras
  'LICENSE.txt' = (Join-Path $licencias 'inter.txt')
}
Sacar (Traer 'charis') @{
  '*/CharisSIL-*.ttf' = $letras
  '*/OFL.txt' = (Join-Path $licencias 'charis-sil.txt')
}
# DejaVu Sans y Serif son el respaldo de la hoja de estilo; Mono, el código.
Sacar (Traer 'dejavu') @{
  '*/ttf/DejaVuSans.ttf' = $letras; '*/ttf/DejaVuSans-*.ttf' = $letras
  '*/ttf/DejaVuSerif.ttf' = $letras; '*/ttf/DejaVuSerif-*.ttf' = $letras
  '*/ttf/DejaVuSansMono*.ttf' = $letras
  '*/LICENSE' = (Join-Path $licencias 'dejavu.txt')
}

# Sólo nuestras letras, no las de Windows: así "Markdown a PDF" sale igual que
# en el contenedor, que tampoco tiene otras. Las rutas van relativas a este
# archivo (lo admite fontconfig), porque no se sabe dónde se instalará.
# LOCAL_APPDATA_FONTCONFIG_CACHE es un valor especial de fontconfig en Windows:
# la caché va a %LOCALAPPDATA%, que es escribible, y no junto al programa.
@'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir prefix="relative">letras</dir>
  <cachedir>LOCAL_APPDATA_FONTCONFIG_CACHE</cachedir>
</fontconfig>
'@ | Set-Content (Join-Path $Destino 'fonts.conf') -Encoding utf8NoBOM

# --- Qué ha quedado --------------------------------------------------------------
$versiones = @(
  "tesseract  $($Paquetes.tesseract.url)"
  "ghostscript $($Paquetes.ghostscript.url)"
  "libreoffice $($Paquetes.libreoffice.url)"
  "pango      $versionPango (MSYS2, $($dlls.Count) DLL)"
  "inter      $($Paquetes.inter.url)"
  "charis     $($Paquetes.charis.url)"
  "dejavu     $($Paquetes.dejavu.url)"
)
$versiones | Set-Content (Join-Path $Destino 'VERSIONES.txt') -Encoding utf8NoBOM
$versiones | Write-Host

foreach ($parte in Get-ChildItem $Destino -Directory) {
  $mb = (Get-ChildItem $parte.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Write-Host ('{0,-12} {1,6:N0} MB' -f $parte.Name, $mb)
}
