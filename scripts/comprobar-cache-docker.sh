#!/usr/bin/env bash
# Comprueba el Dockerfile real con un paquete npm sin dependencias externas.
# El identificador de instalación permite detectar si se vuelve a ejecutar npm ci.
set -euo pipefail
frontend=$(cd "$(dirname "$0")/../frontend" && pwd)
contexto=$(mktemp -d)
imagen="prueba-cache-frontend:$(basename "$contexto" | tr '[:upper:]' '[:lower:]')"
trap 'docker image rm "$imagen" >/dev/null 2>&1 || true; rm -rf "$contexto"' EXIT
cd "$contexto"
cp "$frontend"/{Dockerfile,.dockerignore,nginx.conf} .
cat > package.json <<'JSON'
{
  "name": "prueba-cache", "version": "1.0.0",
  "scripts": {
    "postinstall": "node -e \"require('fs').writeFileSync('instalacion', require('crypto').randomUUID())\"",
    "build": "mkdir -p dist/merge-pdf/browser && cp instalacion index.html dist/merge-pdf/browser/"
  }
}
JSON
cat > package-lock.json <<'JSON'
{"name":"prueba-cache","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"prueba-cache","version":"1.0.0","hasInstallScript":true}}}
JSON

compilar() { docker build --tag "$imagen" .; }
leer() { docker run --rm --entrypoint cat "$imagen" "/usr/share/nginx/html/$1"; }

echo primera > index.html
compilar
original=$(leer instalacion)
test -n "$original"
test "$(leer index.html)" = primera

echo segunda > index.html
compilar
test "$(leer instalacion)" = "$original"
test "$(leer index.html)" = segunda

# Un cambio válido y exclusivamente en el lockfile debe renovar la instalación.
echo >> package-lock.json
compilar
nueva=$(leer instalacion)
test -n "$nueva" && test "$nueva" != "$original"
