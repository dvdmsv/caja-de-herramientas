import '@angular/compiler';
import 'fake-indexeddb/auto';
import { HttpRequest } from '@angular/common/http';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { LocalService } from '../../src/app/core/local/local.service';
import { AlmacenLocal } from '../../src/app/core/local/almacen';
import { crearZip } from '../../src/app/core/local/zip';
import type { PeticionMotor } from '../../src/app/core/local/tipos';

const puente = vi.hoisted(() => ({ heicAJpeg: vi.fn(), operarFirma: vi.fn() }));
vi.mock('../../src/app/core/local/android', () => ({ heicAJpeg: puente.heicAJpeg }));
vi.mock('../../src/app/core/local/firmas-digitales', () => ({ operarFirma: puente.operarFirma }));

let servicio: LocalService;
function peticion(url: string, body?: unknown) {
  return servicio.atender(new HttpRequest('POST', url, body), new AbortController().signal);
}
function vaciar() {
  return servicio.atender(new HttpRequest('DELETE', '/api/session'), new AbortController().signal);
}
function cargar(file: File) {
  const form = new FormData();
  form.append('files', file);
  return peticion('/api/files', form) as Promise<{ files: { id: string; name: string }[] }>;
}
beforeEach(async () => {
  servicio = new LocalService();
  await vaciar();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('inspecciona el HEIC original con GPS y fecha y solo pide un JPEG al borrar todos los campos', async () => {
  const bytes = readFileSync(new URL('../../android/app/src/androidTest/assets/gps-fecha.heic', import.meta.url));
  const file = new File([bytes], 'original.heic', { type: 'image/heic' });
  const { files: [original] } = await cargar(file);
  expect(original.name).toBe('original.heic');
  expect(puente.heicAJpeg).not.toHaveBeenCalled();

  const metadatos = { ubicacion: true, campos: [{ clave: 'gps' }, { clave: 'exif:306' }] };
  puente.operarFirma.mockImplementation(async entrada => {
    expect(await entrada.blob.arrayBuffer()).toEqual(await file.arrayBuffer());
    return { metadatos };
  });
  const ruta = '/api/tools/limpiar-metadatos';
  const opciones = { file_ids: [original.id] };
  await expect(peticion(ruta + '/inspeccionar', opciones)).resolves.toEqual({
    metadatos: [{ id: original.id, archivo: original.name, ...metadatos }],
  });
  await expect(peticion(ruta, { ...opciones, seleccion: { [original.id]: ['gps'] } })).rejects.toThrow('Marca todos');
  puente.heicAJpeg.mockResolvedValue(new File(['solo píxeles'], 'original.jpg', { type: 'image/jpeg' }));
  const limpio = await peticion(ruta, { ...opciones, seleccion: { [original.id]: ['gps', 'exif:306'] } }) as { files: { name: string }[] };
  expect(limpio.files[0].name).toBe('original-sin-metadatos.jpg');
  expect(puente.heicAJpeg).toHaveBeenCalledTimes(1);
});

it('el vaciado invalida tanto una importación retenida como un QR que espera al motor ocupado', async () => {
  const guardar = AlmacenLocal.prototype.guardar;
  let soltar!: () => void;
  const retenido = new Promise<void>(resolver => { soltar = resolver; });
  vi.spyOn(AlmacenLocal.prototype, 'guardar').mockImplementationOnce(async function (...args) {
    await retenido;
    return guardar.apply(this, args);
  });
  const importacion = cargar(new File(['pendiente'], 'original.heic'));
  const apariciones = vi.fn();
  vi.stubGlobal('Worker', class {
    constructor() { apariciones(); }
    postMessage() {}
    terminate() {}
  });
  const activo = peticion('/api/tools/generar-qr', {});
  await vi.waitFor(() => expect(apariciones).toHaveBeenCalledOnce());
  const enCola = peticion('/api/tools/generar-qr', {});
  const motores = Promise.allSettled([activo, enCola]);
  await vaciar();
  soltar();
  await expect(importacion).rejects.toThrow();
  expect((await motores).map(r => r.status)).toEqual(['rejected', 'rejected']);
  expect(apariciones).toHaveBeenCalledOnce();
  expect(await new AlmacenLocal().todos()).toEqual([]);
});

it('espera a la vista previa y exporta un ZIP con los bytes correctos', async () => {
  const { files: [archivo] } = await cargar(new File(['contenido'], 'entrada.pdf'));
  const trabajos: { worker: Worker; peticion: PeticionMotor }[] = [];
  vi.stubGlobal('Worker', class {
    postMessage(peticion: PeticionMotor) { trabajos.push({ worker: this as unknown as Worker, peticion }); }
    terminate() {}
  });
  const opciones = { file_ids: [archivo.id] };
  const previa = peticion('/api/tools/numerar-paginas/previsualizar', opciones);
  await vi.waitFor(() => expect(trabajos).toHaveLength(1));
  const zip = peticion('/api/files/zip', opciones);
  const vista = new Blob(['vista']);
  trabajos[0].worker.onmessage!(new MessageEvent('message', { data: { tipo: 'resultado', resultado: { archivos: [{ name: 'vista.png', blob: vista }] } } }));
  expect(await previa).toBe(vista);
  await vi.waitFor(() => expect(trabajos).toHaveLength(2));
  const segundo = trabajos[1];
  expect(segundo.peticion.slug).toBe('zip');
  const resultado = await crearZip(segundo.peticion.archivos, 'lote.zip');
  segundo.worker.onmessage!(new MessageEvent('message', { data: { tipo: 'resultado', resultado } }));
  const salida = await zip as { files: { id: string }[] };
  const contenido = await new AlmacenLocal().leer(salida.files[0].id);
  expect(new TextDecoder().decode(unzipSync(new Uint8Array(await contenido.blob.arrayBuffer()))['entrada.pdf'])).toBe('contenido');
});
