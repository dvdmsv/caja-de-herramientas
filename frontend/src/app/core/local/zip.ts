import { zipSync } from 'fflate';
import type { EntradaMotor, ResultadoMotor } from './tipos';

export async function crearZip(entradas: EntradaMotor[], nombre: string): Promise<ResultadoMotor> {
  if (!entradas.length) throw new Error('Elige los archivos que quieres guardar en el ZIP.');
  const archivos: Record<string, Uint8Array> = Object.create(null);
  for (const archivo of entradas) {
    let nombreEntrada = archivo.name;
    const punto = nombreEntrada.lastIndexOf('.');
    const base = punto > 0 ? nombreEntrada.slice(0, punto) : nombreEntrada;
    const extension = punto > 0 ? nombreEntrada.slice(punto) : '';
    let copia = 2;
    while (nombreEntrada in archivos) nombreEntrada = `${base} (${copia++})${extension}`;
    archivos[nombreEntrada] = new Uint8Array(await archivo.blob.arrayBuffer());
  }
  return { archivos: [{ name: nombre.replace(/(?:\.zip)?$/i, '.zip'),
    blob: new Blob([zipSync(archivos, { level: 1 })], { type: 'application/zip' }) }] };
}
