import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HtmlAPdfComponent } from './html-a-pdf.component';

/**
 * Lo que importa de la página es que mande al servidor lo que se ha elegido,
 * con los nombres que espera `backend/api/tools/html_a_pdf.py`.
 */
describe('HtmlAPdfComponent', () => {
  function montar() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(HtmlAPdfComponent);
    fixture.detectChanges();
    const opciones = () => (fixture.componentInstance as unknown as {
      opciones(): Record<string, unknown>;
    }).opciones();
    return { fixture, pagina: fixture.nativeElement as HTMLElement, opciones };
  }

  it('por defecto pide A4 vertical con 15 mm de margen', () => {
    expect(montar().opciones()).toEqual({ pagina: 'a4', orientacion: 'vertical', margen: 15 });
  });

  it('manda el tamaño, la orientación y el margen que se eligen en pantalla', () => {
    const { fixture, pagina, opciones } = montar();

    pagina.querySelector<HTMLInputElement>('#tam-carta')!.click();
    pagina.querySelector<HTMLInputElement>('#ori-horizontal')!.click();
    const margen = pagina.querySelector<HTMLInputElement>('#margen')!;
    margen.value = '0';
    margen.dispatchEvent(new Event('input'));
    margen.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(opciones()).toEqual({ pagina: 'carta', orientacion: 'horizontal', margen: 0 });
  });

  it('el margen va de 0 a 40 mm, como admite el servidor', () => {
    const margen = montar().pagina.querySelector<HTMLInputElement>('#margen')!;
    expect([margen.min, margen.max]).toEqual(['0', '40']);
  });

  it('avisa de que no se descarga nada de fuera', () => {
    expect(montar().pagina.textContent).toContain('no se descargan');
  });
});
