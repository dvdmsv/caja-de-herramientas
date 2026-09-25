import { TestBed } from '@angular/core/testing';

import { AcercaDeComponent } from './acerca-de.component';

describe('AcercaDeComponent', () => {
  function pintar(): HTMLElement {
    const fixture = TestBed.createComponent(AcercaDeComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('dice quién la ha hecho y enlaza a su perfil', () => {
    const pagina = pintar();
    const autor = pagina.querySelector<HTMLAnchorElement>('a[href="https://github.com/dvdmsv"]');

    expect(autor?.textContent?.trim()).toBe('dvdmsv');
    expect(pagina.textContent).toContain('Hecha por');
  });

  it('enlaza el código fuente, que la AGPL pide ofrecer', () => {
    const pagina = pintar();

    expect(pagina.querySelector('a[href="https://github.com/dvdmsv/caja-de-herramientas"]')).not.toBeNull();
    expect(pagina.textContent).toContain('AGPL-3.0');
  });

  it('los enlaces que salen de la aplicación se abren aparte y sin darle acceso a la página', () => {
    const fuera = Array.from(pintar().querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));

    expect(fuera.length).toBeGreaterThan(0);
    for (const enlace of fuera) {
      expect(enlace.rel).toContain('noopener');
    }
  });
});
