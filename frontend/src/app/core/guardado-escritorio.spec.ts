import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { ApiService, ArchivoServidor } from './api.service';
import { recogerAbiertos } from './escritorio';
import { EscritorioService } from './escritorio.service';

describe('guardar junto al archivo original', () => {
  it('mantiene el origen de cada resultado aunque llegue otra carpeta antes de descargar', async () => {
    const guardar = vi.fn(async () => true);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(), { provide: EscritorioService, useValue: { guardar, activo: true } },
    ] });
    const api = TestBed.inject(ApiService);
    const http = TestBed.inject(HttpTestingController);
    const rutas = ['C:/A/original.pdf', 'C:/B/original.pdf'];
    const llegadas = await recogerAbiertos({ invoke: async comando => comando === 'archivos_pendientes'
      ? rutas.map(ruta => ({ herramienta: null, rutas: [ruta] }))
      : new Uint8Array([1]).buffer });
    const resultados: ArchivoServidor[] = [];
    for (const [i, llegada] of llegadas.entries()) {
      const subida = lastValueFrom(api.subir(llegada.archivos));
      const entrada = { id: 'entrada' + i, name: 'original.pdf', size: 1, generated: false };
      http.expectOne('/api/files').flush({ files: [entrada] });
      await subida;
      const trabajo = firstValueFrom(api.ejecutar('comprimir-pdf', { file_ids: [entrada.id] }));
      const salida = { ...entrada, id: 'salida' + i, generated: true };
      http.expectOne('/api/tools/comprimir-pdf').flush({ files: [salida] });
      resultados.push((await trabajo).files[0]);
    }
    for (const [i, salida] of resultados.entries()) {
      const descarga = firstValueFrom(api.descargar(salida));
      const blob = new Blob(['pdf']);
      http.expectOne('/api/files/' + salida.id + '/download').flush(blob);
      await descarga;
      expect(guardar).toHaveBeenLastCalledWith(blob, salida.name, rutas[i]);
    }
    http.verify();
  });
});
