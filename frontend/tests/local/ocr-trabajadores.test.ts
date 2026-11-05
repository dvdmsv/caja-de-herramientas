import { it, expect } from 'vitest';
import { PIXELES_A_LA_VEZ, cabeOtra, trabajadoresOcr } from '../../src/app/core/local/ocr-pdf';

it('reparte entre la mitad de los núcleos, con tope de tres', () => {
  expect(trabajadoresOcr(8, 8)).toBe(3);   // OnePlus 6: con cuatro se quedaba sin memoria
  expect(trabajadoresOcr(16, 16)).toBe(3);
  expect(trabajadoresOcr(4, 8)).toBe(2);
});

it('con poca memoria, menos Tesseract: cada uno pide la suya', () => {
  expect(trabajadoresOcr(8, 3)).toBe(2);
  expect(trabajadoresOcr(8, 1)).toBe(1);
});

it('sin datos del sistema, al menos uno', () => {
  expect(trabajadoresOcr(undefined, undefined)).toBe(1);
  expect(trabajadoresOcr(1, undefined)).toBe(1);
  expect(trabajadoresOcr(0, 0.5)).toBe(1);
});

it('tres A4 a 200 ppp caben a la vez; una página enorme va sola', () => {
  const a4 = 1654 * 2339;
  expect(cabeOtra(0, 0, a4, 3)).toBe(true);
  expect(cabeOtra(2, 2 * a4, a4, 3)).toBe(true);
  expect(cabeOtra(3, 3 * a4, a4, 3)).toBe(false);
  expect(cabeOtra(1, a4, 20_000_000, 3)).toBe(false);
  // La primera entra aunque sola pase del presupuesto: si no, nunca acabaría.
  expect(cabeOtra(0, 0, PIXELES_A_LA_VEZ * 2, 3)).toBe(true);
});
