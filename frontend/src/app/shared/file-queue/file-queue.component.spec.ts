import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { prepararTraspaso } from '../../core/traspaso.service';
import { UnirPdfComponent } from '../../pages/tools/unir-pdf/unir-pdf.component';
import { FileQueueComponent } from './file-queue.component';

describe('Resultados encadenados y orden de la cola', () => {
  it('mantiene el foco y el orden de los ID sin descargar ni resubir un lote', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    const fixture = TestBed.createComponent(FileQueueComponent);
    const cola = fixture.componentInstance;
    const unir = TestBed.runInInjectionContext(() => new UnirPdfComponent());
    const subir = vi.spyOn(unir['api'], 'subir');
    cola.items = unir.archivos;
    cola.ordenable = true;
    cola.agregados.subscribe(items => unir.alAgregar(items));
    const archivos = ['A', 'B', 'C'].map(id => ({ id, name: id + '.pdf', size: 30, generated: true }));
    const contenido = vi.fn(() => of(new Blob(['PDF de prueba'], { type: 'application/pdf' })));
    cola.recibir(await prepararTraspaso(archivos, 'unir-pdf', { contenido }));
    fixture.detectChanges();
    const boton = fixture.nativeElement.querySelector('button[aria-label="Subir C.pdf"]') as HTMLButtonElement;
    boton.focus();
    boton.click();
    boton.click();
    expect(document.activeElement).toBe(boton);
    expect(unir.archivos.map(item => item.id)).toEqual(['C', 'A', 'B']);
    expect(unir.listo).toBe(true);
    expect(subir).not.toHaveBeenCalled();
    expect(contenido).not.toHaveBeenCalled();

    const [local] = await prepararTraspaso([archivos[0]], 'dividir-pdf', { contenido });
    expect(contenido).toHaveBeenCalledTimes(1);
    expect(local.id).toBe('A');
    expect(await local.file?.text()).toBe('PDF de prueba');
  });
});
