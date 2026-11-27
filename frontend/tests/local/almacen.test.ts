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

it('migra una base v1 y mantiene la cuota con altas concurrentes, rechazos, bajas y vaciado', async () => {
  const anterior = indexedDB;
  const { IDBFactory } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();
  try {
    const solicitud = indexedDB.open('caja-android', 1);
    solicitud.onupgradeneeded = () => {
      const store = solicitud.result.createObjectStore('archivos', { keyPath: 'id' });
      store.put({ id: 'heredado', name: 'A.pdf', generated: false, size: 3, blob: new Blob(['ABC']) });
    };
    await new Promise<void>((ok, mal) => {
      solicitud.onsuccess = () => { solicitud.result.close(); ok(); };
      solicitud.onerror = () => mal(solicitud.error);
    });
    const a = new AlmacenLocal(), b = new AlmacenLocal();
    expect(await a.usado()).toBe(3);
    expect(await (await b.leer('heredado')).blob.text()).toBe('ABC');
    await Promise.all([a.guardar([{ name: 'B', blob: new Blob(['bb']) }], false),
      b.guardar([{ name: 'C', blob: new Blob(['ccc']) }], true)]);
    expect(await a.usado()).toBe(8);
    await expect(b.guardar([{ name: 'grande', blob: new Blob([new Uint8Array(CUOTA_LOCAL)]) }], true)).rejects.toThrow('250 MB');
    expect(await a.usado()).toBe(8);
    await Promise.all([a.eliminar('heredado'), b.eliminar('heredado')]);
    expect(await a.usado()).toBe(5);
    expect(await a.usado()).toBe((await b.todos()).reduce((n, archivo) => n + archivo.size, 0));
    await b.eliminar();
    expect(await a.usado()).toBe(0);
  } finally { globalThis.indexedDB = anterior; }
});
