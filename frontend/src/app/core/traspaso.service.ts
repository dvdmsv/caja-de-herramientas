import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService, ArchivoServidor } from './api.service';

/** Una entrada de cola puede tener bytes en el navegador, una referencia de sesión, o ambos. */
export interface EntradaArchivo {
  name: string;
  size: number;
  file?: File;
  id?: string;
}

const DESTINOS_CON_LECTURA_LOCAL = new Set([
  'visor', 'dividir-pdf', 'organizar-pdf', 'editar-imagen', 'firmar', 'firmar-certificado',
]);

export async function prepararTraspaso(
  archivos: ArchivoServidor[], destino: string, api: Pick<ApiService, 'contenido'>,
): Promise<EntradaArchivo[]> {
  const entradas: EntradaArchivo[] = [];
  for (const archivo of archivos) {
    const entrada: EntradaArchivo = { id: archivo.id, name: archivo.name, size: archivo.size };
    if (DESTINOS_CON_LECTURA_LOCAL.has(destino)) {
      const blob = await firstValueFrom(api.contenido(archivo));
      entrada.file = new File([blob], archivo.name, { type: blob.type });
    }
    entradas.push(entrada);
  }
  return entradas;
}

@Injectable({ providedIn: 'root' })
export class TraspasoService {
  private pendientes: EntradaArchivo[] = [];

  dejar(archivos: File[]): void {
    this.dejarEntradas(archivos.map(file => ({ file, name: file.name, size: file.size })));
  }

  dejarEntradas(entradas: EntradaArchivo[]): void {
    this.pendientes = [...entradas];
  }

  tomar(): EntradaArchivo[] {
    const entradas = this.pendientes;
    this.pendientes = [];
    return entradas;
  }
}
