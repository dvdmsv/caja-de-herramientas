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
  Por eso Tesseract y Ghostscript se instalan en silencio dentro de vendor\ con
  sus propios instaladores: es lo más fiable, y lo que dejen en el registro de
  esa máquina se tira con ella. LibreOffice se extrae con `msiexec /a`, que
  desempaqueta el MSI sin instalar nada.

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
  # El instalador trae inglés; el español, de tessdata_fast como el paquete
  # tesseract-ocr-spa de Debian.
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

function Esperar([string]$programa, [string[]]$argumentos) {
  $proceso = Start-Process $programa -ArgumentList $argumentos -Wait -PassThru -NoNewWindow
  if ($proceso.ExitCode -ne 0) { throw "$programa salió con $($proceso.ExitCode)" }
}

New-Item -ItemType Directory -Force $Descargas | Out-Null
if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
New-Item -ItemType Directory -Force $Destino | Out-Null
$Destino = (Resolve-Path $Destino).Path
$licencias = New-Item -ItemType Directory -Force (Join-Path $Destino 'licencias')

# --- Tesseract -----------------------------------------------------------------
$tesseract = Join-Path $Destino 'tesseract'
# /D tiene que ir el último y sin comillas: es como lo lee NSIS.
Esperar (Traer 'tesseract') @('/S', "/D=$tesseract")
Copy-Item (Traer 'espanol') (Join-Path $tesseract 'tessdata\spa.traineddata')
# Lo que no se usa: el desinstalador, la documentación y las herramientas de
# entrenamiento. Sólo hace falta tesseract.exe y sus DLL.
Remove-Item (Join-Path $tesseract 'uninstall.exe'), (Join-Path $tesseract 'doc') -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $tesseract -Filter '*.exe' | Where-Object Name -ne 'tesseract.exe' | Remove-Item
Copy-Item (Join-Path $tesseract 'LICENSE*') (Join-Path $licencias 'tesseract.txt') -ErrorAction SilentlyContinue

# --- Ghostscript ---------------------------------------------------------------
$gs = Join-Path $Destino 'gs'
Esperar (Traer 'ghostscript') @('/S', "/D=$gs")
Remove-Item (Join-Path $gs 'uninstgs.exe'), (Join-Path $gs 'doc'), (Join-Path $gs 'examples') -Recurse -Force -ErrorAction SilentlyContinue
# Es AGPL, igual que este proyecto.
Copy-Item (Join-Path $gs 'LICENSE') (Join-Path $licencias 'ghostscript.txt') -ErrorAction SilentlyContinue

# --- LibreOffice -----------------------------------------------------------------
$extraido = Join-Path $env:TEMP 'libreoffice-extraido'
if (Test-Path $extraido) { Remove-Item $extraido -Recurse -Force }
Esperar 'msiexec.exe' @('/a', "`"$(Traer 'libreoffice')`"", '/qn', "TARGETDIR=`"$extraido`"")
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
Copy-Item (Join-Path $libreoffice 'LICENSE*') $licencias -ErrorAction SilentlyContinue
Remove-Item $extraido -Recurse -Force -ErrorAction SilentlyContinue

# --- Pango, de MSYS2 -------------------------------------------------------------
$bash = Join-Path $Msys 'usr\bin\bash.exe'
& $bash -lc 'pacman -S --noconfirm --needed mingw-w64-x86_64-pango mingw-w64-x86_64-ntldd' | Out-Host
$binMsys = Join-Path $Msys 'mingw64\bin'
$gtk = New-Item -ItemType Directory -Force (Join-Path $Destino 'gtk\bin')
$lista = & $bash -lc "cd /mingw64/bin && ntldd -R $($DllsDeWeasyPrint -join ' ')"
# De cada línea de ntldd se queda la ruta, y sólo las que son de MSYS2: las de
# Windows (kernel32, ucrtbase…) ya están en cualquier equipo.
$dlls = @($DllsDeWeasyPrint) + @($lista | ForEach-Object {
  if ($_ -match '=>\s+(\S+\\mingw64\\bin\\\S+\.dll)') { [IO.Path]::GetFileName($Matches[1]) }
}) | Sort-Object -Unique
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
