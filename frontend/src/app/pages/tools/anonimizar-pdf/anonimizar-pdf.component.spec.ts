import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { ApiService, ZonasAnonimizado } from '../../../core/api.service';
import { AnonimizarPdfComponent } from './anonimizar-pdf.component';

describe('Anonimizar PDF', () => {
  it('espera a la inspección y muestra las páginas pendientes antes y después de exportar', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AnonimizarPdfComponent);
    const pagina = fixture.componentInstance;
    const inspeccion = new Subject<ZonasAnonimizado>();
    vi.spyOn(TestBed.inject(ApiService), 'inspeccionarAnonimizado').mockReturnValue(inspeccion);
    pagina.archivos = [{ id: 'original', name: 'mixto.pdf', size: 123, estado: 'subido' }];
    pagina.alQuitarDocumento();
    expect(pagina.listo).toBe(false);
    inspeccion.next({ total: 1, recuento: [{tipo: 'correo', cuantas: 1}], paginas: [], paginas_sin_capa: [2] });
    expect(pagina.listo).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Las páginas 2 contienen imágenes');
    pagina.resultados = [{ id: 'salida', name: 'tachado.pdf', size: 200, generated: true }];
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('las imágenes de las páginas 2');
    expect(fixture.nativeElement.textContent).toContain('vista previa del resultado');
  });
});
