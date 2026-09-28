import { SessionService } from './session.service';

describe('SessionService', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('en la web, la sesión se conserva entre pestañas y visitas', () => {
    const sesion = new SessionService();
    expect(localStorage.getItem('toolbox.session')).toBe(sesion.id);
    expect(sessionStorage.getItem('toolbox.session')).toBeNull();
    expect(new SessionService().id).toBe(sesion.id);
  });

  it('en la aplicación de Windows, cada ventana lleva la suya', () => {
    localStorage.setItem('toolbox.session', 'a'.repeat(32));
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => null };

    const sesion = new SessionService();

    expect(sesion.id).not.toBe('a'.repeat(32));
    expect(sessionStorage.getItem('toolbox.session')).toBe(sesion.id);
    expect(localStorage.getItem('toolbox.session')).toBe('a'.repeat(32));
  });
});
