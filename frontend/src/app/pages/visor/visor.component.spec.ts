import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import Swal from 'sweetalert2';
import { vi } from 'vitest';

import { MemoriaDocumentoService } from '../../core/memoria-documento.service';
import { PdfService } from '../../core/pdf.service';
import { VisorComponent } from './visor.component';

describe('Guardado del visor', () => {
  it('conserva documento y revisión con subidas y guardados fuera de orden', async () => {
    const medidas = [1, 2, 3].map(numero => ({ numero, ancho: 600, alto: 800 }));
    const pdf = {
      abrir: async () => ({
        medidas: async () => medidas, indice: async () => [], etiquetas: async () => null,
        datos: () => new Promise(() => {}), capas: async () => [], adjuntos: async () => [],
        paginas: 0, cerrar: () => {},
      }),
    };
    TestBed.configureTestingModule({ providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: PdfService, useValue: pdf },
      { provide: MemoriaDocumentoService, useValue: {
        preferencias: () => ({}), recordar: () => null, guardar: () => {},
        huella: async (f: File) => f.name, huellaAnterior: async () => '',
      } },
    ] });
    const aviso = vi.spyOn(Swal, 'fire').mockResolvedValue({ isConfirmed: true, isDenied: false, isDismissed: false });
    try {
      const visor = TestBed.createComponent(VisorComponent).componentInstance;
      const http = TestBed.inject(HttpTestingController);
      await visor.abrir(new File([], 'A.pdf'));
      const a = http.expectOne('/api/files');
      await visor.abrir(new File([], 'B.pdf'));
      const b = http.expectOne('/api/files');
      visor.eliminarPagina(2);
      const guardado = visor.guardar();
      http.expectNone('/api/files');
      b.flush({ files: [{ id: 'B' }], rejected: [] });
      a.flush({ files: [{ id: 'A' }], rejected: [] });
      await vi.waitFor(() => expect(visor['fileId']).toBe('B'));
      const guardar = http.expectOne('/api/tools/visor/guardar');
      expect(guardar.request.body.file_ids).toEqual(['B']);
      expect(guardar.request.body.paginas.map((p: { numero: number }) => p.numero)).toEqual([1, 3]);
      visor.restaurarPagina(2);
      guardar.flush({ files: [{ id: 'antiguo' }] });
      await guardado;
      http.expectOne(req => req.method === 'DELETE').flush({});
      expect(visor.resultado).toBeNull();

      expect(visor.puedeGuardar).toBe(true);
      await visor.guardar();
      expect(visor.descargaOriginal).toBe(true);
      http.expectNone('/api/tools/visor/guardar');
      visor.eliminarPagina(2);
      const sinPagina = visor.guardar();
      await vi.waitFor(() => http.expectOne('/api/tools/visor/guardar').flush({ files: [{ id: 'sin-dos' }] }));
      await sinPagina;
      visor.restaurarPagina(2);
      expect(visor.resultado).toBeNull();
      http.verify();
    } finally {
      aviso.mockRestore();
    }
  });
});
