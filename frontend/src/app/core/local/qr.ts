import QRCode from 'qrcode';
import type { OpcionesMotor, ResultadoMotor } from './tipos';

const escapar = (valor: unknown) => String(valor ?? '').replace(/([\\;,:])/g, '\\$1').replace(/[\r\n]/g, ' ');

export function contenidoQr(o: OpcionesMotor): string {
  switch (o['tipo']) {
    case 'texto': return String(o['texto'] ?? '');
    case 'telefono': return `tel:${String(o['telefono'] ?? '').replace(/[\r\n]/g, '')}`;
    case 'wifi': return `WIFI:T:${escapar(o['seguridad'])};S:${escapar(o['red'])};P:${escapar(o['clave'])};H:${!!o['oculta']};;`;
    case 'correo': return `mailto:${String(o['correo'] ?? '').replace(/[\r\n?]/g, '')}?subject=${encodeURIComponent(String(o['asunto'] ?? ''))}&body=${encodeURIComponent(String(o['mensaje'] ?? ''))}`;
    case 'contacto': return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapar(o['nombre'])}`,
      `ORG:${escapar(o['organizacion'])}`, `TEL:${escapar(o['telefono'])}`,
      `EMAIL:${escapar(o['correo'])}`, `URL:${escapar(o['web'])}`, 'END:VCARD'].join('\r\n');
    default: throw new Error('El tipo de QR no es válido.');
  }
}

export async function generarQr(o: OpcionesMotor): Promise<ResultadoMotor> {
  const texto = contenidoQr(o);
  if (!texto.trim()) throw new Error('Escribe el contenido del código.');
  const pedida = String(o['correccion'] ?? 'media');
  const nivel = ({ baja: 'L', media: 'M', alta: 'Q', maxima: 'H' } as Record<string, string>)[pedida] ?? pedida;
  if (!['L', 'M', 'Q', 'H'].includes(nivel)) throw new Error('La corrección del QR no es válida.');
  const codigo = QRCode.create(texto, { errorCorrectionLevel: nivel as 'M' });
  const escala = Math.max(1, Math.min(20, Number(o['escala']) || 8));
  const lado = (codigo.modules.size + 8) * escala;
  const cuadrados: [number, number][] = [];
  for (let y = 0; y < codigo.modules.size; y++) for (let x = 0; x < codigo.modules.size; x++) {
    if (codigo.modules.get(y, x)) cuadrados.push([(x + 4) * escala, (y + 4) * escala]);
  }
  let blob: Blob;
  const svg = String(o['formato']).toLowerCase() === 'svg';
  if (svg) {
    blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}"><rect width="100%" height="100%" fill="white"/><g fill="black">`,
      ...cuadrados.map(([x, y]) => `<rect x="${x}" y="${y}" width="${escala}" height="${escala}"/>`), '</g></svg>'], { type: 'image/svg+xml' });
  } else {
    const canvas = new OffscreenCanvas(lado, lado), ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = '#000'; cuadrados.forEach(([x, y]) => ctx.fillRect(x, y, escala, escala));
    blob = await canvas.convertToBlob({ type: 'image/png' });
  }
  return { archivos: [{ name: `codigo-qr.${svg ? 'svg' : 'png'}`, blob }] };
}
