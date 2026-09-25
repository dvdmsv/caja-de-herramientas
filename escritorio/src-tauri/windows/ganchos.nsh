; Ganchos del instalador NSIS de Tauri (bundle > windows > nsis > installerHooks).
;
; Registran la aplicación en «Abrir con…» del Explorador para los formatos que
; aceptan sus herramientas, **sin hacerse programa predeterminado de nada**. Por
; eso no se usa `bundle > fileAssociations` de Tauri: ése escribe el valor por
; defecto de `.pdf`, y en un equipo sin preferencia guardada la aplicación
; pasaría a abrir todos los PDF. Aquí sólo se añade una entrada a
; `OpenWithProgids`, que es la lista de «Abrir con», y se deja lo demás como
; estaba.
;
; SHCTX es HKCU porque el instalador es por usuario (installMode currentUser).

!define PROGID "CajaDeHerramientas.Archivo"

!macro CAJA_OFRECER EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
!macroend

!macro CAJA_RETIRAR EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

; Los formatos, los mismos que acepta el catálogo (frontend/src/app/core/tools.ts):
; PDF, imágenes, documentos de oficina, libros, Markdown y correos. Se dejan fuera
; a propósito los de texto genérico (.txt, .json, .xml, .html, .csv): ofrecerse
; para abrir cualquier .txt sólo llenaría el menú.
!macro CAJA_FORMATOS ACCION
  !insertmacro ${ACCION} "pdf"
  !insertmacro ${ACCION} "png"
  !insertmacro ${ACCION} "jpg"
  !insertmacro ${ACCION} "jpeg"
  !insertmacro ${ACCION} "webp"
  !insertmacro ${ACCION} "gif"
  !insertmacro ${ACCION} "bmp"
  !insertmacro ${ACCION} "tif"
  !insertmacro ${ACCION} "tiff"
  !insertmacro ${ACCION} "heic"
  !insertmacro ${ACCION} "heif"
  !insertmacro ${ACCION} "docx"
  !insertmacro ${ACCION} "doc"
  !insertmacro ${ACCION} "odt"
  !insertmacro ${ACCION} "rtf"
  !insertmacro ${ACCION} "xlsx"
  !insertmacro ${ACCION} "xls"
  !insertmacro ${ACCION} "ods"
  !insertmacro ${ACCION} "pptx"
  !insertmacro ${ACCION} "ppt"
  !insertmacro ${ACCION} "odp"
  !insertmacro ${ACCION} "epub"
  !insertmacro ${ACCION} "md"
  !insertmacro ${ACCION} "eml"
  !insertmacro ${ACCION} "msg"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Cómo se abre: la aplicación con el archivo como argumento. Si ya está
  ; abierta, el plugin single-instance se lo pasa a la ventana que hay.
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "Archivo para la Caja de herramientas"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; El nombre con el que sale en la lista, en vez del del ejecutable.
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  !insertmacro CAJA_FORMATOS CAJA_OFRECER
  ; Que el Explorador se entere sin reiniciar la sesión.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CAJA_FORMATOS CAJA_RETIRAR
  DeleteRegKey SHCTX "Software\Classes\${PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
