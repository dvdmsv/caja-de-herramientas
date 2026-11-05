/**
 * Quita de un flujo de contenido PDF el texto que no se ve: el que pinta con
 * `Tr 3` o `Tr 7` (la capa de un OCR anterior) o con transparencia cero. Todo
 * lo demás se copia byte a byte.
 *
 * Antes se hacía redibujando la página con el `DocumentWriter` de MuPDF, y eso
 * cambiaba las fuentes: una Helvetica con `WinAnsiEncoding` volvía como
 * `Identity-H` con un `ToUnicode` hecho como si los códigos fueran de
 * `StandardEncoding`. El texto se veía igual, pero «página» se extraía como
 * «p�gina» y «·» como «´»: ni se podía buscar ni copiar. Aquí no se toca nada
 * que no sea quitar operadores enteros.
 *
 * Es puro: entra un flujo y sale otro. Los Form XObject los recorre quien llama.
 */

/** Transparencia de relleno (`ca`) y de trazo (`CA`) de un estado gráfico con nombre. */
export type Transparencias = (nombre: string) => { relleno?: number; trazo?: number };

interface Estado { modo: number; relleno: number; trazo: number }

const ESPACIO = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITADOR = new Set([...'()<>[]{}/%'].map(c => c.charCodeAt(0)));

/** Si con este estado el texto no deja nada a la vista. */
export function esInvisible({ modo, relleno, trazo }: Estado): boolean {
  if (modo === 3 || modo === 7) return true;            // ni relleno ni trazo
  const rellena = [0, 2, 4, 6].includes(modo), traza = [1, 2, 5, 6].includes(modo);
  return (!rellena || relleno === 0) && (!traza || trazo === 0);
}

export function quitarTextoInvisibleDelFlujo(entrada: Uint8Array, transparencias: Transparencias): { contenido: Uint8Array; quitados: number } {
  const n = entrada.length;
  const salida: Uint8Array[] = [];
  let copiadoHasta = 0, quitados = 0;
  let estado: Estado = { modo: 0, relleno: 1, trazo: 1 };
  const pila: Estado[] = [];
  // Operandos desde el último operador: dónde empieza el primero y sus textos.
  let inicioOperandos = -1;
  const operandos: string[] = [];
  let profundidad = 0;                                   // dentro de [ ] o << >>
  let i = 0;

  const texto = (a: number, b: number) => String.fromCharCode(...entrada.subarray(a, b));
  const quitar = (desde: number, hasta: number, sustituto = '') => {
    salida.push(entrada.subarray(copiadoHasta, desde));
    if (sustituto) salida.push(Uint8Array.from(sustituto, c => c.charCodeAt(0)));
    copiadoHasta = hasta;
    quitados++;
  };
  const operando = (inicio: number, valor: string) => {
    if (profundidad === 0) {
      if (inicioOperandos < 0) inicioOperandos = inicio;
      operandos.push(valor);
    }
  };

  while (i < n) {
    const c = entrada[i];
    if (ESPACIO.has(c)) { i++; continue; }
    const inicio = i;
    if (c === 0x25) {                                    // % comentario
      while (i < n && entrada[i] !== 10 && entrada[i] !== 13) i++;
      continue;
    }
    if (c === 0x28) {                                    // ( cadena literal )
      let nivel = 0;
      for (; i < n; i++) {
        if (entrada[i] === 0x5c) { i++; continue; }      // \ escapa lo que siga
        if (entrada[i] === 0x28) nivel++;
        else if (entrada[i] === 0x29 && --nivel === 0) { i++; break; }
      }
      if (profundidad === 0) operando(inicio, '(');
      continue;
    }
    if (c === 0x3c) {                                    // < cadena hex > o << diccionario
      if (entrada[i + 1] === 0x3c) { if (profundidad === 0) operando(inicio, '<<'); profundidad++; i += 2; continue; }
      while (i < n && entrada[i] !== 0x3e) i++;
      i++;
      if (profundidad === 0) operando(inicio, '<');
      continue;
    }
    if (c === 0x3e && entrada[i + 1] === 0x3e) { profundidad = Math.max(0, profundidad - 1); i += 2; continue; }
    if (c === 0x5b) { if (profundidad === 0) operando(inicio, '['); profundidad++; i++; continue; }
    if (c === 0x5d) { profundidad = Math.max(0, profundidad - 1); i++; continue; }
    if (c === 0x2f) {                                    // /Nombre
      i++;
      while (i < n && !ESPACIO.has(entrada[i]) && !DELIMITADOR.has(entrada[i])) i++;
      operando(inicio, texto(inicio + 1, i));
      continue;
    }
    if (DELIMITADOR.has(c)) { i++; continue; }           // { } sueltos
    while (i < n && !ESPACIO.has(entrada[i]) && !DELIMITADOR.has(entrada[i])) i++;
    const palabra = texto(inicio, i);
    if (profundidad > 0) continue;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palabra) || palabra === 'true' || palabra === 'false' || palabra === 'null') {
      operando(inicio, palabra);
      continue;
    }

    // Un operador.
    const desde = inicioOperandos >= 0 ? inicioOperandos : inicio;
    switch (palabra) {
      case 'q': pila.push({ ...estado }); break;
      case 'Q': estado = pila.pop() ?? estado; break;
      case 'Tr': estado = { ...estado, modo: Number(operandos.at(-1)) || 0 }; break;
      case 'gs': {
        const t = transparencias(operandos.at(-1) ?? '');
        estado = { ...estado, relleno: t.relleno ?? estado.relleno, trazo: t.trazo ?? estado.trazo };
        break;
      }
      case 'Tj': case 'TJ':
        if (esInvisible(estado)) quitar(desde, i);
        break;
      // ' y " también pasan de renglón: eso se conserva, sólo se quita el texto.
      case "'":
        if (esInvisible(estado)) quitar(desde, i, 'T*');
        break;
      case '"':
        if (esInvisible(estado)) quitar(desde, i, `${operandos[0] ?? 0} Tw ${operandos[1] ?? 0} Tc T*`);
        break;
      case 'ID': {                                       // imagen en línea: datos binarios hasta EI
        i++;                                             // el espacio que sigue a ID
        while (i < n && !(ESPACIO.has(entrada[i - 1]) && entrada[i] === 0x45 && entrada[i + 1] === 0x49
          && (i + 2 >= n || ESPACIO.has(entrada[i + 2]) || DELIMITADOR.has(entrada[i + 2])))) i++;
        i += 2;
        break;
      }
    }
    inicioOperandos = -1;
    operandos.length = 0;
  }
  if (!quitados) return { contenido: entrada, quitados: 0 };
  salida.push(entrada.subarray(copiadoHasta));
  const total = salida.reduce((s, b) => s + b.length, 0), contenido = new Uint8Array(total);
  let p = 0;
  for (const b of salida) { contenido.set(b, p); p += b.length; }
  return { contenido, quitados };
}
