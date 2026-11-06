import Swal, { SweetAlertOptions, SweetAlertResult } from 'sweetalert2';

import { confirmar } from './notify';

describe('confirmar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no pinta el título como HTML: puede llevar un nombre que venga de fuera', async () => {
    const fire = vi.spyOn(Swal, 'fire').mockResolvedValue({ isConfirmed: true } as SweetAlertResult);

    const nombre = '<img src=x onerror=alert(1)>';
    expect(await confirmar(`¿Quitar «${nombre}»?`, 'Sin vuelta atrás.', 'Quitar')).toBe(true);

    const opciones = fire.mock.calls[0][0] as SweetAlertOptions;
    expect(opciones.titleText).toContain(nombre);
    expect(opciones.title).toBeUndefined();
  });
});
