import { limpiarEscaneo } from './escaneo';
import type * as MuPDF from 'mupdf';
import type { PeticionMotor, ResultadoMotor } from './tipos';
import { base, guardarPdf } from './pdf';
import { MAXIMO_PIXELES } from './catalogo';

/** Se decodifica con orientación EXIF, igual que las vistas previas del WebView. */
export async function lienzo(blob: Blob): Promise<OffscreenCanvas> {
  let imagen: ImageBitmap;
  try { imagen = await createImageBitmap(blob); }
  catch { throw new Error('Android no puede leer esta imagen. Prueba con JPG, PNG o WebP.'); }
  try {
    if (imagen.width * imagen.height > MAXIMO_PIXELES) throw new Error('La imagen supera 20 megapíxeles. Redúcela antes de abrirla.');
    const canvas = new OffscreenCanvas(imagen.width, imagen.height);
    canvas.getContext('2d')!.drawImage(imagen, 0, 0);
    return canvas;
  } finally { imagen.close(); }
}

function reducir(canvas: OffscreenCanvas, maximo: number): OffscreenCanvas {
  const factor = Math.min(1, maximo > 0 ? maximo / Math.max(canvas.width, canvas.height) : 1);
  if (factor === 1) return canvas;
  const salida = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * factor)), Math.max(1, Math.round(canvas.height * factor)));
  salida.getContext('2d')!.drawImage(canvas, 0, 0, salida.width, salida.height);
  return salida;
}

async function codificar(canvas: OffscreenCanvas, tipo: string, calidad: number): Promise<Blob> {
  if (tipo === 'image/jpeg') {
    const contexto = canvas.getContext('2d')!;
    contexto.globalCompositeOperation = 'destination-over';
    contexto.fillStyle = '#fff';
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.globalCompositeOperation = 'source-over';
  }
  const blob = await canvas.convertToBlob({ type: tipo, quality: Math.max(0.01, Math.min(1, calidad / 100)) });
  if (blob.type !== tipo) throw new Error('Este formato no está disponible en el WebView de tu teléfono.');
  return blob;
}

