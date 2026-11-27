import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api.service';
import { MarcaDeAguaComponent } from '../pages/tools/marca-de-agua/marca-de-agua.component';

describe('Vista previa de la herramienta', () => {
  it('al cambiar de documento o vaciar, cancela la imagen y el contador y libera la URL', () => {
    const cuentaA = new Subject<number>();
    const cuentaB = new Subject<number>();
    const imagenA = new Subject<string>();
    const imagenB = new Subject<string>();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), { provide: ApiService, useValue: {
        paginasDe: (id: string) => id === 'a' ? cuentaA : cuentaB,
        previsualizar: (_: string, datos: { file_ids: string[] }) =>
          datos.file_ids[0] === 'a' ? imagenA : imagenB,
      } },
    ] });
    const revocar = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const vista = TestBed.runInInjectionContext(() => new MarcaDeAguaComponent());
      const a = { id: 'a', name: 'A.pdf', size: 10, estado: 'subido' as const };
      const b = { ...a, id: 'b', name: 'B.pdf' };
      vista.archivos = [a];
      vista.alAgregar([a]);
      cuentaA.next(7);
      imagenA.next('blob:A');
      expect(vista.vista).toBe('blob:A');
      vista.archivos = [b];
      vista.alQuitarDocumento();
      expect(revocar).toHaveBeenCalledWith('blob:A');
      expect(cuentaA.observed || imagenA.observed).toBe(false);
      cuentaB.next(3);
      cuentaA.next(20);
      expect(vista.paginas).toBe(3);
      imagenB.next('blob:B');
      vista.archivos = [];
      vista.alQuitarDocumento();
      expect(revocar).toHaveBeenCalledWith('blob:B');
      expect(cuentaB.observed || imagenB.observed).toBe(false);
      expect(vista.vista).toBe('');
      expect(vista.paginas).toBe(0);
      vista.ngOnDestroy();
    } finally {
      revocar.mockRestore();
    }
  });
});
