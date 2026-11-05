import { it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { crearZip } from '../../src/app/core/local/zip';

it('no sobrescribe archivos con nombres repetidos, aunque el sufijo también exista', async () => {
  const nombres = ['informe.pdf', 'informe (2).pdf', 'informe.pdf'];
  const r = await crearZip(nombres.map((name, i) => ({ name, blob: new Blob([String(i)]) })), 'resultados.zip');
  const archivos = unzipSync(new Uint8Array(await r.archivos[0].blob.arrayBuffer()));
  expect(Object.keys(archivos)).toHaveLength(3);
  expect(Object.values(archivos).map(strFromU8).sort()).toEqual(['0', '1', '2']);
});