export async function ejecutarImagen(m: typeof MuPDF, { slug, archivos, opciones: o }: PeticionMotor,
                                     avance: (hechos: number, total: number) => void): Promise<ResultadoMotor> {
  if (!archivos.length) throw new Error('Elige una imagen.');
  const resultado: ResultadoMotor = { archivos: [] };
  const pdf = slug === 'imagen-a-pdf' ? new m.PDFDocument() : null;
  const objetivo = Number(o['objetivo_kb']) * 1024;
  let logrado = true;
  try {
    for (let i = 0; i < archivos.length; i++) {
      const entrada = archivos[i];
      let canvas = await lienzo(entrada.blob);
      if (slug === 'efecto-escaner' || slug === 'efecto-escaner/previsualizar') {
        const previa = slug.endsWith('/previsualizar');
        if (previa) canvas = reducir(canvas, 700);
        const ctx = canvas.getContext('2d')!, datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const modo = String(o['modo'] ?? 'blanco-y-negro');
        const pixels = limpiarEscaneo(datos.data, canvas.width, canvas.height, modo, Number(o['intensidad'] ?? 50));
        ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, canvas.width, canvas.height), 0, 0);
        const tipo = previa || modo === 'color' ? 'image/jpeg' : 'image/png';
        resultado.archivos.push({ name: `${base(entrada.name)}-escaneada.${tipo === 'image/png' ? 'png' : 'jpg'}`, blob: await codificar(canvas, tipo, previa ? 85 : 90) });
        avance(i + 1, archivos.length);
        if (previa) break;
        continue;
      }
      if (slug === 'editar-imagen') {
        const r = o['recorte'] as { x: number; y: number; ancho: number; alto: number };
        if (!r || ![r.x, r.y, r.ancho, r.alto].every(Number.isFinite) || r.x < 0 || r.y < 0
          || r.ancho <= 0 || r.alto <= 0 || r.x + r.ancho > 1.001 || r.y + r.alto > 1.001) throw new Error('El recorte no es válido.');
        const w = Math.max(1, Math.round(canvas.width * r.ancho));
        const h = Math.max(1, Math.round(canvas.height * r.alto));
        const giro = Number(o['giro']) || 0;
        if (![0, 90, 180, 270].includes(giro)) throw new Error('El giro no es válido.');
        const recorte = new OffscreenCanvas(giro % 180 ? h : w, giro % 180 ? w : h);
        const ctx = recorte.getContext('2d')!;
        ctx.translate(recorte.width / 2, recorte.height / 2);
        // El espejo se aplica tras girar, como en la herramienta de escritorio.
        ctx.scale(o['espejo'] ? -1 : 1, 1);
        ctx.rotate(giro * Math.PI / 180);
        ctx.drawImage(canvas, r.x * canvas.width, r.y * canvas.height, w, h, -w / 2, -h / 2, w, h);
        canvas = recorte;
      }
      canvas = reducir(canvas, Number(o['lado_maximo']) || 0);
      if (pdf) {
        const jpeg = await codificar(canvas, 'image/jpeg', Number(o['calidad']) || 85);
        const imagen = new m.Image(await jpeg.arrayBuffer());
        try {
          const ajustada = o['pagina'] === 'ajustada';
          let w = ajustada ? canvas.width * 0.75 : o['pagina'] === 'carta' ? 612 : 595.28;
          let h = ajustada ? canvas.height * 0.75 : o['pagina'] === 'carta' ? 792 : 841.89;
          if (!ajustada && (o['orientacion'] === 'horizontal' || (o['orientacion'] === 'auto' && canvas.width > canvas.height))) [w, h] = [h, w];
          const margen = ajustada ? 0 : Math.max(0, Number(o['margen']) || 0) * 72 / 25.4;
          if (margen * 2 >= Math.min(w, h)) throw new Error('El margen es demasiado grande.');
          const factor = Math.min((w - 2 * margen) / canvas.width, (h - 2 * margen) / canvas.height);
          const iw = canvas.width * factor, ih = canvas.height * factor;
          const pagina = pdf.addPage([0, 0, w, h], 0, { XObject: { Im: pdf.addImage(imagen) } },
            `q ${iw} 0 0 ${ih} ${(w - iw) / 2} ${(h - ih) / 2} cm /Im Do Q`);
          try { pdf.insertPage(-1, pagina); } finally { pagina.destroy(); }
        } finally { imagen.destroy(); }
      } else {
        const formato = slug === 'convertir-imagen' ? String(o['formato'])
          : slug === 'editar-imagen' && entrada.blob.type === 'image/png' ? 'PNG' : 'JPEG';
        const tipo = ({ PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp' } as Record<string, string>)[formato];
        if (!tipo) throw new Error('Elige un formato válido.');
        let blob = await codificar(canvas, tipo, Number(o['calidad']) || 75);
        if (objetivo > 0) {
          // Se busca la mayor calidad que cabe; si no basta, se reducen dimensiones.
          for (let vuelta = 0; vuelta < 8; vuelta++) {
            let inferior = 10, superior = 95;
            let mejor: Blob | null = null;
            while (inferior <= superior) {
              const calidad = Math.floor((inferior + superior) / 2);
              const candidato = await codificar(canvas, tipo, calidad);
              if (candidato.size <= objetivo) { mejor = candidato; inferior = calidad + 1; }
              else superior = calidad - 1;
            }
            blob = mejor ?? await codificar(canvas, tipo, 10);
            if (mejor) break;
            canvas = reducir(canvas, Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) * 0.75)));
          }
        }
        const ext = formato === 'JPEG' ? 'jpg' : formato.toLowerCase();
        const salida = slug === 'comprimir-imagen' && blob.size >= entrada.blob.size ? entrada
          : { name: `${base(entrada.name)}-${slug === 'editar-imagen' ? 'editada' : 'convertida'}.${ext}`, blob };
        if (objetivo > 0) logrado &&= salida.blob.size <= objetivo;
        resultado.archivos.push(salida);
      }
      avance(i + 1, archivos.length);
    }
    if (pdf) resultado.archivos.push({ name: 'imagenes.pdf', blob: guardarPdf(pdf) });
  } finally { pdf?.destroy(); }
  if (slug === 'comprimir-imagen') resultado.resumen = {
    antes: archivos.reduce((n, a) => n + a.blob.size, 0), despues: resultado.archivos.reduce((n, a) => n + a.blob.size, 0),
  };
  if (objetivo > 0) resultado.objetivo = { bytes: objetivo, logrado };
  return resultado;
}
