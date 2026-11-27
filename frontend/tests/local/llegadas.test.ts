import { expect, it, vi } from 'vitest';
import { recogerLlegadas } from '../../src/app/core/local/android';
import { avisoError } from '../../src/app/shared/notify';
const puente = vi.hoisted(() => ({ tomar: vi.fn(), soltar: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (ruta: string) => ruta }, registerPlugin: () => puente,
}));
vi.mock('@capacitor/app', () => ({ App: {} }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: {} }));
vi.mock('../../src/app/shared/notify', () => ({ avisoError: vi.fn() }));

it('entrega los archivos legibles en orden aunque otro no se pueda recuperar', async () => {
  puente.tomar.mockResolvedValue({ archivos: ['A','B','C'].map(nombre => ({ ruta: nombre, nombre })) });
  vi.stubGlobal('fetch', async (ruta: string) => new Response(ruta, { status: ruta === 'B' ? 404 : 200 }));
  try {
    const entregar = vi.fn(async (archivos: File[]) => {
      expect(archivos.map(a => a.name)).toEqual(['A','C']);
      expect(await Promise.all(archivos.map(a => a.text()))).toEqual(['A','C']);
    });
    await recogerLlegadas(entregar);
    expect(entregar).toHaveBeenCalledOnce();
    expect(avisoError).toHaveBeenCalledWith(expect.stringContaining('B.'));
    expect(puente.soltar).toHaveBeenCalledTimes(3);
  } finally { vi.unstubAllGlobals(); }
});
