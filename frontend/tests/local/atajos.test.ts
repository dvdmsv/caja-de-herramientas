import { it, expect } from 'vitest';
import { rutaDeAtajo } from '../../src/app/core/local/atajos';

it('un atajo lleva a su herramienta', () => {
  expect(rutaDeAtajo('cajadeherramientas://herramientas/unir-pdf')).toBe('/herramientas/unir-pdf');
  expect(rutaDeAtajo('cajadeherramientas://herramientas/ocr-pdf/')).toBe('/herramientas/ocr-pdf');
});

it('lo que no es un atajo no navega', () => {
  expect(rutaDeAtajo('content://com.android.providers.downloads/document/12')).toBeNull();
  expect(rutaDeAtajo('cajadeherramientas://herramientas/../ajustes')).toBeNull();
  expect(rutaDeAtajo('cajadeherramientas://otra/unir-pdf')).toBeNull();
  expect(rutaDeAtajo('https://example.com/herramientas/unir-pdf')).toBeNull();
});
