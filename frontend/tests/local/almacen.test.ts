import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AlmacenLocal } from '../../src/app/core/local/almacen';
import { CUOTA_LOCAL, MAXIMO_ARCHIVO } from '../../src/app/core/local/catalogo';

describe('almacenamiento de documentos', () => {
  it('conserva bytes al reabrir, renombra manteniendo la extensión y borra', async () => {
    const almacen = new AlmacenLocal();
    await almacen.eliminar();
    const [archivo] = await almacen.guardar([{ name: '../año.pdf', blob: new Blob(['%PDF-prueba']) }], false);
    const reabierto = new AlmacenLocal();
    expect(await (await reabierto.leer(archivo.id)).blob.text()).toBe('%PDF-prueba');
    expect((await reabierto.renombrar(archivo.id, 'Contrato')).name).toBe('Contrato.pdf');
    await reabierto.eliminar(archivo.id);
    await expect(almacen.leer(archivo.id)).rejects.toThrow('ya no');
  });
  it('rechaza un archivo grande antes de escribir y no publica lotes que exceden la cuota', async () => {
    const almacen = new AlmacenLocal(); await almacen.eliminar();
    await expect(almacen.guardar([{ name: 'grande.pdf', blob: new Blob([new Uint8Array(MAXIMO_ARCHIVO + 1)]) }], false)).rejects.toThrow('50 MB');
    await expect(almacen.guardar([{ name: 'salida.pdf', blob: new Blob([new Uint8Array(CUOTA_LOCAL + 1)]) }], true)).rejects.toThrow('250 MB');
    expect(await almacen.todos()).toEqual([]);
  });
});
