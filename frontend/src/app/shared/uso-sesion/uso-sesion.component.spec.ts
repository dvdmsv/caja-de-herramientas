import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { UsoSesion } from '../../core/api.service';
import { UsoService } from '../../core/uso.service';
import { UsoSesionComponent } from './uso-sesion.component';

/** Lo que dice el panel de cuándo se borran los archivos: lo que manda el servidor, no un texto fijo. */
describe('UsoSesionComponent', () => {
  function texto(uso: UsoSesion): string {
    const estado = new BehaviorSubject<UsoSesion | null>(uso);
    TestBed.configureTestingModule({
      imports: [UsoSesionComponent],
      providers: [provideRouter([]), { provide: UsoService, useValue: { uso: estado, refrescar: () => undefined } }],
    });
    const fixture = TestBed.createComponent(UsoSesionComponent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('.uso__panel')!.textContent!.replace(/\s+/g, ' ');
  }

  const base = { usado: 1024, tope: 1024 ** 3, caduca: Date.now() / 1000 + 3600 };

  it('en la web, la hora y el plazo que dice el servidor', () => {
    const panel = texto({ ...base, plazo: 7200, al_cerrar: false });
    expect(panel).toContain('se borrarán a partir de');
    expect(panel).not.toContain('a partir de el ');
    expect(panel).toContain('el plazo de 2 horas vuelve a empezar');
  });

  it('en la aplicación con otro plazo, ese plazo', () => {
    expect(texto({ ...base, plazo: 86400, al_cerrar: false })).toContain('el plazo de 1 día');
  });

  it('en la aplicación con «al cerrar», sin hora ni plazo', () => {
    const panel = texto({ ...base, plazo: 7 * 86400, al_cerrar: true });
    expect(panel).toContain('Se borrarán al cerrar la aplicación');
    expect(panel).not.toContain('plazo');
  });

  it('sin archivos no hay nada que borrar', () => {
    expect(texto({ ...base, caduca: null, plazo: 7200, al_cerrar: false })).toContain('No tienes archivos guardados');
  });
});
