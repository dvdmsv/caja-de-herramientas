# Trabajo futuro

Lo que **no** está hecho y se sabe que falta, con lo que costaría y lo que
compraría. No son fallos: hoy la aplicación funciona y está comprobada de punta
a punta. Son las cosas que separan «funciona» de «seguirá funcionando dentro de
seis meses sin que nadie esté encima».

Está por orden de lo que más devuelve por lo que cuesta.

---

## 1. Vigilancia de dependencias

**Qué es.** Un `.github/dependabot.yml` con cuatro ecosistemas: npm (frontend),
pip (backend), Docker (las imágenes base) y las propias acciones de GitHub.
Cuando sale una versión nueva, abre un pull request.

**Por qué aquí funciona bien.** La CI ya levanta la pila completa y le pasa
`scripts/barrido.py`, así que ese pull request no se cree nada: pasa los 136
tests del frontend, los 78 del backend y las 23 herramientas **de verdad**, con
OCR, LibreOffice y WeasyPrint. Si una versión de PyMuPDF rompiera pdf2docx —que
es justo lo que pasó al subir de la 1.24 a la 1.25— el barrido lo caza antes de
llegar a `master`.

**Lo que hay que cuidar para que no moleste:** agrupar los paquetes de Angular
en un solo pull request (si no son quince), semanal para npm y pip, mensual para
Docker. Y de paso, el `npm audit fix` de la vulnerabilidad leve de sweetalert2.

**Coste:** media hora. **Compra:** que actualizar sea continuo en vez de un salto
doloroso dentro de un año.

---

## 2. Accesibilidad vigilada en la CI

**Qué es.** Un guion de navegador que carga seis pantallas —inicio, tres
herramientas, una con resultado y el visor con un documento abierto—, les pasa
**axe-core** y falla si aparece una violación *serious* o *critical*. Comprueba
además que ningún control propio baje de 44 px con puntero táctil y que no haya
desbordamiento horizontal. Son 24 combinaciones: cada pantalla en claro y
oscuro, en escritorio (1440 px) y en móvil (390×844).

**Por qué falta.** Ese trabajo se hizo y quedó en cero fallos serios y críticos,
pero fue una foto: hoy nada impide que el próximo cambio de plantilla lo rompa
sin que nadie se entere. El barrido cubre la API; la interfaz, no.

**Cómo encaja.** El trabajo «Imágenes y pasada por las herramientas» de la CI ya
hace `docker compose up -d` y espera a que los tres servicios estén sanos: el
guion entra ahí detrás, contra la misma pila. El runner de GitHub trae Chrome, y
si no, puppeteer se lo descarga.

**Coste:** media hora. **Compra:** que la accesibilidad no se pierda en el primer
cambio que nadie revise con esa lupa.

---

## 3. Red de seguridad para el visor

**Qué es.** El visor son unas 2200 líneas de componente sin test directo. Su
lógica pura sí está probada y aparte —`disposicion`, `cambios`, `coordenadas`,
`buscador`, `tipografia`—, que es deliberado; lo que no tiene red son las
interacciones.

**Las dos opciones, que no valen lo mismo:**

- *Tests de componente* con Vitest sobre jsdom. jsdom no tiene `getContext()` de
  canvas ni ejecuta pdf.js, así que sólo se puede probar el estado sustituyendo
  el servicio de PDF por uno falso: que subrayar añade un cambio, que deshacer lo
  quita, que cambiar de página mueve el contador. Cubre la mitad, y para la otra
  mitad hay que seguir sacando lógica del componente a módulos, como ya se hizo.
- *Tests de navegador* contra la pila real, que es lo que se recomienda. Cuatro o
  cinco recorridos de los que de verdad se rompen: abrir un PDF y que se pinte;
  subrayar y ver el subrayado; guardar y **comprobar en el PDF resultante que la
  anotación está donde tocaba**; rellenar un campo de formulario y verlo en el
  archivo; borrar una página y que el índice siga bien. La infraestructura ya
  existe: la CI levanta la pila para el barrido y estos recorridos entran ahí.

**Lo que los hace caros no es escribirlos**, es que son lentos y frágiles si se
hacen con prisa: hay que esperar a que pdf.js pinte, y eso invita a poner esperas
fijas que fallan un día sí y otro no. Hay que anclarlos a señales del DOM, nunca
a relojes.

**Coste:** una tarde larga. **Compra:** una red para la parte más grande de la
aplicación. Sólo merece la pena si se va a seguir tocando el visor.

---

## Pendiente fuera del repositorio

`COMPOSE_REMOVE_ORPHANS=true` en el `.env` de la máquina de despliegue. Sin él,
el día que se quite o se renombre un servicio, su contenedor viejo sigue
corriendo hasta que alguien lo note —pasó al separar el backend en tres—. No
puede ir versionado (`.env` está en `.gitignore`, y versionarlo rompería el
`git pull` de cualquier máquina que ya tenga uno). La orden:

```bash
sudo tee /opt/apps/merge-pdf/.env <<'EOF'
COMPOSE_REMOVE_ORPHANS=true
EOF
```

Mejor todavía: añadir `--remove-orphans` al `docker compose up -d` del script de
despliegue de la máquina, que lo arregla para todos los proyectos a la vez.

---

## Decidido que no

Para que no se vuelva a discutir sin motivo nuevo:

- **TLS, autenticación y defensa contra abuso.** Esto vive en una red de
  confianza o detrás de una VPN, y el README lo dice en «Antes de exponerlo a
  internet». Si algún día sale a internet, eso deja de ser una decisión y pasa a
  ser trabajo obligatorio.
- **Comprobador de despliegue automático.** El barrido ya existe y se lanza a
  mano cuando toca; añadir una unidad de systemd que lo ejecute tras cada
  despliegue se descartó por no meter más piezas.
- **Métricas tipo Prometheus.** Con el registro de nginx diciendo qué servicio
  atendió y los dos tiempos (`upstream` y `total`), hay bastante para un sitio de
  este tamaño.
