import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { configurarCodigos, decodificar, claseCodigo } from '../../src/app/core/local/codigos';

it('decodifica QR real usando exclusivamente el WASM empaquetado',async()=>{
  const wasm=readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
  configurarCodigos(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const png=await QRCode.toBuffer('WIFI:T:WPA;S:Casa;P:secreto;;',{width:200});
  const r=await decodificar(new Uint8Array(png));
  expect(r).toHaveLength(1);expect(r[0].contenido).toBe('WIFI:T:WPA;S:Casa;P:secreto;;');expect(r[0].clase).toBe('wifi');
});
it('clasifica sin abrir enlaces ni ejecutar contenido',()=>{
  expect(claseCodigo('https://example.com')).toBe('enlace');
  expect(claseCodigo('javascript:alert(1)')).toBe('texto');
  expect(claseCodigo('BEGIN:VCARD')).toBe('contacto');
});
